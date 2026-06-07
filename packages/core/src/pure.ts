import { z } from "zod";
import {
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
  surql,
  Uuid,
  type Bound,
  type RecordIdValue,
} from "surrealdb";

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
export const objectFieldsRegistry = new WeakMap<z.ZodType, Record<string, AnyField>>();

/**
 * Per-table/field row-level permissions. A `PermOp` is one access operation; `Perm` is
 * the rule for one op — `true` (FULL) / `false` (NONE) / a `BoundQuery` (a `WHERE` expr) /
 * `` `same as X` `` to reuse another op's resolved rule. A `TablePermissions` is a blanket
 * rule, a shared `WHERE`, or per-op rules. Fields have NO `delete` op (verified against
 * the DB), so they use `FieldPerm` / `FieldPermissions`.
 */
export type PermOp = "select" | "create" | "update" | "delete";
export type Perm = boolean | BoundQuery | `same as ${PermOp}`;
export type TablePermissions = boolean | BoundQuery | Partial<Record<PermOp, Perm>>;
export type FieldPerm = boolean | BoundQuery | "same as select" | "same as create" | "same as update";
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
}

/** Render a primitive as a clean SurrealQL literal; non-primitives return "". */
function primitiveLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
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
  return STRING_IS_FORMATS.has(format) ? `string::is_${format}($value)` : undefined;
}

/** Build an SField for a Zod string-format schema, baking `string::is_<fmt>($value)`
 * when SurrealDB has that validator (else no assert). */
