import {
  type Bound,
  BoundExcluded,
  BoundIncluded,
  BoundQuery,
  DateTime,
  Decimal,
  Duration,
  FileRef,
  Geometry,
  RecordId,
  RecordIdRange,
  type RecordIdValue,
  surql,
  Uuid,
} from "surrealdb";
import { z } from "zod";

/**
 * The "pure" approach: a field is a stock Zod schema + SurrealQL DDL metadata.
 * The JS<->DB mapping rides on Zod's two native channels via codecs:
 *   - encoded side (`z.input`)  = DB wire type
 *   - decoded side (`z.output`) = app type
 * `z.decode` reads from the DB, `z.encode` writes to it.
 */

/**
 * Maps a Surreal-native schema (datetime codec, recordId) to its SurrealQL type.
 * Kept on the schema — not the field — so it composes through array()/optional()/nesting.
 */
export const surrealTypeRegistry = new WeakMap<z.ZodType, string>();

/**
 * Maps an object schema built via `sz.object` to its original SField shape, so
 * nested fields keep their DDL metadata ($default/$assert/...) during generation.
 */
export const objectFieldsRegistry = new WeakMap<
  z.ZodType,
  Record<string, AnyField>
>();

/**
 * Per-table/field row-level permissions. A `PermOp` is one access operation; `Perm` is
 * the rule for one op — `true` (FULL) / `false` (NONE) / a `BoundQuery` (a `WHERE` expr) /
 * `` `same as X` `` to reuse another op's resolved rule. A `TablePermissions` is a blanket
 * rule, a shared `WHERE`, or per-op rules. Fields have NO `delete` op (verified against
 * the DB), so they use `FieldPerm` / `FieldPermissions`.
 */
export type PermOp = "select" | "create" | "update" | "delete";
export type Perm = boolean | BoundQuery | `same as ${PermOp}`;
export type TablePermissions =
  | boolean
  | BoundQuery
  | Partial<Record<PermOp, Perm>>;
export type FieldPerm =
  | boolean
  | BoundQuery
  | "same as select"
  | "same as create"
  | "same as update";
export type FieldPermissions =
  | boolean
  | BoundQuery
  | Partial<Record<"select" | "create" | "update", FieldPerm>>;

/** SurrealQL DDL metadata — the `$`-prefixed field options. */
export interface SurrealMeta {
  default?: BoundQuery;
  defaultAlways?: boolean;
  value?: BoundQuery;
  /**
   * `ASSERT` fragments that AND-combine into one clause. Computed checks (format
   * builders, `$`-constraints, `.$assert()`-derived) are plain strings; a custom
   * `.$assert(surql\`…\`)` is a `BoundQuery` (inlined during DDL generation).
   */
  asserts?: (string | BoundQuery)[];
  readonly?: boolean;
  comment?: string;
  /** Field-level `PERMISSIONS` (no `delete` op). Omitted ops default to FULL in
   * SurrealDB — the table is the gate; set an op `false` to lock it. See `.$permissions()`. */
  permissions?: FieldPermissions;
  /** DB-managed, client-hidden: still emits DEFINE FIELD (+ PERMISSIONS NONE) but is
   * excluded from the public app/create/update surface. See `.$internal()` / `.system`. */
  internal?: boolean;
  /** Single-field index: `.index()` (normal) / `.unique()` (uniqueness). Emits a `DEFINE
   * INDEX <table>_<field>_idx ON TABLE <table> FIELDS <field> [UNIQUE]`. */
  index?: { unique?: boolean };
}

/** Render a primitive as a clean SurrealQL literal; non-primitives return "". */
function primitiveLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

/** Coerce a `$default`/`$defaultAlways` argument (a value or a `surql` expr) to a BoundQuery. */
function toExpr(value: unknown): BoundQuery {
  if (value instanceof BoundQuery) return value;
  const literal = primitiveLiteral(value);
  return literal ? new BoundQuery(literal) : surql`${value}`;
}

/**
 * Zod string formats whose `string::is_<fmt>` validator exists on SurrealDB v3.x
 * (probed live on 3.1.3: `RETURN string::is_<fmt>("x")`). A matching format builder
 * bakes `string::is_<fmt>($value)` by default; formats absent here (nanoid/cuid/cuid2/
 * xid/ksuid/cidrv4/cidrv6/guid/base64/base64url/e164/jwt/emoji) stay assert-free — no
 * fabricated regex. `uuid` is the native `uuid` type, not a string format (no assert).
 */
const STRING_IS_FORMATS = new Set(["email", "url", "ulid", "ipv4", "ipv6"]);

/** Map a Zod string format to its SurrealDB `string::is_*` assert, when one exists. */
function formatAssert(format: string): string | undefined {
  return STRING_IS_FORMATS.has(format)
    ? `string::is_${format}($value)`
    : undefined;
}

/** Build an SField for a Zod string-format schema, baking `string::is_<fmt>($value)`
 * when SurrealDB has that validator (else no assert). */
function formatField<S extends z.ZodType>(
  schema: S,
  format: string,
): SField<S> {
  const frag = formatAssert(format);
  return new SField(schema, frag ? { asserts: [frag] } : {});
}

/** The check methods that live on concrete Zod subtypes (ZodString/ZodNumber) but not
 * the base `z.ZodType` — `$`-constraints call these (cast through this shape). */
type CheckableSchema = {
  min(n: number): z.ZodType;
  max(n: number): z.ZodType;
  length(n: number): z.ZodType;
  regex(re: RegExp): z.ZodType;
  gt(n: number): z.ZodType;
  gte(n: number): z.ZodType;
  lt(n: number): z.ZodType;
  lte(n: number): z.ZodType;
};

/** One entry in a Zod schema's `_zod.def.checks`. */
type ZodCheck = {
  _zod: {
    def: {
      check?: string;
      minimum?: number;
      maximum?: number;
      length?: number;
      value?: number;
      inclusive?: boolean;
      format?: string;
      pattern?: RegExp;
    };
  };
};

/**
 * Best-effort: derive DB `ASSERT` fragments from a Zod schema's checks. Reads the Zod 4
 * check shape (`schema._zod.def.checks[]._zod.def`): string `min_length`/`max_length`/
 * `length_equals`, `string_format` (regex -> `$value = /…/`; email/url/… -> `string::is_*`),
 * and number `greater_than`/`less_than` (with `inclusive`). The schema may itself be a
 * `string_format` (e.g. `z.email()`), so its top-level `def.format` is mapped too. Unknown
 * checks are skipped silently.
 */
function deriveAsserts(schema: z.ZodType): string[] {
  const def = schema._zod.def as {
    check?: string;
    format?: string;
    checks?: ZodCheck[];
  };
  const out: string[] = [];

  // The schema itself may be a string-format (z.email()/z.url()/…).
  if (def.check === "string_format" && typeof def.format === "string") {
    const frag = formatAssert(def.format);
    if (frag) out.push(frag);
  }

  for (const c of def.checks ?? []) {
    const d = c._zod.def;
    switch (d.check) {
      case "min_length":
        out.push(`string::len($value) >= ${d.minimum}`);
        break;
      case "max_length":
        out.push(`string::len($value) <= ${d.maximum}`);
        break;
      case "length_equals":
        out.push(`string::len($value) == ${d.length}`);
        break;
      case "string_format":
        if (d.format === "regex" && d.pattern) {
          out.push(`$value = /${d.pattern.source}/`);
        } else if (typeof d.format === "string") {
          const frag = formatAssert(d.format);
          if (frag) out.push(frag);
        }
        break;
      case "greater_than":
        out.push(`$value >${d.inclusive ? "=" : ""} ${d.value}`);
        break;
      case "less_than":
        out.push(`$value <${d.inclusive ? "=" : ""} ${d.value}`);
        break;
    }
  }
  return out;
}

/** The schema one wrapper down — what `unwrap()` returns. */
type InnerOf<S extends z.ZodType> =
  S extends z.ZodOptional<infer I extends z.ZodType>
    ? I
    : S extends z.ZodNullable<infer I extends z.ZodType>
      ? I
      : S extends z.ZodDefault<infer I extends z.ZodType>
        ? I
        : S extends z.ZodPrefault<infer I extends z.ZodType>
          ? I
          : S extends z.ZodCatch<infer I extends z.ZodType>
            ? I
            : S extends z.ZodReadonly<infer I extends z.ZodType>
              ? I
              : S extends z.ZodArray<infer I extends z.ZodType>
                ? I
                : S;

/**
 * A Zod schema paired with SurrealQL DDL metadata. `Flags` tracks input traits
 * used by `Create<>`/`Update<>`: `"create"` (DB-filled -> optional on create) and
 * `"readonly"` (excluded from updates). It only appears in method return types, so
 * `SField` is covariant in it.
 */
export class SField<
  S extends z.ZodType = z.ZodType,
  Flags extends string = never,