function formatField<S extends z.ZodType>(schema: S, format: string): SField<S> {
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
type InnerOf<S extends z.ZodType> = S extends z.ZodOptional<infer I extends z.ZodType>
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
export class SField<S extends z.ZodType = z.ZodType, Flags extends string = never> {
  constructor(
    readonly schema: S,
    readonly surreal: SurrealMeta = {},
  ) {}

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
    const def = this.schema._zod.def as { innerType?: z.ZodType; element?: z.ZodType };
    const inner = def.innerType ?? def.element ?? this.schema;
    return new SField(inner, this.surreal) as unknown as SField<InnerOf<S>, Flags>;
  }

  // SurrealQL DDL metadata. $default/$defaultAlways mark the field create-optional;
  // $readonly marks it non-updatable (see Create<>/Update<>). The default accepts a
  // plain value (rendered as a literal) or a `surql` expression.
  $default(value: z.output<S> | BoundQuery): SField<S, Flags | "create"> {
    return new SField(this.schema, { ...this.surreal, default: toExpr(value), defaultAlways: false });
  }
  $defaultAlways(value: z.output<S> | BoundQuery): SField<S, Flags | "create"> {
    return new SField(this.schema, { ...this.surreal, default: toExpr(value), defaultAlways: true });
  }
  /**
   * Set a DB-side `VALUE` clause. Whether the field is create-OPTIONAL depends on
   * whether the expression consumes the client input (`$value`), which can't be
   * inferred — so it's explicit via the `optional` option:
   *   - `time::now()` ignores input -> `{ optional: true }` (create-optional)
   *   - `string::lowercase($value)` requires input -> default (create-required)
   * Optionality is purely type-level (the option drives the `"create"` flag that
   * `Create<>`/`make()` read); it does not touch the app type or DB nullability.
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
    if (this.schemaType === "string") return this.constrain("min", n, `string::len($value) >= ${n}`);
    if (this.schemaType === "number") return this.constrain("min", n, `$value >= ${n}`);
    return this;
  }
  /** Max length (string) / maximum value (number). */
  $max(n: number): SField<S, Flags> {
    if (this.schemaType === "string") return this.constrain("max", n, `string::len($value) <= ${n}`);
    if (this.schemaType === "number") return this.constrain("max", n, `$value <= ${n}`);
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
    if (this.schemaType === "string") return this.constrain("regex", re, `$value = /${re.source}/`);
    return this;
  }
  /** Greater than (number). */
  $gt(n: number): SField<S, Flags> {
    if (this.schemaType === "number") return this.constrain("gt", n, `$value > ${n}`);
    return this;
  }
  /** Greater than or equal (number). */
  $gte(n: number): SField<S, Flags> {
    if (this.schemaType === "number") return this.constrain("gte", n, `$value >= ${n}`);
    return this;
  }
  /** Less than (number). */
  $lt(n: number): SField<S, Flags> {
    if (this.schemaType === "number") return this.constrain("lt", n, `$value < ${n}`);
    return this;
  }
  /** Less than or equal (number). */
  $lte(n: number): SField<S, Flags> {
    if (this.schemaType === "number") return this.constrain("lte", n, `$value <= ${n}`);
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
  private constrain(method: keyof CheckableSchema, arg: number | RegExp, frag: string): SField<S, Flags> {
    const apply = (this.schema as unknown as Record<string, (a: number | RegExp) => z.ZodType>)[method];
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
  const codec = z.codec(z.union([z.instanceof(Uint8Array), z.instanceof(ArrayBuffer)]), z.instanceof(Uint8Array), {
    decode: (b) => (b instanceof Uint8Array ? b : new Uint8Array(b)),
    encode: (u) => u,
  });
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
function recordIdSchema<T extends string, V extends RecordIdValue = RecordIdValue>(
  tables: T[],
  valueType?: z.ZodType<V>,
): z.ZodType<RecordId<T, V>, RecordId<T, V>> {
  const schema = z.instanceof(RecordId).refine(
    // RecordId.table is a Table object; .name is the unescaped name.
    (r) =>
      (tables as readonly string[]).includes(r.table.name) &&
      (valueType ? valueType.safeParse(r.id).success : true),
    { error: `Expected record<${tables.join(" | ")}>` },
  );
  surrealTypeRegistry.set(schema, `record<${tables.join(" | ")}>`);
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
const toZod = (v: AnyField | z.ZodType): z.ZodType => (v instanceof SField ? v.schema : v);
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
  url: (params?: Parameters<typeof z.url>[0]) => formatField(z.url(params), "url"),
  /** Surreal native `uuid`: a `string` app-side, stored as a `Uuid` (no ASSERT — native type). */
  uuid: () => new SField(uuidCodec()),
  guid: (params?: Parameters<typeof z.guid>[0]) => formatField(z.guid(params), "guid"),
  nanoid: (params?: Parameters<typeof z.nanoid>[0]) => formatField(z.nanoid(params), "nanoid"),
  cuid: (params?: Parameters<typeof z.cuid>[0]) => formatField(z.cuid(params), "cuid"),
  cuid2: (params?: Parameters<typeof z.cuid2>[0]) => formatField(z.cuid2(params), "cuid2"),
  ulid: (params?: Parameters<typeof z.ulid>[0]) => formatField(z.ulid(params), "ulid"),
  xid: (params?: Parameters<typeof z.xid>[0]) => formatField(z.xid(params), "xid"),
  ksuid: (params?: Parameters<typeof z.ksuid>[0]) => formatField(z.ksuid(params), "ksuid"),
  ipv4: (params?: Parameters<typeof z.ipv4>[0]) => formatField(z.ipv4(params), "ipv4"),
  ipv6: (params?: Parameters<typeof z.ipv6>[0]) => formatField(z.ipv6(params), "ipv6"),
  cidrv4: (params?: Parameters<typeof z.cidrv4>[0]) => formatField(z.cidrv4(params), "cidrv4"),
  cidrv6: (params?: Parameters<typeof z.cidrv6>[0]) => formatField(z.cidrv6(params), "cidrv6"),
  base64: (params?: Parameters<typeof z.base64>[0]) => formatField(z.base64(params), "base64"),
  base64url: (params?: Parameters<typeof z.base64url>[0]) =>
    formatField(z.base64url(params), "base64url"),
  e164: (params?: Parameters<typeof z.e164>[0]) => formatField(z.e164(params), "e164"),
  jwt: (params?: Parameters<typeof z.jwt>[0]) => formatField(z.jwt(params), "jwt"),
  emoji: (params?: Parameters<typeof z.emoji>[0]) => formatField(z.emoji(params), "emoji"),

  // Numbers. int/int32/uint32 -> DDL `int`; float -> DDL `float` (def.format-driven).
  int: (params?: Parameters<typeof z.int>[0]) => new SField(z.int(params)),
  float: (params?: Parameters<typeof z.float64>[0]) => new SField(z.float64(params)),
  int32: (params?: Parameters<typeof z.int32>[0]) => new SField(z.int32(params)),
  uint32: (params?: Parameters<typeof z.uint32>[0]) => new SField(z.uint32(params)),
  bigint: (params?: Parameters<typeof z.bigint>[0]) => new SField(z.bigint(params)),

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
    new SField(native(z.instanceof(Geometry), kind ? `geometry<${kind}>` : "geometry")),
  recordId: <T extends string>(table: T | T[]) =>
    new RecordIdField<T>(Array.isArray(table) ? table : [table]),
  /** A nested object whose fields keep their surreal metadata + native types. */
  object: <S extends Shape>(shape: S): SField<z.ZodObject<ZShape<S>>> => {
    const fields: Record<string, AnyField> = {};
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, v] of Object.entries(shape)) {
      const f = v instanceof SField ? v : new SField(v);
      fields[k] = f;
      zshape[k] = f.schema;
    }
    const schema = z.object(zshape) as z.ZodObject<ZShape<S>>;
    objectFieldsRegistry.set(schema, fields);
    return new SField(schema);
  },
  /** An array of `element` (an SField or a raw Zod schema). */
  array: <F extends AnyField | z.ZodType>(element: F): SField<z.ZodArray<SchemaOf<F>>> =>
    (element instanceof SField ? element : new SField(element)).array() as SField<
      z.ZodArray<SchemaOf<F>>
    >,
  /** A literal value type. */
  literal: <const T extends string | number | boolean | bigint>(value: T) =>
    new SField(z.literal(value)),
  /** A string enum. */
  enum: <const T extends readonly [string, ...string[]]>(values: T) => new SField(z.enum(values)),
  /** A union of fields/schemas. */
  union: <const T extends readonly [AnyField | z.ZodType, ...(AnyField | z.ZodType)[]]>(
    options: T,
  ): SField<z.ZodUnion<ZodsOf<T>>> => new SField(z.union(options.map(toZod) as ZodsOf<T>)),
  /** A fixed-length tuple of fields/schemas. */
  tuple: <const T extends readonly [AnyField | z.ZodType, ...(AnyField | z.ZodType)[]]>(
    items: T,
  ): SField<z.ZodTuple<ZodsOf<T>>> => new SField(z.tuple(items.map(toZod) as ZodsOf<T>)),

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
  set: <V extends AnyField | z.ZodType>(element: V): SField<z.ZodSet<SchemaOf<V>>> =>
    new SField(z.set(toZod(element) as SchemaOf<V>)),
  /** The intersection of two schemas (object fields are merged in DDL). */
  intersection: <A extends AnyField | z.ZodType, B extends AnyField | z.ZodType>(
    a: A,
    b: B,
  ): SField<z.ZodIntersection<SchemaOf<A>, SchemaOf<B>>> =>
    new SField(z.intersection(toZod(a) as SchemaOf<A>, toZod(b) as SchemaOf<B>)),
  /** A lazily-resolved schema/field (for recursive types). */
  lazy: <V extends AnyField | z.ZodType>(getter: () => V): SField<z.ZodLazy<SchemaOf<V>>> =>
    new SField(z.lazy(() => toZod(getter()) as SchemaOf<V>)),

  /** A native TS enum — string or numeric (numeric reverse-mappings are filtered out). */
  nativeEnum: <const T extends Record<string, string | number>>(entries: T) =>
    new SField(z.nativeEnum(entries)),
  /** A discriminated union of object schemas/fields -> DDL `object`. */
  discriminatedUnion: <
    Disc extends string,
    const T extends readonly [AnyField | z.ZodType, ...(AnyField | z.ZodType)[]],
  >(
    discriminator: Disc,
    options: T,
  ): SField<z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>> =>
    new SField(
      z.discriminatedUnion(discriminator, options.map(toZod) as never) as unknown as z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>,
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
type SchemaOf<F> = F extends SField<infer S, infer _> ? S : F extends z.ZodType ? F : never;
type FlagsOf<F> = F extends SField<z.ZodType, infer Fl> ? Fl : never;
/**
 * Whether a field carries the `"internal"` flag (set by `.$internal()`). The
 * `string extends FlagsOf<F>` guard short-circuits the broad `Shape` case (where
 * flags widen to `string`, and `"internal" extends string` would wrongly be true),
 * so `ZShape<Shape>` keeps every key for shape-agnostic refs like `TableDef<string, Shape>`.
 */
type IsInternal<F> = string extends FlagsOf<F>
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
type ToField<F> = F extends SField<infer Sc, infer Fl> ? SField<Sc, Fl> : SField<SchemaOf<F>>;
type Fields<S extends Shape> = { [K in keyof S]: ToField<S[K]> };
type Unwrap<F> = F extends SField<z.ZodOptional<infer Inner extends z.ZodType>, infer Fl>
  ? SField<Inner, Fl>
  : F;
type PartialShape<S extends Shape> = {
  [K in keyof S]: SField<z.ZodOptional<SchemaOf<S[K]>>, FlagsOf<S[K]>>;
};
type RequiredShape<S extends Shape> = { [K in keyof S]: Unwrap<Fields<S>[K]> };

export interface TableConfig {
  schemafull: boolean;
  drop?: boolean;
  comment?: string;
  /** Table-level `PERMISSIONS`. Omitted ops default to NONE in SurrealDB. See `.permissions()`. */
  permissions?: TablePermissions;
  relation?: { from: string[]; to: string[] };
}

function normalizeFields<S extends Shape>(shape: S): Fields<S> {
  const out: Record<string, AnyField> = {};
  for (const [k, v] of Object.entries(shape)) {
    out[k] = v instanceof SField ? v : new SField(v);
  }
  return out as unknown as Fields<S>;
}

/** Encode a (partial) app object to a wire payload, omitting absent fields. */
function encodeInput(
  fields: Record<string, AnyField>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const field = fields[k];
    out[k] = field ? z.encode(field.schema, v as never) : v;
  }
  return out;
}

// --- Create / Update input shapes ---
type Prettify<T> = { [K in keyof T]: T[K] } & {};
type AppOf<F> = z.output<SchemaOf<F>>;
type InputOptional<F> = undefined extends z.input<SchemaOf<F>> ? true : false;

type CreateOptional<S extends Shape, K extends keyof S> = K extends "id"
  ? true
  : "create" extends FlagsOf<S[K]>
    ? true
    : InputOptional<S[K]>;
// Public create input: internal fields are never settable by clients.
type CreateShape<S extends Shape> = Prettify<
  {
    [K in keyof S as IsInternal<S[K]> extends true
      ? never
      : CreateOptional<S, K> extends true
        ? never
        : K]: AppOf<S[K]>;
  } & {
    [K in keyof S as IsInternal<S[K]> extends true
      ? never
      : CreateOptional<S, K> extends true
        ? K
        : never]?: AppOf<S[K]>;
  }
>;
// System create input: includes internal fields (the old, all-fields behavior).
type CreateShapeAll<S extends Shape> = Prettify<
  { [K in keyof S as CreateOptional<S, K> extends true ? never : K]: AppOf<S[K]> } & {
    [K in keyof S as CreateOptional<S, K> extends true ? K : never]?: AppOf<S[K]>;
  }
>;

type UpdateExcluded<S extends Shape, K extends keyof S> = K extends "id"
  ? true
  : "readonly" extends FlagsOf<S[K]>
    ? true
    : false;
// Public update input: internal fields are excluded.
type UpdateShape<S extends Shape> = Prettify<{
  [K in keyof S as IsInternal<S[K]> extends true
    ? never
    : UpdateExcluded<S, K> extends true
      ? never
      : K]?: AppOf<S[K]>;
}>;
// System update input: includes internal fields (the old, all-fields behavior).
type UpdateShapeAll<S extends Shape> = Prettify<{
  [K in keyof S as UpdateExcluded<S, K> extends true ? never : K]?: AppOf<S[K]>;
}>;

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
    // `defineTable` still iterates ALL `this.fields`, so internal fields stay in the DDL.
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
  /** App object -> DB wire row. */
  encode(value: z.output<z.ZodObject<ZShape<S>>>): z.input<z.ZodObject<ZShape<S>>> {
    return z.encode(this.object, value);
  }
  // Async variants (for async refinements).
  decodeAsync(row: unknown): Promise<z.output<z.ZodObject<ZShape<S>>>> {
    return z.decodeAsync(this.object, row as never);
  }
  encodeAsync(value: z.output<z.ZodObject<ZShape<S>>>): Promise<z.input<z.ZodObject<ZShape<S>>>> {
    return z.encodeAsync(this.object, value);
  }

  // No-throw variants — return { success, data } | { success, error }.
  // (To validate an app object without converting, use safeEncode — it validates the app side.)
  safeDecode(row: unknown) {
    return z.safeDecode(this.object, row as never);
  }
  safeEncode(value: z.output<z.ZodObject<ZShape<S>>>) {
    return z.safeEncode(this.object, value);
  }
  safeDecodeAsync(row: unknown) {
    return z.safeDecodeAsync(this.object, row as never);
  }
  safeEncodeAsync(value: z.output<z.ZodObject<ZShape<S>>>) {
    return z.safeEncodeAsync(this.object, value);
  }

  /** Build a wire payload for `CREATE` (DB-filled fields optional). */
  make(input: CreateShape<S>): Record<string, unknown> {
    return encodeInput(this.fields as unknown as Record<string, AnyField>, input);
  }
  /** Build a wire payload for `UPDATE`/`MERGE` (a partial patch; excludes id/readonly). */
  makePartial(input: UpdateShape<S>): Record<string, unknown> {
    return encodeInput(this.fields as unknown as Record<string, AnyField>, input);
  }

  /**
   * The server/system view: the same table over ALL fields, including `$internal()`
   * ones the public surface hides. Use it in trusted server code that must read or
   * write internal fields (e.g. a `passhash`).
   */
  get system(): SystemView<Name, S> {
    return new SystemView<Name, S>(this.fields as unknown as Record<string, AnyField>);
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

  // --- Shape ops (mirror Zod's object methods; carry DDL metadata + config) ---
  extend<E extends Shape>(ext: E): TableDef<Name, Omit<S, keyof E> & E> {
    const f: Record<string, AnyField> = {
      ...(this.fields as unknown as Record<string, AnyField>),
      ...normalizeFields(ext),
    };
    return new TableDef(this.name, f as unknown as Fields<Omit<S, keyof E> & E>, this.config);
  }
  pick<K extends keyof S>(...keys: K[]): TableDef<Name, Pick<S, K>> {
    const src = this.fields as unknown as Record<string, AnyField>;
    const f: Record<string, AnyField> = {};
    for (const k of keys) f[k as string] = src[k as string]!;
    return new TableDef(this.name, f as unknown as Fields<Pick<S, K>>, this.config);
  }
  omit<K extends keyof S>(...keys: K[]): TableDef<Name, Omit<S, K>> {
    const f: Record<string, AnyField> = { ...(this.fields as unknown as Record<string, AnyField>) };
    for (const k of keys) delete f[k as string];
    return new TableDef(this.name, f as unknown as Fields<Omit<S, K>>, this.config);
  }
  partial(): TableDef<Name, PartialShape<S>> {
    const f: Record<string, AnyField> = {};
    for (const [k, field] of Object.entries(this.fields)) f[k] = (field as AnyField).optional();
    return new TableDef(this.name, f as unknown as Fields<PartialShape<S>>, this.config);
  }
  required(): TableDef<Name, RequiredShape<S>> {
    const f: Record<string, AnyField> = {};
    for (const [k, field] of Object.entries(this.fields)) {
      const sf = field as AnyField;
      const def = sf.schema._zod.def as unknown as { type: string; innerType?: z.ZodType };
      f[k] = def.type === "optional" && def.innerType ? new SField(def.innerType, sf.surreal) : sf;
    }
    return new TableDef(this.name, f as unknown as Fields<RequiredShape<S>>, this.config);
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
 * `.object` validates/encodes/decodes the full shape, and `make`/`makePartial` accept
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
  /** App object -> DB wire row (internal fields kept). */
  encode(value: z.output<z.ZodObject<ZShapeAll<S>>>): z.input<z.ZodObject<ZShapeAll<S>>> {
    return z.encode(this.object, value);
  }
  decodeAsync(row: unknown): Promise<z.output<z.ZodObject<ZShapeAll<S>>>> {
    return z.decodeAsync(this.object, row as never);
  }
  encodeAsync(value: z.output<z.ZodObject<ZShapeAll<S>>>): Promise<z.input<z.ZodObject<ZShapeAll<S>>>> {
    return z.encodeAsync(this.object, value);
  }

  safeDecode(row: unknown) {
    return z.safeDecode(this.object, row as never);
  }
  safeEncode(value: z.output<z.ZodObject<ZShapeAll<S>>>) {
    return z.safeEncode(this.object, value);
  }
  safeDecodeAsync(row: unknown) {
    return z.safeDecodeAsync(this.object, row as never);
  }
  safeEncodeAsync(value: z.output<z.ZodObject<ZShapeAll<S>>>) {
    return z.safeEncodeAsync(this.object, value);
  }

  /** Build a `CREATE` payload allowed to set internal fields. */
  make(input: CreateShapeAll<S>): Record<string, unknown> {
    return encodeInput(this.fields, input as Record<string, unknown>);
  }
  /** Build an `UPDATE`/`MERGE` payload allowed to set internal fields. */
  makePartial(input: UpdateShapeAll<S>): Record<string, unknown> {
    return encodeInput(this.fields, input as Record<string, unknown>);
  }
}

// --- Smart id: the `id` field describes the id value type; wrapped as record<thisTable, V>. ---
type IdValue<Id> = Id extends RecordIdField<string, infer V>
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
  id: RecordIdField<Name, "id" extends keyof S ? IdValue<S["id"]> : RecordIdValue>;
};

/** Build a table's `id` field: a `record<name>` whose value type comes from `given`. */
function buildIdField(name: string, given: AnyField | z.ZodType | undefined): RecordIdField<string> {
  if (given === undefined) return new RecordIdField([name]);
  if (given instanceof RecordIdField) return new RecordIdField([name], given.valueType);
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
  out.id = buildIdField(name, (shape as Record<string, AnyField | z.ZodType>).id);
  return out;
}

/** Define a normal table (schemafull by default). */
export function table<Name extends string, S extends Shape>(
  name: Name,
  shape: S,
): TableDef<Name, WithSmartId<Name, S>> {
  return new TableDef(name, applySmartId(name, shape) as unknown as Fields<WithSmartId<Name, S>>, {
    schemafull: true,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: shape-agnostic table reference for relation endpoints
type AnyTable = TableDef<string, any>;
type TableRef = AnyTable | readonly AnyTable[];
type NamesOf<T> = T extends TableDef<infer N extends string, infer _>
  ? N
  : T extends readonly (infer E)[]
    ? E extends TableDef<infer N extends string, infer _>
      ? N
      : never
    : never;

type RelationShape<
  Name extends string,
  S extends Shape,
  From extends TableRef,
  To extends TableRef,
> = Omit<WithSmartId<Name, S>, "in" | "out"> & {
  in: RecordIdField<NamesOf<From>>;
  out: RecordIdField<NamesOf<To>>;
};

function tableNames(ref: TableRef): string[] {
  return (Array.isArray(ref) ? ref : [ref as AnyTable]).map((t) => t.name);
}

/** Staged relation builder — set the source endpoint with `.from(...)`. */
class RelationFrom<Name extends string, S extends Shape> {
  constructor(
    readonly name: Name,
    readonly fields: S,
  ) {}
  from<From extends TableRef>(from: From): RelationTo<Name, S, From> {
    return new RelationTo(this.name, this.fields, from);
  }
}

/** Staged relation builder — set the target endpoint with `.to(...)`, producing the table. */
class RelationTo<Name extends string, S extends Shape, From extends TableRef> {
  constructor(
    readonly name: Name,
    readonly fields: S,
    readonly from: From,
  ) {}
  to<To extends TableRef>(to: To): TableDef<Name, RelationShape<Name, S, From, To>> {
    const fromNames = tableNames(this.from);
    const toNames = tableNames(to);
    const fields: Record<string, AnyField> = {
      ...applySmartId(this.name, this.fields),
      in: sz.recordId(fromNames),
      out: sz.recordId(toNames),
    };
    return new TableDef(this.name, fields as unknown as Fields<RelationShape<Name, S, From, To>>, {
      schemafull: true,
      relation: { from: fromNames, to: toNames },
    });
  }
}

/** Define a graph relation (edge table). Chain `.from(X).to(Y)` to set endpoints. */
export function relation<Name extends string, S extends Shape = {}>(
  name: Name,
  fields?: S,
): RelationFrom<Name, S> {
  return new RelationFrom(name, (fields ?? {}) as S);
}

/** The app-facing type (what your code reads). */
export type App<T extends { object: z.ZodType }> = z.output<T["object"]>;
/** The DB wire type (what crosses the wire). */
export type Wire<T extends { object: z.ZodType }> = z.input<T["object"]>;
/** The typed input for creating a record (DB-filled fields optional). */
export type Create<T> = T extends TableDef<string, infer S> ? CreateShape<S> : never;
/** The typed input for updating a record (partial; excludes id and readonly fields). */
export type Update<T> = T extends TableDef<string, infer S> ? UpdateShape<S> : never;