> {
  constructor(
    readonly schema: S,
    readonly surreal: SurrealMeta = {},
  ) {}

  // --- Field-level codec (raw, on `this.schema`): `decode` reads (wire -> app), `encode`
  // writes (app -> wire). Create-shaping is a table concept, so these are NOT create-shaped —
  // e.g. `sz.datetime().decode(dbDateTime) -> Date`, `sz.uuid().encode("…") -> Uuid`. ---
  /** Decode a DB value to its app type (wire -> app). */
  decode(value: unknown): z.output<S> {
    return z.decode(this.schema, value as never);
  }
  /** Encode an app value to its DB wire type (app -> wire). */
  encode(value: z.output<S>): z.input<S> {
    return z.encode(this.schema, value);
  }
  decodeAsync(value: unknown): Promise<z.output<S>> {
    return z.decodeAsync(this.schema, value as never);
  }
  encodeAsync(value: z.output<S>): Promise<z.input<S>> {
    return z.encodeAsync(this.schema, value);
  }
  safeDecode(value: unknown) {
    return z.safeDecode(this.schema, value as never);
  }
  safeEncode(value: z.output<S>) {
    return z.safeEncode(this.schema, value);
  }
  safeDecodeAsync(value: unknown) {
    return z.safeDecodeAsync(this.schema, value as never);
  }
  safeEncodeAsync(value: z.output<S>) {
    return z.safeEncodeAsync(this.schema, value);
  }
  // Deprecated Zod-style aliases — `parse` runs the DECODE direction (wire -> app), so it's
  // just `decode` under a misleading name. Kept for `z`-API familiarity (struck through).
  /** @deprecated `parse` decodes a value (wire -> app). Use {@link SField.decode | decode}. */
  parse(value: unknown): z.output<S> {
    return this.decode(value);
  }
  /** @deprecated Use {@link SField.safeDecode | safeDecode}. */
  safeParse(value: unknown) {
    return this.safeDecode(value);
  }
  /** @deprecated Use {@link SField.decodeAsync | decodeAsync}. */
  parseAsync(value: unknown): Promise<z.output<S>> {
    return this.decodeAsync(value);
  }
  /** @deprecated Use {@link SField.safeDecodeAsync | safeDecodeAsync}. */
  safeParseAsync(value: unknown) {
    return this.safeDecodeAsync(value);
  }

  // Zod wrappers — delegate to the inner schema, carry DDL metadata + flags forward.
  optional(): SField<z.ZodOptional<S>, Flags> {
    return new SField(this.schema.optional(), this.surreal);
  }
  nullable(): SField<z.ZodNullable<S>, Flags> {
    return new SField(this.schema.nullable(), this.surreal);
  }
  default(value: z.input<S>): SField<z.ZodDefault<S>, Flags> {
    return new SField(this.schema.default(value as never), this.surreal);
  }
  /** Zod prefault: fill an absent value with `value`, then validate it (unlike `.default`). */
  prefault(value: z.input<S>): SField<z.ZodPrefault<S>, Flags> {
    return new SField(z.prefault(this.schema, value as never), this.surreal);
  }
  /** Zod catch: fall back to `value` when parsing fails. */
  catch(value: z.output<S>): SField<z.ZodCatch<S>, Flags> {
    return new SField(this.schema.catch(value as never), this.surreal);
  }
  array(): SField<z.ZodArray<S>, Flags> {
    return new SField(z.array(this.schema), this.surreal);
  }
  nullish(): SField<z.ZodOptional<z.ZodNullable<S>>, Flags> {
    return new SField(this.schema.nullish(), this.surreal);
  }
  /** Peel one wrapper (optional/nullable/default/prefault/catch/readonly/array) off the field. */
  unwrap(): SField<InnerOf<S>, Flags> {
    const def = this.schema._zod.def as {
      innerType?: z.ZodType;
      element?: z.ZodType;
    };
    const inner = def.innerType ?? def.element ?? this.schema;
    return new SField(inner, this.surreal) as unknown as SField<
      InnerOf<S>,
      Flags
    >;
  }

  /** Object-only: allow arbitrary extra keys — `FLEXIBLE` in DDL. Mirrors Zod's `.loose()`. */
  loose(): SField<S, Flags> {
    return this.objectMode("loose");
  }
  /** Object-only: reject unknown keys — non-`FLEXIBLE` (the default). Mirrors Zod's `.strict()`. */
  strict(): SField<S, Flags> {
    return this.objectMode("strict");
  }
  /** Alias for {@link SField.loose | loose} — a `FLEXIBLE` object accepting arbitrary keys. */
  flexible(): SField<S, Flags> {
    return this.loose();
  }
  private objectMode(mode: "loose" | "strict"): SField<S, Flags> {
    const obj = this.schema as unknown as {
      loose?: () => z.ZodType;
      strict?: () => z.ZodType;
    };
    if (typeof obj.loose !== "function" || typeof obj.strict !== "function") {
      return this; // not an object schema — no-op
    }
    const next = (mode === "loose"
      ? obj.loose()
      : obj.strict()) as unknown as S;
    // Carry the nested-field registry forward so DDL/create-shaping still see the subfields.
    const fields = objectFieldsRegistry.get(this.schema);
    if (fields) objectFieldsRegistry.set(next, fields);
    return new SField(next, this.surreal);
  }

  // SurrealQL DDL metadata. $default/$defaultAlways mark the field create-optional;
  // $readonly marks it non-updatable (see Create<>/Update<>). The default accepts a
  // plain value (rendered as a literal) or a `surql` expression.
  $default(value: z.output<S> | BoundQuery): SField<S, Flags | "create"> {
    return new SField(this.schema, {
      ...this.surreal,
      default: toExpr(value),
      defaultAlways: false,
    });
  }
  $defaultAlways(value: z.output<S> | BoundQuery): SField<S, Flags | "create"> {
    return new SField(this.schema, {
      ...this.surreal,
      default: toExpr(value),
      defaultAlways: true,
    });
  }
  /**
   * Set a DB-side `VALUE` clause. Whether the field is create-OPTIONAL depends on
   * whether the expression consumes the client input (`$value`), which can't be
   * inferred — so it's explicit via the `optional` option:
   *   - `time::now()` ignores input -> `{ optional: true }` (create-optional)
   *   - `string::lowercase($value)` requires input -> default (create-required)
   * Optionality is purely type-level (the option drives the `"create"` flag that
   * `Create<>`/`encode()` read); it does not touch the app type or DB nullability.
   * There is no separate update option — every field is already optional in `Update<>`.
   */
  $value<O extends boolean = false>(
    expr: BoundQuery,
    // biome-ignore lint/correctness/noUnusedFunctionParameters: drives the O generic (type-level only)
    opts?: { optional?: O },
  ): SField<S, O extends true ? Flags | "create" : Flags> {
    return new SField(this.schema, { ...this.surreal, value: expr });
  }
  /**
   * Add an `ASSERT` fragment (fragments AND-combine into one clause):
   *   - `.$assert(surql\`…\`)` pushes a custom expression (inlined during DDL generation).
   *   - `.$assert()` (no args) derives fragments from the field's existing Zod checks
   *     (formats, string length/regex, number bounds) — best-effort; unknowns are skipped.
   */
  $assert(expr?: BoundQuery): SField<S, Flags> {
    const frags = expr ? [expr] : deriveAsserts(this.schema);
    return this.pushAsserts(frags);
  }

  // --- $-constraints: apply the app-side Zod check AND push a type-aware DB ASSERT. ---
  // String-vs-number is read from the schema's own `def.type`; unsupported type/method
  // combos no-op (return the field unchanged).

  /** Min length (string) / minimum value (number). */
  $min(n: number): SField<S, Flags> {
    if (this.schemaType === "string")
      return this.constrain("min", n, `string::len($value) >= ${n}`);
    if (this.schemaType === "number")
      return this.constrain("min", n, `$value >= ${n}`);
    return this;
  }
  /** Max length (string) / maximum value (number). */
  $max(n: number): SField<S, Flags> {
    if (this.schemaType === "string")
      return this.constrain("max", n, `string::len($value) <= ${n}`);
    if (this.schemaType === "number")
      return this.constrain("max", n, `$value <= ${n}`);
    return this;
  }
  /** Exact length (string). */
  $length(n: number): SField<S, Flags> {
    if (this.schemaType === "string") {
      return this.constrain("length", n, `string::len($value) == ${n}`);
    }
    return this;
  }
  /** Pattern match (string). */
  $regex(re: RegExp): SField<S, Flags> {
    if (this.schemaType === "string")
      return this.constrain("regex", re, `$value = /${re.source}/`);
    return this;
  }
  /** Greater than (number). */
  $gt(n: number): SField<S, Flags> {
    if (this.schemaType === "number")
      return this.constrain("gt", n, `$value > ${n}`);
    return this;
  }
  /** Greater than or equal (number). */
  $gte(n: number): SField<S, Flags> {
    if (this.schemaType === "number")
      return this.constrain("gte", n, `$value >= ${n}`);
    return this;
  }
  /** Less than (number). */
  $lt(n: number): SField<S, Flags> {
    if (this.schemaType === "number")
      return this.constrain("lt", n, `$value < ${n}`);
    return this;
  }
  /** Less than or equal (number). */
  $lte(n: number): SField<S, Flags> {
    if (this.schemaType === "number")
      return this.constrain("lte", n, `$value <= ${n}`);
    return this;
  }

  /** The underlying Zod schema's `def.type` ("string" / "number" / …). */
  private get schemaType(): string {
    return (this.schema._zod.def as { type: string }).type;
  }
  /** Append ASSERT fragments, returning a new field (same type param + flags). */
  private pushAsserts(frags: (string | BoundQuery)[]): SField<S, Flags> {
    if (frags.length === 0) return this;
    return new SField(this.schema, {
      ...this.surreal,
      asserts: [...(this.surreal.asserts ?? []), ...frags],
    });
  }
  /** Apply a concrete-subtype Zod check (`min`/`max`/`length`/`regex`/`gt`/…) and push its
   * matching DB fragment, returning a new field carrying the refined schema. */
  private constrain(
    method: keyof CheckableSchema,
    arg: number | RegExp,
    frag: string,
  ): SField<S, Flags> {
    const apply = (
      this.schema as unknown as Record<
        string,
        (a: number | RegExp) => z.ZodType
      >
    )[method];
    return new SField(apply(arg) as S, {
      ...this.surreal,
      asserts: [...(this.surreal.asserts ?? []), frag],
    });
  }
  /** Set field-level `PERMISSIONS` (no `delete` op). Omitted ops default to FULL. */
  $permissions(spec: FieldPermissions): SField<S, Flags> {
    return new SField(this.schema, { ...this.surreal, permissions: spec });
  }
  $readonly(readonly = true): SField<S, Flags | "readonly"> {
    return new SField(this.schema, { ...this.surreal, readonly });
  }
  $comment(comment: string): SField<S, Flags> {
    return new SField(this.schema, { ...this.surreal, comment });
  }
  /** Index this field — `DEFINE INDEX <table>_<field>_idx ON TABLE <table> FIELDS <field>`. */
  index(): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      index: { ...this.surreal.index },
    });
  }
  /** Index this field with a uniqueness constraint (`… FIELDS <field> UNIQUE`). */
  unique(): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      index: { unique: true },
    });
  }
  /**
   * Mark the field DB-managed and client-hidden. It still emits its `DEFINE FIELD`
   * (so SCHEMAFULL writes from a record-access SIGNUP block succeed) plus
   * `PERMISSIONS NONE`, but is excluded from the public app/create/update surface.
   * Reach internal fields via the `.system` view (server/system code).
   */
  $internal(): SField<S, Flags | "internal"> {
    return new SField(this.schema, { ...this.surreal, internal: true });
  }
}

/** A flag-agnostic SField, for internal storage where flags don't matter. */
type AnyField = SField<z.ZodType, string>;

// --- Surreal-native field schemas ---

/** Surreal `datetime` <-> JS `Date` (a real codec — the types differ). */
function datetimeCodec() {
  const codec = z.codec(z.instanceof(DateTime), z.date(), {
    decode: (dt) => new Date(dt.toString()),
    encode: (d) => new DateTime(d),
  });
  surrealTypeRegistry.set(codec, "datetime");
  return codec;
}

/** Register a schema's SurrealQL type and return it (for instanceof-backed native types). */
function native<T>(schema: z.ZodType<T>, surrealType: string): z.ZodType<T, T> {
  surrealTypeRegistry.set(schema, surrealType);
  return schema as z.ZodType<T, T>;
}

/** Surreal `uuid` <-> JS `string` (a codec: app `string`, DB `Uuid`). */
function uuidCodec() {
  const codec = z.codec(z.instanceof(Uuid), z.uuid(), {
    decode: (u) => u.toString(),
    encode: (s) => new Uuid(s),
  });
  surrealTypeRegistry.set(codec, "uuid");
  return codec;
}

/** Surreal `bytes` <-> JS `Uint8Array` (the DB may return an ArrayBuffer; normalize it). */
function bytesCodec() {
  const codec = z.codec(
    z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]),
    z.instanceof(Uint8Array),
    {
      decode: (b) => (b instanceof Uint8Array ? b : new Uint8Array(b)),
      encode: (u) => u,
    },
  );
  surrealTypeRegistry.set(codec, "bytes");
  return codec;
}

type GeometryKind =
  | "point"
  | "line"
  | "polygon"
  | "multipoint"
  | "multiline"
  | "multipolygon"
  | "collection";

/** A `RecordId` restricted to `tables` (+ optional id-value type). Identity, so no codec. */
function recordIdSchema<
  T extends string,
  V extends RecordIdValue = RecordIdValue,
>(
  tables: T[],
  valueType?: z.ZodType<V>,
): z.ZodType<RecordId<T, V>, RecordId<T, V>> {
  // Empty `tables` = an unrestricted `record` (any table) — used for endpoint-less relations.
  const anyTable = tables.length === 0;
  const schema = z.instanceof(RecordId).refine(
    // RecordId.table is a Table object; .name is the unescaped name.
    (r) =>
      (anyTable || (tables as readonly string[]).includes(r.table.name)) &&
      (valueType ? valueType.safeParse(r.id).success : true),
    {
      error: anyTable
        ? "Expected a record"
        : `Expected record<${tables.join(" | ")}>`,
    },
  );
  surrealTypeRegistry.set(
    schema,
    anyTable ? "record" : `record<${tables.join(" | ")}>`,
  );
  return schema as unknown as z.ZodType<RecordId<T, V>, RecordId<T, V>>;
}

/** A `record<…>` field: table restriction (+ optional id-value type) and construction helpers. */
export class RecordIdField<
  T extends string,
  V extends RecordIdValue = RecordIdValue,
> extends SField<z.ZodType<RecordId<T, V>, RecordId<T, V>>> {
  constructor(
    readonly tables: T[],
    readonly valueType?: z.ZodType<V>,
    surreal: SurrealMeta = {},
  ) {
    super(recordIdSchema<T, V>(tables, valueType), surreal);
  }

  /** Restrict the id value's type — reflected as `RecordId<T, V>` and validated at runtime. */
  type<V2 extends RecordIdValue>(schema: z.ZodType<V2>): RecordIdField<T, V2> {
    return new RecordIdField<T, V2>(this.tables, schema, this.surreal);
  }

  /** Build a RecordId. Single-table: `make(id)`; multi-table: `make(table, id)`. */
  make(idOrTable: V | T, id?: V): RecordId<T, V> {
    return (
      id === undefined
        ? new RecordId(this.tables[0]!, idOrTable as V)
        : new RecordId(idOrTable as T, id)
    ) as RecordId<T, V>;
  }

  /** A record-id range for queries (default: inclusive start .. exclusive end). */
  range(from?: V | Bound<V>, to?: V | Bound<V>): RecordIdRange<T, V> {
    // `undefined` -> an open bound (`user:..x` / `user:x..`); otherwise wrap the value
    // (default inclusive start, exclusive end). Pass a Bound to override inclusivity.
    const bound = (b: V | Bound<V> | undefined, exclusive: boolean) =>
      b === undefined
        ? undefined
        : b instanceof BoundIncluded || b instanceof BoundExcluded
          ? b
          : exclusive
            ? new BoundExcluded(b)
            : new BoundIncluded(b);
    return new RecordIdRange(
      this.tables[0]!,
      bound(from, false) as Bound<RecordIdValue>,
      bound(to, true) as Bound<RecordIdValue>,
    ) as RecordIdRange<T, V>;
  }
}

/** Unwrap an SField to its Zod schema (raw Zod schemas pass through). */
const toZod = (v: AnyField | z.ZodType): z.ZodType =>
  v instanceof SField ? v.schema : v;
type ZodsOf<T extends readonly (AnyField | z.ZodType)[]> = {
  -readonly [K in keyof T]: SchemaOf<T[K]>;
};

/** Field constructors — the authoring surface. */
export const sz = {
  string: () => new SField(z.string()),
  number: () => new SField(z.number()),
  boolean: () => new SField(z.boolean()),
  // String formats — all map to DDL `string` (their Zod def.type is "string"). Builders
  // whose `string::is_<fmt>` validator exists on SurrealDB bake that ASSERT by default
  // (see STRING_IS_FORMATS); the rest stay assert-free (no fabricated regex).
  email: () => formatField(z.email(), "email"),
  url: (params?: Parameters<typeof z.url>[0]) =>
    formatField(z.url(params), "url"),
  /** Surreal native `uuid`: a `string` app-side, stored as a `Uuid` (no ASSERT — native type). */
  uuid: () => new SField(uuidCodec()),
  guid: (params?: Parameters<typeof z.guid>[0]) =>
    formatField(z.guid(params), "guid"),
  nanoid: (params?: Parameters<typeof z.nanoid>[0]) =>
    formatField(z.nanoid(params), "nanoid"),
  cuid: (params?: Parameters<typeof z.cuid>[0]) =>
    formatField(z.cuid(params), "cuid"),
  cuid2: (params?: Parameters<typeof z.cuid2>[0]) =>
    formatField(z.cuid2(params), "cuid2"),
  ulid: (params?: Parameters<typeof z.ulid>[0]) =>
    formatField(z.ulid(params), "ulid"),
  xid: (params?: Parameters<typeof z.xid>[0]) =>
    formatField(z.xid(params), "xid"),
  ksuid: (params?: Parameters<typeof z.ksuid>[0]) =>
    formatField(z.ksuid(params), "ksuid"),
  ipv4: (params?: Parameters<typeof z.ipv4>[0]) =>
    formatField(z.ipv4(params), "ipv4"),
  ipv6: (params?: Parameters<typeof z.ipv6>[0]) =>
    formatField(z.ipv6(params), "ipv6"),
  cidrv4: (params?: Parameters<typeof z.cidrv4>[0]) =>
    formatField(z.cidrv4(params), "cidrv4"),
  cidrv6: (params?: Parameters<typeof z.cidrv6>[0]) =>
    formatField(z.cidrv6(params), "cidrv6"),
  base64: (params?: Parameters<typeof z.base64>[0]) =>
    formatField(z.base64(params), "base64"),
  base64url: (params?: Parameters<typeof z.base64url>[0]) =>
    formatField(z.base64url(params), "base64url"),
  e164: (params?: Parameters<typeof z.e164>[0]) =>
    formatField(z.e164(params), "e164"),
  jwt: (params?: Parameters<typeof z.jwt>[0]) =>
    formatField(z.jwt(params), "jwt"),
  emoji: (params?: Parameters<typeof z.emoji>[0]) =>
    formatField(z.emoji(params), "emoji"),

  // Numbers. int/int32/uint32 -> DDL `int`; float -> DDL `float` (def.format-driven).
  int: (params?: Parameters<typeof z.int>[0]) => new SField(z.int(params)),
  float: (params?: Parameters<typeof z.float64>[0]) =>
    new SField(z.float64(params)),
  int32: (params?: Parameters<typeof z.int32>[0]) =>
    new SField(z.int32(params)),
  uint32: (params?: Parameters<typeof z.uint32>[0]) =>
    new SField(z.uint32(params)),
  bigint: (params?: Parameters<typeof z.bigint>[0]) =>
    new SField(z.bigint(params)),

  datetime: () => new SField(datetimeCodec()),
  /** Alias of `datetime` (Surreal stores a `datetime`; there is no plain date). */
  date: () => new SField(datetimeCodec()),
  /** Surreal `duration` (a `Duration` instance). */
  duration: () => new SField(native(z.instanceof(Duration), "duration")),
  /** Surreal `decimal` (a `Decimal` instance — arbitrary precision). */
  decimal: () => new SField(native(z.instanceof(Decimal), "decimal")),
  /** Surreal `bytes` (a `Uint8Array`). */
  bytes: () => new SField(bytesCodec()),
  /** Surreal `file` (a `FileRef`). */
  file: () => new SField(native(z.instanceof(FileRef), "file")),
  /** Surreal `geometry` (a `Geometry`), optionally narrowed to a kind. */
  geometry: (kind?: GeometryKind) =>
    new SField(
      native(z.instanceof(Geometry), kind ? `geometry<${kind}>` : "geometry"),
    ),
  recordId: <T extends string>(table: T | T[]) =>
    new RecordIdField<T>(Array.isArray(table) ? table : [table]),
  /**
   * A nested object whose fields keep their surreal metadata + native types. The returned
   * schema TYPE carries the original shape `S` via the `~szShape` brand (type-only — runtime
   * is unchanged) so `CreateValue`/`ShapeOf` can recover the nested fields' create-flags
   * (e.g. a nested `$default`) and make them create-optional. The brand survives every
   * `$`-method and Zod wrapper (`.optional()`/`.array()`/`.$default()`), which all reuse
   * `this.schema`.
   */
  object: <S extends Shape>(shape: S): SField<SZObject<S>> => {
    const fields: Record<string, AnyField> = {};
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, v] of Object.entries(shape)) {
      const f = v instanceof SField ? v : new SField(v);
      fields[k] = f;
      zshape[k] = f.schema;
    }
    const schema = z.object(zshape) as SZObject<S>;
    objectFieldsRegistry.set(schema, fields);
    return new SField(schema);
  },
  /** An array of `element` (an SField or a raw Zod schema). */
  array: <F extends AnyField | z.ZodType>(
    element: F,
  ): SField<z.ZodArray<SchemaOf<F>>> =>
    (element instanceof SField
      ? element
      : new SField(element)
    ).array() as SField<z.ZodArray<SchemaOf<F>>>,
  /** A literal value type. */
  literal: <const T extends string | number | boolean | bigint>(value: T) =>
    new SField(z.literal(value)),
  /** A string enum. */
  enum: <const T extends readonly [string, ...string[]]>(values: T) =>
    new SField(z.enum(values)),
  /** A union of fields/schemas. */
  union: <
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    options: T,
  ): SField<z.ZodUnion<ZodsOf<T>>> =>
    new SField(z.union(options.map(toZod) as ZodsOf<T>)),
  /** A fixed-length tuple of fields/schemas. */
  tuple: <
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    items: T,
  ): SField<z.ZodTuple<ZodsOf<T>>> =>
    new SField(z.tuple(items.map(toZod) as ZodsOf<T>)),

  /** An open-keyed record `record<key, value>` -> SurrealQL `object` with a `.*` value field. */
  record: <K extends z.core.$ZodRecordKey, V extends AnyField | z.ZodType>(
    key: K,
    value: V,
  ): SField<z.ZodRecord<K, SchemaOf<V>>> =>
    new SField(z.record(key, toZod(value) as SchemaOf<V>)),
  /** A `Map<key, value>` -> SurrealQL `object` with a `.*` value field. */
  map: <K extends AnyField | z.ZodType, V extends AnyField | z.ZodType>(
    key: K,
    value: V,
  ): SField<z.ZodMap<SchemaOf<K>, SchemaOf<V>>> =>
    new SField(z.map(toZod(key) as SchemaOf<K>, toZod(value) as SchemaOf<V>)),
  /** A `Set<element>` -> SurrealQL `array<element>`. */
  set: <V extends AnyField | z.ZodType>(
    element: V,
  ): SField<z.ZodSet<SchemaOf<V>>> =>
    new SField(z.set(toZod(element) as SchemaOf<V>)),
  /** The intersection of two schemas (object fields are merged in DDL). */
  intersection: <
    A extends AnyField | z.ZodType,
    B extends AnyField | z.ZodType,
  >(
    a: A,
    b: B,
  ): SField<z.ZodIntersection<SchemaOf<A>, SchemaOf<B>>> =>
    new SField(
      z.intersection(toZod(a) as SchemaOf<A>, toZod(b) as SchemaOf<B>),
    ),
  /** A lazily-resolved schema/field (for recursive types). */
  lazy: <V extends AnyField | z.ZodType>(
    getter: () => V,
  ): SField<z.ZodLazy<SchemaOf<V>>> =>
    new SField(z.lazy(() => toZod(getter()) as SchemaOf<V>)),

  /** A native TS enum — string or numeric (numeric reverse-mappings are filtered out). */
  nativeEnum: <const T extends Record<string, string | number>>(entries: T) =>
    new SField(z.nativeEnum(entries)),
  /** A discriminated union of object schemas/fields -> DDL `object`. */
  discriminatedUnion: <
    Disc extends string,
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    discriminator: Disc,
    options: T,
  ): SField<z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>> =>
    new SField(
      z.discriminatedUnion(
        discriminator,
        options.map(toZod) as never,
      ) as unknown as z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>,
    ),

  /** Wrap a field/schema as optional (constructor form of `.optional()`). */
  optional: <F extends AnyField | z.ZodType>(
    field: F,
  ): SField<z.ZodOptional<SchemaOf<F>>, FlagsOf<F>> =>
    (field instanceof SField ? field : new SField(field)).optional() as SField<
      z.ZodOptional<SchemaOf<F>>,
      FlagsOf<F>
    >,
  /** Wrap a field/schema as nullable (constructor form of `.nullable()`). */
  nullable: <F extends AnyField | z.ZodType>(
    field: F,
  ): SField<z.ZodNullable<SchemaOf<F>>, FlagsOf<F>> =>
    (field instanceof SField ? field : new SField(field)).nullable() as SField<
      z.ZodNullable<SchemaOf<F>>,
      FlagsOf<F>
    >,

  // Catch-alls.
  any: () => new SField(z.any()),
  unknown: () => new SField(z.unknown()),
  null: () => new SField(z.null()),
};

// --- Tables & relations ---

export type Shape = Record<string, AnyField | z.ZodType>;
type SchemaOf<F> =
  F extends SField<infer S, infer _> ? S : F extends z.ZodType ? F : never;
type FlagsOf<F> = F extends SField<z.ZodType, infer Fl> ? Fl : never;
/**
 * Whether a field carries the `"internal"` flag (set by `.$internal()`). The
 * `string extends FlagsOf<F>` guard short-circuits the broad `Shape` case (where
 * flags widen to `string`, and `"internal" extends string` would wrongly be true),
 * so `ZShape<Shape>` keeps every key for shape-agnostic refs like `TableDef<string, Shape>`.
 */
type IsInternal<F> =
  string extends FlagsOf<F>
    ? false
    : "internal" extends FlagsOf<F>
      ? true
      : false;
/** The public zshape — internal fields are excluded (see `ZShapeAll` for the system view). */
type ZShape<S extends Shape> = {
  [K in keyof S as IsInternal<S[K]> extends true ? never : K]: SchemaOf<S[K]>;
};
/** Every field's zshape, including internal ones — backs the `.system` view. */
type ZShapeAll<S extends Shape> = { [K in keyof S]: SchemaOf<S[K]> };
/**
 * The schema type returned by `sz.object`: a plain `z.ZodObject` carrying its original
 * `Shape` via a type-only `~szShape` brand. The brand is optional, so the runtime cast
 * (`z.object(...) as SZObject<S>`) is sound and the brand is invisible to `z.input`/
 * `z.output`/`App`/`Wire` — nested fields stay REQUIRED on the decoded side. It exists
 * solely so `ShapeOf`/`CreateValue` can recover the nested shape for the create surface.
 */
type SZObject<S extends Shape> = z.ZodObject<ZShape<S>> & {
  readonly "~szShape"?: S;
};
type ToField<F> =
  F extends SField<infer Sc, infer Fl> ? SField<Sc, Fl> : SField<SchemaOf<F>>;
type Fields<S extends Shape> = { [K in keyof S]: ToField<S[K]> };
type Unwrap<F> =
  F extends SField<z.ZodOptional<infer Inner extends z.ZodType>, infer Fl>
    ? SField<Inner, Fl>
    : F;
type PartialShape<S extends Shape> = {
  [K in keyof S]: SField<z.ZodOptional<SchemaOf<S[K]>>, FlagsOf<S[K]>>;
};
type RequiredShape<S extends Shape> = { [K in keyof S]: Unwrap<Fields<S>[K]> };

export interface TableConfig {
  schemafull: boolean;
  /** Table `TYPE`: `normal` (default) or `any` (holds both records and graph edges). */
  type?: "normal" | "any";
  drop?: boolean;
  comment?: string;
  /** Table-level `PERMISSIONS`. Omitted ops default to NONE in SurrealDB. See `.permissions()`. */
  permissions?: TablePermissions;
  relation?: { from: string[]; to: string[] };
  /** Composite (multi-field) indexes. See `.index(name, fields, opts)`. */
  indexes?: TableIndex[];
  /** Row-change events. See `.event(name, { when?, then })`. */
  events?: TableEvent[];
}

/** A table index definition (single- or multi-field). */
export interface TableIndex {
  name: string;
  fields: string[];
  unique?: boolean;
}

/** A SurrealQL expression: a `surql\`…\`` bound query (bindings inlined) or a raw string. */
export type Expr = BoundQuery | string;

/**
 * A table event: `DEFINE EVENT <name> ON TABLE <table> [WHEN <when>] THEN <then>`. The event
 * body sees `$before`/`$after`/`$event`/`$value`. `then` may be one expression or several
 * (run in order). Author expressions with `surql\`…\`` (bindings inline) or a raw string.
 */
export interface TableEvent {
  name: string;
  when?: Expr;
  then: Expr | Expr[];
}

function normalizeFields<S extends Shape>(shape: S): Fields<S> {
  const out: Record<string, AnyField> = {};
  for (const [k, v] of Object.entries(shape)) {
    out[k] = v instanceof SField ? v : new SField(v);
  }
  return out as unknown as Fields<S>;
}

/** The wrappers `safeEncodeValue` peels to reach a schema registered in `objectFieldsRegistry`
 * (and the array element) — the same identity-preserving set `ShapeOf` strips at the type
 * level. `array` is intentionally NOT peeled (it's handled separately). */
const ENCODE_PEEL = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "catch",
  "readonly",
]);

/** Peel identity-preserving wrappers off a schema to reach its core (registered) schema. */
function unwrapCore(schema: z.ZodType): z.ZodType {
  let s = schema;
  while (ENCODE_PEEL.has((s._zod.def as { type: string }).type)) {
    const inner = (s._zod.def as { innerType?: z.ZodType }).innerType;
    if (!inner) break;
    s = inner;
  }
  return s;
}

/** If `core` is a `ZodArray` whose (unwrapped) element is a registered `sz.object`, return
 * that element's fields; otherwise undefined. */
function arrayElementFields(
  core: z.ZodType,
): Record<string, AnyField> | undefined {
  if ((core._zod.def as { type: string }).type !== "array") return undefined;
  const element = (core._zod.def as { element?: z.ZodType }).element;
  if (!element) return undefined;
  return objectFieldsRegistry.get(unwrapCore(element));
}

/**
 * Validate + encode one provided field value to its wire form (non-throwing — the shared core
 * of both `encode` and `safeEncode`). A nested `sz.object` (or an array of one) recurses via
 * `safeEncodeInput`, so absent nested keys are OMITTED — on CREATE the DB fills their defaults;
 * on UPDATE `encodePartial` is deep-partial and pairs with `MERGE` (which deep-merges), so
 * omitted siblings are preserved. Leaf fields go through `z.safeEncode` (which validates);
 * issues are pushed into `issues` with their path prefixed by `path`, so the aggregate
 * `ZodError` carries fully-qualified paths. Object-LEVEL refinements on a nested `sz.object`
 * are skipped (rare; leaf validation still runs).
 */
function safeEncodeValue(
  field: AnyField,
  v: unknown,
  path: PropertyKey[],
  issues: z.core.$ZodIssue[],
): unknown {
  const core = unwrapCore(field.schema);
  const nested = objectFieldsRegistry.get(core);
  if (nested)
    return safeEncodeInput(nested, v as Record<string, unknown>, path, issues);
  const elem = arrayElementFields(core);
  if (elem) {
    return (v as unknown[]).map((el, i) =>
      safeEncodeInput(
        elem,
        el as Record<string, unknown>,
        [...path, i],
        issues,
      ),
    );
  }
  const res = z.safeEncode(field.schema, v as never);
  if (res.success) return res.data;
  for (const issue of res.error.issues)
    issues.push({ ...issue, path: [...path, ...issue.path] });
  return undefined;
}

/** Recurse over the provided keys (see `safeEncodeValue`), omitting absent (`undefined`) ones,
 * building the wire object and collecting issues. */
function safeEncodeInput(
  fields: Record<string, AnyField>,
  input: Record<string, unknown>,
  path: PropertyKey[],
  issues: z.core.$ZodIssue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const field = fields[k];
    out[k] = field ? safeEncodeValue(field, v, [...path, k], issues) : v;
  }
  return out;
}

/**
 * The core of `safeEncode`/`safeEncodePartial` AND `encode`/`encodePartial`: validate+encode
 * the PROVIDED keys, aggregating every leaf issue (with correct paths) into one `z.ZodError`.
 * `safeEncode` returns the result; `encode` throws `error` (so `encode` and `safeEncode` are
 * the same operation — `encode` = `safeEncode` + throw — including for a PARTIAL nested
 * `sz.object`).
 */
function safeEncodeFields(
  fields: Record<string, AnyField>,
  input: Record<string, unknown>,
): z.ZodSafeParseResult<unknown> {
  const issues: z.core.$ZodIssue[] = [];
  const data = safeEncodeInput(fields, input, [], issues);
  return issues.length > 0
    ? { success: false, error: new z.ZodError(issues) }
    : { success: true, data };
}

/** Async mirror of `safeEncodeValue` — awaits `z.safeEncodeAsync` per leaf and recurses into a
 * nested `sz.object` (or array of one) via `safeEncodeInputAsync`. Backs the `*Async` writes. */
async function safeEncodeValueAsync(
  field: AnyField,
  v: unknown,
  path: PropertyKey[],
  issues: z.core.$ZodIssue[],
): Promise<unknown> {
  const core = unwrapCore(field.schema);
  const nested = objectFieldsRegistry.get(core);
  if (nested)
    return safeEncodeInputAsync(
      nested,
      v as Record<string, unknown>,
      path,
      issues,
    );
  const elem = arrayElementFields(core);
  if (elem) {
    return Promise.all(
      (v as unknown[]).map((el, i) =>
        safeEncodeInputAsync(
          elem,
          el as Record<string, unknown>,
          [...path, i],
          issues,
        ),
      ),
    );
  }
  const res = await z.safeEncodeAsync(field.schema, v as never);
  if (res.success) return res.data;
  for (const issue of res.error.issues)
    issues.push({ ...issue, path: [...path, ...issue.path] });
  return undefined;
}

/** Async mirror of `safeEncodeInput` — recurse over the provided keys, omitting absent ones. */
async function safeEncodeInputAsync(
  fields: Record<string, AnyField>,
  input: Record<string, unknown>,
  path: PropertyKey[],
  issues: z.core.$ZodIssue[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    const field = fields[k];
    out[k] = field
      ? await safeEncodeValueAsync(field, v, [...path, k], issues)
      : v;
  }
  return out;
}

/** Async mirror of `safeEncodeFields` — backs `safeEncodeAsync`/`encodeAsync` (run + throw). */
async function safeEncodeFieldsAsync(
  fields: Record<string, AnyField>,
  input: Record<string, unknown>,
): Promise<z.ZodSafeParseResult<unknown>> {
  const issues: z.core.$ZodIssue[] = [];
  const data = await safeEncodeInputAsync(fields, input, [], issues);
  return issues.length > 0
    ? { success: false, error: new z.ZodError(issues) }
    : { success: true, data };
}

// --- Create / Update input shapes ---
type Prettify<T> = { [K in keyof T]: T[K] } & {};
type AppOf<F> = z.output<SchemaOf<F>>;
type InputOptional<F> = undefined extends z.input<SchemaOf<F>> ? true : false;

/**
 * Recover the nested `Shape` of an `sz.object` schema (`never` if the schema isn't one).
 * Identity-preserving wrappers (optional/default/readonly/nullable) are peeled first, then
 * the `~szShape` brand is read. The inner `NS extends Shape ? NS : never` drops the
 * `| undefined` that inferring from an optional property can introduce, so the result is the
 * clean shape — or `never` for any non-object schema.
 */
type ShapeOf<Sc> =
  Sc extends z.ZodOptional<infer I>
    ? ShapeOf<I>
    : Sc extends z.ZodDefault<infer I>
      ? ShapeOf<I>
      : Sc extends z.ZodReadonly<infer I>
        ? ShapeOf<I>
        : Sc extends z.ZodNullable<infer I>
          ? ShapeOf<I>
          : Sc extends { "~szShape"?: infer NS }
            ? NS extends Shape
              ? NS
              : never
            : never;

/**
 * The element `Shape` of an `sz.object(...).array()` field (`never` otherwise). Peels the
 * same identity-preserving wrappers off the array, then reads the element's `~szShape`.
 */
type ArrayShapeOf<Sc> =
  Sc extends z.ZodOptional<infer I>
    ? ArrayShapeOf<I>
    : Sc extends z.ZodDefault<infer I>
      ? ArrayShapeOf<I>
      : Sc extends z.ZodReadonly<infer I>
        ? ArrayShapeOf<I>
        : Sc extends z.ZodNullable<infer I>
          ? ArrayShapeOf<I>
          : Sc extends z.ZodArray<infer E>
            ? ShapeOf<E>
            : never;

/**
 * The create-input VALUE type for a field. A nested `sz.object` recurses into its own
 * `CreateShape` (so nested `$default`/`"create"` fields become optional too); an array of
 * `sz.object` becomes that nested create-shape's array; everything else is the plain app
 * type (`AppOf`). `[X] extends [never]` guards each branch because `never extends Shape` is
 * vacuously true and would otherwise wrongly match the object branch for scalar fields.
 */
type CreateValue<F, Sc = SchemaOf<F>> = [ShapeOf<Sc>] extends [never]
  ? [ArrayShapeOf<Sc>] extends [never]
    ? AppOf<F>
    : ArrayShapeOf<Sc> extends infer ENS extends Shape
      ? CreateShape<ENS>[]
      : AppOf<F>
  : ShapeOf<Sc> extends infer NS extends Shape
    ? CreateShape<NS>
    : AppOf<F>;

type CreateOptional<S extends Shape, K extends keyof S> = K extends "id"
  ? true
  : "create" extends FlagsOf<S[K]>
    ? true
    : InputOptional<S[K]>;
// Public create input: internal fields are never settable by clients. Field VALUES use
// `CreateValue` so a nested `sz.object`'s own create-optional fields (a nested `$default`)
// are optional too — while `CreateOptional` (the `?` modifier) is unchanged.
type CreateShape<S extends Shape> = Prettify<
  {
    [K in keyof S as IsInternal<S[K]> extends true
      ? never
      : CreateOptional<S, K> extends true
        ? never
        : K]: CreateValue<S[K]>;
  } & {
    [K in keyof S as IsInternal<S[K]> extends true
      ? never
      : CreateOptional<S, K> extends true
        ? K
        : never]?: CreateValue<S[K]>;
  }
>;
// System create input: includes internal fields (the old, all-fields behavior).
type CreateShapeAll<S extends Shape> = Prettify<
  {
    [K in keyof S as CreateOptional<S, K> extends true
      ? never
      : K]: CreateValue<S[K]>;
  } & {
    [K in keyof S as CreateOptional<S, K> extends true
      ? K
      : never]?: CreateValue<S[K]>;
  }
>;

type UpdateExcluded<S extends Shape, K extends keyof S> = K extends "id"
  ? true
  : "readonly" extends FlagsOf<S[K]>
    ? true
    : false;
/**
 * The update-input VALUE type for a field — a DEEP partial, since `MERGE` recursively
 * deep-merges nested objects (so any subset of nested keys is a valid patch). A nested
 * `sz.object` recurses into its own `UpdateShape` (every nested field optional); an array
 * of `sz.object` becomes that update-shape's array; everything else is the plain app type
 * (`AppOf`). The `[X] extends [never]` guards mirror `CreateValue` (so scalar fields don't
 * wrongly match the object branch via `never extends Shape`).
 */
type UpdateValue<F, Sc = SchemaOf<F>> = [ShapeOf<Sc>] extends [never]
  ? [ArrayShapeOf<Sc>] extends [never]
    ? AppOf<F>
    : ArrayShapeOf<Sc> extends infer ENS extends Shape
      ? UpdateShape<ENS>[]
      : AppOf<F>
  : ShapeOf<Sc> extends infer NS extends Shape
    ? UpdateShape<NS>
    : AppOf<F>;
// Public update input: internal fields are excluded. Field VALUES use `UpdateValue` so a
// nested `sz.object` is itself a deep partial (every nested key optional), matching MERGE.
type UpdateShape<S extends Shape> = Prettify<{
  [K in keyof S as IsInternal<S[K]> extends true
    ? never
    : UpdateExcluded<S, K> extends true
      ? never
      : K]?: UpdateValue<S[K]>;
}>;
// System update input: includes internal fields (the old, all-fields behavior).
type UpdateShapeAll<S extends Shape> = Prettify<{
  [K in keyof S as UpdateExcluded<S, K> extends true ? never : K]?: UpdateValue<
    S[K]
  >;
}>;

/** A Zod-style non-throwing result: `{ success: true; data }` | `{ success: false; error }`
 * (mirrors `z.safeEncode`/`z.safeDecode`). */
type SafeResult<T> = z.ZodSafeParseResult<T>;
/** The wire payload `encode`/`safeEncode` build: the provided keys' wire (`z.input`) types. Only
 * the supplied keys are present at runtime, hence `Partial`. */
type MakeWire<S extends Shape> = Partial<z.input<z.ZodObject<ZShape<S>>>>;
/** Same, over ALL fields — the `.system` view includes `$internal()` ones. */
type MakeWireAll<S extends Shape> = Partial<z.input<z.ZodObject<ZShapeAll<S>>>>;

/** A table (or relation) definition: shape + DDL config, with chainable builders. */
export class TableDef<Name extends string, S extends Shape> {
  /** Zod object over the inner schemas — drives validation, encode/decode, types. */
  readonly object: z.ZodObject<ZShape<S>>;

  constructor(
    readonly name: Name,
    readonly fields: Fields<S>,
    readonly config: TableConfig = { schemafull: true },
  ) {
    // Public object skips internal fields (zod also strips unknown keys — double-safe);
    // `emitTable` still iterates ALL `this.fields`, so internal fields stay in the DDL.
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, f] of Object.entries(fields)) {
      if ((f as AnyField).surreal.internal) continue;
      zshape[k] = (f as AnyField).schema;
    }
    this.object = z.object(zshape) as z.ZodObject<ZShape<S>>;
  }

  get kind(): "table" | "relation" {
    return this.config.relation ? "relation" : "table";
  }

  /** DB wire row -> app object. */
  decode(row: unknown): z.output<z.ZodObject<ZShape<S>>> {
    return z.decode(this.object, row as never);
  }
  /** DB wire row -> app object (async — for async refinements). */
  decodeAsync(row: unknown): Promise<z.output<z.ZodObject<ZShape<S>>>> {
    return z.decodeAsync(this.object, row as never);
  }

  // No-throw read variants — return { success, data } | { success, error }.
  safeDecode(row: unknown) {
    return z.safeDecode(this.object, row as never);
  }
  safeDecodeAsync(row: unknown) {
    return z.safeDecodeAsync(this.object, row as never);
  }

  // Deprecated Zod-style aliases. For codecs `parse` runs the DECODE direction (wire -> app),
  // so it's just `decode` under a misleading name — prefer `decode` (and `encode` for create
  // payloads). Kept for `z`-API familiarity; editors will strike them through.
  /** @deprecated `parse` decodes a DB row (wire -> app). Use {@link TableDef.decode | decode}. */
  parse(row: unknown): z.output<z.ZodObject<ZShape<S>>> {
    return this.decode(row);
  }
  /** @deprecated Use {@link TableDef.safeDecode | safeDecode} (or {@link TableDef.safeEncode | safeEncode} to validate an app object). */
  safeParse(row: unknown) {
    return this.safeDecode(row);
  }
  /** @deprecated Use {@link TableDef.decodeAsync | decodeAsync}. */
  parseAsync(row: unknown): Promise<z.output<z.ZodObject<ZShape<S>>>> {
    return this.decodeAsync(row);
  }
  /** @deprecated Use {@link TableDef.safeDecodeAsync | safeDecodeAsync}. */
  safeParseAsync(row: unknown) {
    return this.safeDecodeAsync(row);
  }

  // --- Write side (app -> wire). `encode`/`encodePartial` are create/patch-shaped: DB-filled
  // (`$default`/`id`) fields are optional (the DB fills them), absent keys are OMITTED, and each
  // provided leaf is validated via the recursive encoder. The raw full-object codec (no create-
  // shaping) is `z.encode(table.object, app)` if ever needed. ---

  /**
   * Build a wire payload for `CREATE` (DB-filled fields optional). Validates+encodes each
   * provided field — so this VALIDATES and THROWS the aggregated `z.ZodError` on invalid
   * input. Use `safeEncode` for the non-throwing form.
   */
  encode(input: CreateShape<S>): MakeWire<S> {
    const r = this.safeEncode(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /**
   * Build a wire payload for `UPDATE`/`MERGE` (a partial patch; excludes id/readonly).
   * VALIDATES and THROWS on invalid input; use `safeEncodePartial` for the non-throwing form.
   */
  encodePartial(input: UpdateShape<S>): MakeWire<S> {
    const r = this.safeEncodePartial(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /**
   * Non-throwing `encode`: validates+encodes the provided keys and returns a Zod-style
   * `{ success: true; data }` | `{ success: false; error }`. All field errors are
   * aggregated (with correct paths) into a single `z.ZodError`.
   */
  safeEncode(input: CreateShape<S>): SafeResult<MakeWire<S>> {
    return safeEncodeFields(
      this.fields as unknown as Record<string, AnyField>,
      input as Record<string, unknown>,
    ) as SafeResult<MakeWire<S>>;
  }
  /** Non-throwing `encodePartial` (see `safeEncode`). */
  safeEncodePartial(input: UpdateShape<S>): SafeResult<MakeWire<S>> {
    return safeEncodeFields(
      this.fields as unknown as Record<string, AnyField>,
      input as Record<string, unknown>,
    ) as SafeResult<MakeWire<S>>;
  }
  /** Async `encode` (awaits async refinements per leaf); throws the aggregated error. */
  async encodeAsync(input: CreateShape<S>): Promise<MakeWire<S>> {
    const r = await this.safeEncodeAsync(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /** Async `encodePartial`; throws the aggregated error. */
  async encodePartialAsync(input: UpdateShape<S>): Promise<MakeWire<S>> {
    const r = await this.safeEncodePartialAsync(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /** Non-throwing async `encode` (see `safeEncode`). */
  safeEncodeAsync(input: CreateShape<S>): Promise<SafeResult<MakeWire<S>>> {
    return safeEncodeFieldsAsync(
      this.fields as unknown as Record<string, AnyField>,
      input as Record<string, unknown>,
    ) as Promise<SafeResult<MakeWire<S>>>;
  }
  /** Non-throwing async `encodePartial`. */
  safeEncodePartialAsync(
    input: UpdateShape<S>,
  ): Promise<SafeResult<MakeWire<S>>> {
    return safeEncodeFieldsAsync(
      this.fields as unknown as Record<string, AnyField>,
      input as Record<string, unknown>,
    ) as Promise<SafeResult<MakeWire<S>>>;
  }

  /**
   * The server/system view: the same table over ALL fields, including `$internal()`
   * ones the public surface hides. Use it in trusted server code that must read or
   * write internal fields (e.g. a `passhash`).
   */
  get system(): SystemView<Name, S> {
    return new SystemView<Name, S>(
      this.fields as unknown as Record<string, AnyField>,
    );
  }

  // --- DDL config (chainable, immutable) ---
  private withConfig(config: Partial<TableConfig>): TableDef<Name, S> {
    return new TableDef(this.name, this.fields, { ...this.config, ...config });
  }
  schemafull() {
    return this.withConfig({ schemafull: true });
  }
  schemaless() {
    return this.withConfig({ schemafull: false });
  }
  /** `TYPE ANY` — the table may hold both normal records and graph edges. */
  typeAny() {
    return this.withConfig({ type: "any" });
  }
  drop(drop = true) {
    return this.withConfig({ drop });
  }
  comment(comment: string) {
    return this.withConfig({ comment });
  }
  /** Set table-level `PERMISSIONS` (folded into the single `DEFINE TABLE` head). */
  permissions(spec: TablePermissions) {
    return this.withConfig({ permissions: spec });
  }
  /** Add a composite index: `DEFINE INDEX <name> ON TABLE <table> FIELDS <fields> [UNIQUE]`. */
  index(
    name: string,
    fields: (keyof S & string)[],
    opts: { unique?: boolean } = {},
  ) {
    const index: TableIndex = { name, fields, unique: opts.unique };
    return this.withConfig({
      indexes: [...(this.config.indexes ?? []), index],
    });
  }
  /**
   * Add a row-change event: `DEFINE EVENT <name> ON TABLE <table> [WHEN <when>] THEN <then>`.
   * The body sees `$before`/`$after`/`$event`/`$value`; author with `surql\`…\`` or a raw string.
   */
  event(name: string, spec: { when?: Expr; then: Expr | Expr[] }) {
    // biome-ignore lint/suspicious/noThenProperty: `then` is the SurrealQL THEN clause (a string/BoundQuery), not a PromiseLike.
    const event: TableEvent = { name, when: spec.when, then: spec.then };
    return this.withConfig({
      events: [...(this.config.events ?? []), event],
    });
  }

  // --- Shape ops (mirror Zod's object methods; carry DDL metadata + config) ---
  extend<E extends Shape>(ext: E): TableDef<Name, Omit<S, keyof E> & E> {
    const f: Record<string, AnyField> = {
      ...(this.fields as unknown as Record<string, AnyField>),
      ...normalizeFields(ext),
    };
    return new TableDef(
      this.name,
      f as unknown as Fields<Omit<S, keyof E> & E>,
      this.config,
    );
  }
  pick<K extends keyof S>(...keys: K[]): TableDef<Name, Pick<S, K>> {
    const src = this.fields as unknown as Record<string, AnyField>;
    const f: Record<string, AnyField> = {};
    for (const k of keys) f[k as string] = src[k as string]!;
    return new TableDef(
      this.name,
      f as unknown as Fields<Pick<S, K>>,
      this.config,
    );
  }
  omit<K extends keyof S>(...keys: K[]): TableDef<Name, Omit<S, K>> {
    const f: Record<string, AnyField> = {
      ...(this.fields as unknown as Record<string, AnyField>),
    };
    for (const k of keys) delete f[k as string];
    return new TableDef(
      this.name,
      f as unknown as Fields<Omit<S, K>>,
      this.config,
    );
  }
  partial(): TableDef<Name, PartialShape<S>> {
    const f: Record<string, AnyField> = {};
    for (const [k, field] of Object.entries(this.fields))
      f[k] = (field as AnyField).optional();
    return new TableDef(
      this.name,
      f as unknown as Fields<PartialShape<S>>,
      this.config,
    );
  }
  required(): TableDef<Name, RequiredShape<S>> {
    const f: Record<string, AnyField> = {};
    for (const [k, field] of Object.entries(this.fields)) {
      const sf = field as AnyField;
      const def = sf.schema._zod.def as unknown as {
        type: string;
        innerType?: z.ZodType;
      };
      f[k] =
        def.type === "optional" && def.innerType
          ? new SField(def.innerType, sf.surreal)
          : sf;
    }
    return new TableDef(
      this.name,
      f as unknown as Fields<RequiredShape<S>>,
      this.config,
    );
  }

  /** Derive a `record<name>` link to this table (carrying its id value type). */
  record(): S extends { id: RecordIdField<Name, infer V> }
    ? RecordIdField<Name, V>
    : RecordIdField<Name> {
    const idField = (this.fields as unknown as Record<string, AnyField>).id as
      | RecordIdField<Name>
      | undefined;
    return new RecordIdField([this.name], idField?.valueType) as never;
  }
}

/**
 * The server/system view of a table (`TableDef.system`): the same data methods typed
 * over ALL fields, including `$internal()` ones the public `TableDef` hides. Its
 * `.object` validates/encodes/decodes the full shape, and `encode`/`encodePartial` accept
 * internal fields. Exposed for trusted server code; never hand it to a browser client.
 */
// biome-ignore lint/correctness/noUnusedVariables: Name mirrors TableDef<Name, S> for symmetry (type-only)
export class SystemView<Name extends string, S extends Shape> {
  /** Zod object over ALL fields (internal included). */
  readonly object: z.ZodObject<ZShapeAll<S>>;

  constructor(readonly fields: Record<string, AnyField>) {
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, f] of Object.entries(fields)) zshape[k] = f.schema;
    this.object = z.object(zshape) as z.ZodObject<ZShapeAll<S>>;
  }

  /** DB wire row -> app object (internal fields kept). */
  decode(row: unknown): z.output<z.ZodObject<ZShapeAll<S>>> {
    return z.decode(this.object, row as never);
  }
  /** DB wire row -> app object (async; internal fields kept). */
  decodeAsync(row: unknown): Promise<z.output<z.ZodObject<ZShapeAll<S>>>> {
    return z.decodeAsync(this.object, row as never);
  }

  // No-throw read variants.
  safeDecode(row: unknown) {
    return z.safeDecode(this.object, row as never);
  }
  safeDecodeAsync(row: unknown) {
    return z.safeDecodeAsync(this.object, row as never);
  }

  // Deprecated Zod-style aliases (parse runs the decode direction; use `decode`).
  /** @deprecated `parse` decodes a DB row (wire -> app). Use {@link SystemView.decode | decode}. */
  parse(row: unknown): z.output<z.ZodObject<ZShapeAll<S>>> {
    return this.decode(row);
  }
  /** @deprecated Use {@link SystemView.safeDecode | safeDecode}. */
  safeParse(row: unknown) {
    return this.safeDecode(row);
  }
  /** @deprecated Use {@link SystemView.decodeAsync | decodeAsync}. */
  parseAsync(row: unknown): Promise<z.output<z.ZodObject<ZShapeAll<S>>>> {
    return this.decodeAsync(row);
  }
  /** @deprecated Use {@link SystemView.safeDecodeAsync | safeDecodeAsync}. */
  safeParseAsync(row: unknown) {
    return this.safeDecodeAsync(row);
  }

  // --- Write side over ALL fields (internal included). Mirrors `TableDef`'s create/patch-shaped
  // `encode`/`encodePartial`; the raw full-object codec is `z.encode(view.object, app)`. ---

  /**
   * Build a `CREATE` payload allowed to set internal fields. VALIDATES and THROWS the
   * aggregated `z.ZodError` on invalid input; use `safeEncode` for the non-throwing form.
   */
  encode(input: CreateShapeAll<S>): MakeWireAll<S> {
    const r = this.safeEncode(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /**
   * Build an `UPDATE`/`MERGE` payload allowed to set internal fields. VALIDATES and THROWS
   * on invalid input; use `safeEncodePartial` for the non-throwing form.
   */
  encodePartial(input: UpdateShapeAll<S>): MakeWireAll<S> {
    const r = this.safeEncodePartial(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /** Non-throwing `encode` over ALL fields (see `TableDef.safeEncode`). */
  safeEncode(input: CreateShapeAll<S>): SafeResult<MakeWireAll<S>> {
    return safeEncodeFields(
      this.fields,
      input as Record<string, unknown>,
    ) as SafeResult<MakeWireAll<S>>;
  }
  /** Non-throwing `encodePartial` over ALL fields. */
  safeEncodePartial(input: UpdateShapeAll<S>): SafeResult<MakeWireAll<S>> {
    return safeEncodeFields(
      this.fields,
      input as Record<string, unknown>,
    ) as SafeResult<MakeWireAll<S>>;
  }
  /** Async `encode` over ALL fields; throws the aggregated error. */
  async encodeAsync(input: CreateShapeAll<S>): Promise<MakeWireAll<S>> {
    const r = await this.safeEncodeAsync(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /** Async `encodePartial` over ALL fields; throws the aggregated error. */
  async encodePartialAsync(input: UpdateShapeAll<S>): Promise<MakeWireAll<S>> {
    const r = await this.safeEncodePartialAsync(input);
    if (!r.success) throw r.error;
    return r.data;
  }
  /** Non-throwing async `encode` over ALL fields. */
  safeEncodeAsync(
    input: CreateShapeAll<S>,
  ): Promise<SafeResult<MakeWireAll<S>>> {
    return safeEncodeFieldsAsync(
      this.fields,
      input as Record<string, unknown>,
    ) as Promise<SafeResult<MakeWireAll<S>>>;
  }
  /** Non-throwing async `encodePartial` over ALL fields. */
  safeEncodePartialAsync(
    input: UpdateShapeAll<S>,
  ): Promise<SafeResult<MakeWireAll<S>>> {
    return safeEncodeFieldsAsync(
      this.fields,
      input as Record<string, unknown>,
    ) as Promise<SafeResult<MakeWireAll<S>>>;
  }
}

// --- Smart id: the `id` field describes the id value type; wrapped as record<thisTable, V>. ---
type IdValue<Id> =
  Id extends RecordIdField<string, infer V>
    ? V
    : Id extends SField<infer Sc, infer _>
      ? z.output<Sc> extends RecordIdValue
        ? z.output<Sc>
        : RecordIdValue
      : Id extends z.ZodType
        ? z.output<Id> extends RecordIdValue
          ? z.output<Id>
          : RecordIdValue
        : RecordIdValue;
type WithSmartId<Name extends string, S extends Shape> = Omit<S, "id"> & {
  id: RecordIdField<
    Name,
    "id" extends keyof S ? IdValue<S["id"]> : RecordIdValue
  >;
};

/** Build a table's `id` field: a `record<name>` whose value type comes from `given`. */
function buildIdField(
  name: string,
  given: AnyField | z.ZodType | undefined,
): RecordIdField<string> {
  if (given === undefined) return new RecordIdField([name]);
  if (given instanceof RecordIdField)
    return new RecordIdField([name], given.valueType);
  const valueSchema = given instanceof SField ? given.schema : given;
  return new RecordIdField([name], valueSchema as z.ZodType<RecordIdValue>);
}

/** Normalize a shape, replacing/adding the special `id` field via buildIdField. */
function applySmartId(name: string, shape: Shape): Record<string, AnyField> {
  const out: Record<string, AnyField> = {};
  for (const [k, v] of Object.entries(shape)) {
    if (k === "id") continue;
    out[k] = v instanceof SField ? v : new SField(v);
  }
  out.id = buildIdField(
    name,
    (shape as Record<string, AnyField | z.ZodType>).id,
  );
  return out;
}

/**
 * Define a normal table (schemafull by default). The shape may be a plain object, or a callback
 * `(self) => ({...})` that receives a `record<thisTable>` field — use it for self-referential
 * links: `manager: self.optional()`. Type-safe with no repeated table name: `self`'s type comes
 * from the `name` arg, not from `typeof <theConst>`, so it sidesteps the self-in-its-own-
 * initializer cycle (TS 7022) that would otherwise widen the whole table to `any`.
 */
export function defineTable<Name extends string, S extends Shape>(
  name: Name,
  shape: S | ((self: RecordIdField<Name>) => S),
): TableDef<Name, WithSmartId<Name, S>> {
  const resolved =
    typeof shape === "function" ? shape(new RecordIdField([name])) : shape;
  return new TableDef(
    name,
    applySmartId(name, resolved) as unknown as Fields<WithSmartId<Name, S>>,
    {
      schemafull: true,
    },
  );
}

// biome-ignore lint/suspicious/noExplicitAny: shape-agnostic table reference for relation endpoints
type AnyTable = TableDef<string, any>;
type TableRef = AnyTable | readonly AnyTable[];
type NamesOf<T> =
  T extends TableDef<infer N extends string, infer _>
    ? N
    : T extends readonly (infer E)[]
      ? E extends TableDef<infer N extends string, infer _>
        ? N
        : never
      : never;

/** A relation's full shape: the edge fields plus the `in`/`out` record endpoints. */
type RelationShape<
  Name extends string,
  S extends Shape,
  In extends string,
  Out extends string,
> = Omit<WithSmartId<Name, S>, "in" | "out"> & {
  in: RecordIdField<In>;
  out: RecordIdField<Out>;
};

function tableNames(ref: TableRef): string[] {
  return (Array.isArray(ref) ? ref : [ref as AnyTable]).map((t) => t.name);
}

/** Build a relation's runtime fields: the edge fields + `in`/`out` (empty endpoints = any record). */
function relationFields(
  name: string,
  edge: Shape,
  fromNames: string[],
  toNames: string[],
): Record<string, AnyField> {
  return {
    ...applySmartId(name, edge),
    in: new RecordIdField(fromNames),
    out: new RecordIdField(toNames),
  };
}

/**
 * A graph relation (edge table). It's a usable `TableDef` immediately — endpoints are OPTIONAL
 * (`TYPE RELATION` with no `FROM`/`TO` restricts nothing) — and `.from(X)` / `.to(Y)` narrow the
 * `in` / `out` record types. Both return a new `RelationDef` (immutable), chainable in any order.
 */
export class RelationDef<
  Name extends string,
  S extends Shape,
  In extends string = string,
  Out extends string = string,
> extends TableDef<Name, RelationShape<Name, S, In, Out>> {
  constructor(
    name: Name,
    private readonly edge: S,
    private readonly fromNames: string[] = [],
    private readonly toNames: string[] = [],
  ) {
    super(
      name,
      relationFields(name, edge, fromNames, toNames) as unknown as Fields<
        RelationShape<Name, S, In, Out>
      >,
      { schemafull: true, relation: { from: fromNames, to: toNames } },
    );
  }
  /** Restrict the source endpoint(s) (`in`). */
  from<F extends TableRef>(ref: F): RelationDef<Name, S, NamesOf<F>, Out> {
    return new RelationDef(
      this.name,
      this.edge,
      tableNames(ref),
      this.toNames,
    ) as unknown as RelationDef<Name, S, NamesOf<F>, Out>;
  }
  /** Restrict the target endpoint(s) (`out`). */
  to<T extends TableRef>(ref: T): RelationDef<Name, S, In, NamesOf<T>> {
    return new RelationDef(
      this.name,
      this.edge,
      this.fromNames,
      tableNames(ref),
    ) as unknown as RelationDef<Name, S, In, NamesOf<T>>;
  }
}

/**
 * Define a graph relation (edge table). Endpoints are optional — the result is a usable table
 * right away; chain `.from(X).to(Y)` to restrict the `in`/`out` records.
 */
export function defineRelation<Name extends string, S extends Shape = {}>(
  name: Name,
  fields?: S,
): RelationDef<Name, S> {
  return new RelationDef(name, (fields ?? {}) as S);
}

/**
 * A standalone `DEFINE EVENT`, declared apart from its table (vs the inline `TableDef.event(…)`).
 * Export one per event when you want each event as its own named symbol. It compiles to the same
 * statement as the inline form — `pull` regenerates events inline, so the two are interchangeable.
 */
export class EventDef {
  readonly kind = "event" as const;
  constructor(
    /** Owning table name. */
    readonly table: string,
    readonly name: string,
    readonly when: Expr | undefined,
    readonly then: Expr | Expr[],
  ) {}
}

/**
 * Declare a row-change event on `table` as a standalone, exportable object:
 * `export const reverify = defineEvent(User, "reverify", { when, then })`. Pass the `TableDef`
 * (preferred — no name repetition) or a table name string. See {@link TableDef.event} for the
 * inline, chainable form.
 */
export function defineEvent(
  table: TableDef<string, Shape> | string,
  name: string,
  spec: { when?: Expr; then: Expr | Expr[] },
): EventDef {
  const tableName = typeof table === "string" ? table : table.name;
  return new EventDef(tableName, name, spec.when, spec.then);
}

/** The app-facing type (what your code reads). */
export type App<T extends { object: z.ZodType }> = z.output<T["object"]>;
/** The DB wire type (what crosses the wire). */
export type Wire<T extends { object: z.ZodType }> = z.input<T["object"]>;
/** The typed input for creating a record (DB-filled fields optional). */
export type Create<T> =
  T extends TableDef<string, infer S> ? CreateShape<S> : never;
/** The typed input for updating a record (partial; excludes id and readonly fields). */
export type Update<T> =
  T extends TableDef<string, infer S> ? UpdateShape<S> : never;
