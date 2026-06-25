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
  type Surreal,
  surql,
  Table,
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
 *
 * These two registries are module-level mutable singletons read across the authoring index <-> the
 * `@schemic/surrealdb/driver` subpath, which can load as SEPARATE module instances (the CLI jiti-loads
 * the user schema -> the index; the CLI loader imports /driver). A plain `new WeakMap()` would then be
 * DUPLICATED — `s.*` registers codecs/shapes in one, the driver's lower()/inferField read the other,
 * and gen fails ("s.custom() has no SurrealQL type"). So key each on a REGISTERED symbol (same key in
 * every instance) so both halves share ONE map. Mirrors @schemic/core's driver registry (driver.ts).
 */
function globalSingleton<T>(key: symbol, make: () => T): T {
  const slots = globalThis as Record<symbol, T | undefined>;
  if (slots[key] === undefined) slots[key] = make();
  return slots[key] as T;
}
export const surrealTypeRegistry = globalSingleton(
  Symbol.for("@schemic/surrealdb.surrealTypeRegistry"),
  () => new WeakMap<z.ZodType, string>(),
);

/**
 * Maps an object schema built via `s.object` to its original SField shape, so
 * nested fields keep their DDL metadata ($default/$assert/...) during generation. A `globalThis`
 * `Symbol.for` singleton for the same cross-instance reason as {@link surrealTypeRegistry}.
 */
export const objectFieldsRegistry = globalSingleton(
  Symbol.for("@schemic/surrealdb.objectFieldsRegistry"),
  () => new WeakMap<z.ZodType, Record<string, AnyField>>(),
);

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
  /** `COMPUTED <expr>` — a derived, read-only column (computed on read; never written). */
  computed?: BoundQuery;
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
  /** Single-field index: `.$index()` (normal) / `.$unique()` (uniqueness) / `.$fulltext()` /
   * `.$hnsw()` / `.$diskann()`, with an optional custom `name`. Emits `DEFINE INDEX
   * <name ?? <table>_<field>_idx> ON TABLE <table> FIELDS <field> <UNIQUE | spec>`. `spec` carries a
   * FULLTEXT/HNSW/DISKANN clause (built via `buildIndexSpec`); it is mutually exclusive with `unique`. */
  index?: { unique?: boolean; name?: string; spec?: string };
  /** `REFERENCE [ON DELETE …]` on a record-link field. See `.$reference()`. */
  reference?:
    | true
    | { onDelete?: "reject" | "cascade" | "ignore" | "unset" | BoundQuery };
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
const STRING_IS_FORMATS = new Set([
  "email",
  "url",
  "ulid",
  "ipv4",
  "ipv6",
  // batch 2: 3.1.3 `string::is_*` validators with no Zod format builder (plain string
  // app-side; the ASSERT enforces the format in SurrealDB).
  "alpha",
  "alphanum",
  "ascii",
  "numeric",
  "semver",
  "hexadecimal",
  "latitude",
  "longitude",
  "ip",
  "domain",
]);

/** Map a Zod string format to its SurrealDB `string::is_*` assert, when one exists. */
function formatAssert(format: string): string | undefined {
  return STRING_IS_FORMATS.has(format)
    ? `string::is_${format}($value)`
    : undefined;
}

/**
 * Reverse of {@link formatAssert}: recover a format name from a baked `string::is_<fmt>($value)`
 * assert. Used by `pull` to restore `s.<format>()` instead of `s.string().$assert(...)`. Returns
 * undefined for any other assert — including one that combines a format with extra text — so only an
 * exact, single-format assert reverses (a user's own assert is never swallowed).
 */
export function formatForAssert(assert: string): string | undefined {
  const m = /^string::is_([a-z0-9]+)\(\s*\$value\s*\)$/.exec(assert.trim());
  return m && STRING_IS_FORMATS.has(m[1]) ? m[1] : undefined;
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
/** Does the Zod schema `S` contain an `object` in its SurrealQL type — directly, as the element of an
 *  `array`/`set`, as a member of a union, or under an `optional`/`nullable`/`default`/`readonly`
 *  wrapper? `FLEXIBLE` is only valid on such types (e.g. `object`, `array<object>`, `object | string`),
 *  so the `.flexible()`/`.loose()`/`.strict()` methods are gated on this. */
export type ContainsObject<S> =
  S extends z.ZodObject<z.ZodRawShape>
    ? true
    : S extends z.ZodArray<infer T>
      ? ContainsObject<T>
      : S extends z.ZodSet<infer T>
        ? ContainsObject<T>
        : S extends z.ZodUnion<infer O>
          ? ContainsObjectInUnion<O>
          : S extends z.ZodOptional<infer T>
            ? ContainsObject<T>
            : S extends z.ZodNullable<infer T>
              ? ContainsObject<T>
              : S extends z.ZodDefault<infer T>
                ? ContainsObject<T>
                : S extends z.ZodReadonly<infer T>
                  ? ContainsObject<T>
                  : false;
/** True if ANY member of a union's option tuple contains an object. */
type ContainsObjectInUnion<O> = O extends readonly [infer H, ...infer R]
  ? ContainsObject<H> extends true
    ? true
    : ContainsObjectInUnion<R>
  : false;
/** The `this`-parameter constraint for the object-mode methods: the field itself when its type
 *  contains an object, else a hint string the real receiver isn't assignable to (a compile error). */
export type ObjectModeReceiver<S, T> =
  ContainsObject<S> extends true
    ? T
    : "`.flexible()` / `.loose()` / `.strict()` is only valid on object-typed fields (object, array<object>, or a union containing one)";

/**
 * The PORTABLE, dialect-agnostic field base (extraction phase B — see docs/AUTHORING-SPLIT.md).
 * Holds the Zod schema, an opaque per-dialect `native` metadata slot, the field-level codecs, and
 * the App-land Zod wrappers (which carry `native` forward via the `rebuild` hook so a chain keeps
 * its concrete dialect type). It references NOTHING SurrealDB-specific. Each dialect subclasses it
 * (see {@link SField} for SurrealDB) to add native authoring (`$`-methods) and re-type the wrappers.
 */
export abstract class SFieldBase<
  S extends z.ZodType = z.ZodType,
  Flags extends string = never,
  N = unknown,
> {
  constructor(
    readonly schema: S,
    readonly native: N,
  ) {}

  /** Rebuild a sibling field of the SAME dialect with a new schema/flags. Each dialect overrides it. */
  protected abstract rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: N,
  ): SFieldBase<S2, F2, N>;
  /** A fresh, empty native-metadata bag (for wrappers like `or`/`and` that reset it). */
  protected abstract blank(): N;

  // --- Field-level codec (raw, on `this.schema`): `decode` reads (wire -> app), `encode`
  // writes (app -> wire). Create-shaping is a table concept, so these are NOT create-shaped —
  // e.g. `s.datetime().decode(dbDateTime) -> Date`, `s.uuid().encode("…") -> Uuid`. ---
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

  // Zod wrappers — delegate to the inner schema, carry native metadata + flags forward.
  optional(): SFieldBase<z.ZodOptional<S>, Flags, N> {
    return this.rebuild(this.schema.optional(), this.native);
  }
  nullable(): SFieldBase<z.ZodNullable<S>, Flags, N> {
    return this.rebuild(this.schema.nullable(), this.native);
  }
  default(value: z.input<S>): SFieldBase<z.ZodDefault<S>, Flags, N> {
    return this.rebuild(this.schema.default(value as never), this.native);
  }
  /** Zod prefault: fill an absent value with `value`, then validate it (unlike `.default`). */
  prefault(value: z.input<S>): SFieldBase<z.ZodPrefault<S>, Flags, N> {
    return this.rebuild(z.prefault(this.schema, value as never), this.native);
  }
  /** Zod catch: fall back to `value` when parsing fails. */
  catch(value: z.output<S>): SFieldBase<z.ZodCatch<S>, Flags, N> {
    return this.rebuild(this.schema.catch(value as never), this.native);
  }
  array(): SFieldBase<z.ZodArray<S>, Flags, N> {
    return this.rebuild(z.array(this.schema), this.native);
  }
  nullish(): SFieldBase<z.ZodOptional<z.ZodNullable<S>>, Flags, N> {
    return this.rebuild(this.schema.nullish(), this.native);
  }
  /** Zod union — `a.or(b)` accepts either; SurrealQL `<a> | <b>`. Mirrors Zod's `.or()`. */
  or<F extends AnyField | z.ZodType>(
    other: F,
  ): SFieldBase<z.ZodUnion<[S, SchemaOf<F>]>, never, N> {
    return this.rebuild<z.ZodUnion<[S, SchemaOf<F>]>, never>(
      z.union([this.schema, toZod(other)]) as z.ZodUnion<[S, SchemaOf<F>]>,
      this.blank(),
    );
  }
  /** Zod intersection — `a.and(b)`; merges object fields in DDL. Mirrors Zod's `.and()`. */
  and<F extends AnyField | z.ZodType>(
    other: F,
  ): SFieldBase<z.ZodIntersection<S, SchemaOf<F>>, never, N> {
    return this.rebuild<z.ZodIntersection<S, SchemaOf<F>>, never>(
      z.intersection(this.schema, toZod(other) as SchemaOf<F>),
      this.blank(),
    );
  }

  // --- Native Zod passthrough (drop-in for `z.*`): app-side validation / transform / metadata,
  // delegated to the inner schema. These mirror Zod exactly; the SurrealDB-DDL side stays under the
  // `$`-prefixed methods (`$readonly`/`$comment`/…). A field's SurrealQL type is its WIRE/input
  // type, so refine/check/brand/readonly/describe leave the DDL type untouched; transform/pipe keep
  // the storable input type and change only the decoded `App<>`. A resulting type SurrealDB can't
  // represent is rejected at emit — use `$surreal(type, codec)`. (Explicit method signatures, not
  // `Parameters<…>`, so these stay method-bivariant and don't break table-name covariance.)
  refine(
    check: (arg: z.output<S>) => unknown,
    params?: string | z.core.$ZodCustomParams,
  ): this {
    return this.rebuild(
      this.schema.refine(check, params) as S,
      this.native,
    ) as unknown as this;
  }
  superRefine(
    refinement: (
      arg: z.output<S>,
      ctx: z.core.$RefinementCtx<z.output<S>>,
    ) => void,
  ): this {
    return this.rebuild(
      this.schema.superRefine(refinement) as S,
      this.native,
    ) as unknown as this;
  }
  check(
    ...checks: (z.core.CheckFn<z.output<S>> | z.core.$ZodCheck<z.output<S>>)[]
  ): this {
    return this.rebuild(
      this.schema.check(...checks) as S,
      this.native,
    ) as unknown as this;
  }
  overwrite(fn: (x: z.output<S>) => z.output<S>): this {
    return this.rebuild(
      this.schema.overwrite(fn) as S,
      this.native,
    ) as unknown as this;
  }
  brand<B extends PropertyKey = PropertyKey>(value?: B): this {
    return this.rebuild(
      this.schema.brand(value) as unknown as S,
      this.native,
    ) as unknown as this;
  }
  /** Zod's app-side metadata (JSON-schema/docs) — distinct from `$comment()` (SurrealDB COMMENT). */
  describe(description: string): this {
    return this.rebuild(
      this.schema.describe(description) as S,
      this.native,
    ) as unknown as this;
  }
  meta(data: z.core.GlobalMeta): this {
    return this.rebuild(
      this.schema.meta(data) as S,
      this.native,
    ) as unknown as this;
  }
  /** Zod's app-side readonly (TS-immutable output) — distinct from `$readonly()` (SurrealDB READONLY). */
  readonly(): SFieldBase<z.ZodReadonly<S>, Flags, N> {
    return this.rebuild(this.schema.readonly(), this.native);
  }
  /** Zod transform — changes the decoded `App<>` value; the stored (wire) type is unchanged. */
  transform<NewOut>(
    fn: (arg: z.output<S>, ctx: z.core.$RefinementCtx<z.output<S>>) => NewOut,
  ): SFieldBase<
    z.ZodPipe<S, z.ZodTransform<Awaited<NewOut>, z.output<S>>>,
    Flags,
    N
  > {
    return this.rebuild(this.schema.transform(fn), this.native);
  }
  /** Zod pipe — feed this field's output into `target`; the stored (wire) type stays `this`. */
  pipe<T extends z.core.$ZodType<unknown, z.output<S>>>(
    target: T,
  ): SFieldBase<z.ZodPipe<S, T>, Flags, N> {
    return this.rebuild(
      this.schema.pipe(target) as z.ZodPipe<S, T>,
      this.native,
    );
  }
  /** Peel one wrapper (optional/nullable/default/prefault/catch/readonly/array) off the field. */
  unwrap(): SFieldBase<InnerOf<S>, Flags, N> {
    const def = this.schema._zod.def as {
      innerType?: z.ZodType;
      element?: z.ZodType;
    };
    const inner = def.innerType ?? def.element ?? this.schema;
    return this.rebuild(inner, this.native) as unknown as SFieldBase<
      InnerOf<S>,
      Flags,
      N
    >;
  }

  /** Allow arbitrary extra keys on the field's object(s) — `FLEXIBLE` in DDL. Mirrors Zod's `.loose()`,
   *  but descends through `array`/`set`/union/wrapper layers so `s.array(s.object({…})).flexible()`
   *  emits `array<object> FLEXIBLE`. Only valid on object-typed fields (a compile error otherwise). */
  loose(this: ObjectModeReceiver<S, this>): this {
    return (this as SFieldBase<S, Flags, N>).objectMode("loose") as this;
  }
  /** Reject unknown keys on the field's object(s) — non-`FLEXIBLE` (the default). Mirrors Zod's
   *  `.strict()`; descends like {@link loose}. Only valid on object-typed fields. */
  strict(this: ObjectModeReceiver<S, this>): this {
    return (this as SFieldBase<S, Flags, N>).objectMode("strict") as this;
  }
  /** Alias for {@link loose} — a `FLEXIBLE` object accepting arbitrary keys. */
  flexible(this: ObjectModeReceiver<S, this>): this {
    return (this as SFieldBase<S, Flags, N>).objectMode("loose") as this;
  }
  private objectMode(mode: "loose" | "strict"): this {
    const next = applyObjectMode(this.schema, mode) as S;
    return this.rebuild(next, this.native) as unknown as this;
  }
}

/** Recursively set the object-mode (`loose`/`strict`) on every object contained in a schema —
 *  directly, or inside an `array`/`set` element, a union member, or an `optional`/`nullable`/
 *  `default`/`prefault`/`readonly`/`catch` wrapper. Non-object leaves pass through unchanged. Uses
 *  Zod's `.clone(def)` so element/wrapper CHECKS (e.g. array `.max()` -> `array<…, N>`) survive. */
function applyObjectMode(
  schema: z.ZodType,
  mode: "loose" | "strict",
): z.ZodType {
  // biome-ignore lint/suspicious/noExplicitAny: walking Zod's internal def shape.
  const def = (schema as any)._zod.def;
  switch (def?.type) {
    case "object": {
      const obj = schema as unknown as {
        loose: () => z.ZodType;
        strict: () => z.ZodType;
      };
      const next = mode === "loose" ? obj.loose() : obj.strict();
      // Carry the nested-field registry forward so DDL/create-shaping still see the subfields.
      const fields = objectFieldsRegistry.get(schema);
      if (fields) objectFieldsRegistry.set(next, fields);
      return next;
    }
    case "array":
    case "set": {
      const key = "element" in def ? "element" : "valueType";
      // biome-ignore lint/suspicious/noExplicitAny: .clone(def) is Zod-internal but check-preserving.
      return (schema as any).clone({
        ...def,
        [key]: applyObjectMode(def[key], mode),
      });
    }
    case "union":
      // biome-ignore lint/suspicious/noExplicitAny: .clone(def) is Zod-internal.
      return (schema as any).clone({
        ...def,
        options: (def.options as z.ZodType[]).map((o) =>
          applyObjectMode(o, mode),
        ),
      });
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
      // biome-ignore lint/suspicious/noExplicitAny: .clone(def) is Zod-internal.
      return (schema as any).clone({
        ...def,
        innerType: applyObjectMode(def.innerType, mode),
      });
    default:
      return schema; // not object-containing — no-op (the type guard rejects this at author time)
  }
}

/**
 * The SurrealDB field — the dialect extension of {@link SFieldBase}. Adds SurrealDB-native authoring
 * (the `$`-methods over `SurrealMeta`: DEFAULT/VALUE/ASSERT/PERMISSIONS/REFERENCE/…) and re-types the
 * inherited portable Zod wrappers so a chain stays a `SField`. `s.*` produces these. In the package
 * split this class moves to `@schemic/surrealdb` (see docs/AUTHORING-SPLIT.md).
 */
export class SField<
  S extends z.ZodType = z.ZodType,
  Flags extends string = never,
> extends SFieldBase<S, Flags, SurrealMeta> {
  constructor(schema: S, surreal: SurrealMeta = {}) {
    super(schema, surreal);
  }
  /** The SurrealDB-native field metadata (DEFAULT/VALUE/ASSERT/PERMISSIONS/…). */
  get surreal(): SurrealMeta {
    return this.native;
  }
  protected rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: SurrealMeta,
  ): SField<S2, F2> {
    return new SField<S2, F2>(schema, native);
  }
  protected blank(): SurrealMeta {
    return {};
  }

  // Re-type the inherited schema-changing portable wrappers so a chain keeps its `SField` type. These
  // are real METHOD overrides (not `declare` properties) so they stay method-bivariant — a property
  // would be param-contravariant and break table-name covariance / record-id `default` (see below).
  // Each just delegates to the SFieldBase body (which rebuilds a SField via the `rebuild` hook).
  override optional(): SField<z.ZodOptional<S>, Flags> {
    return super.optional() as SField<z.ZodOptional<S>, Flags>;
  }
  override nullable(): SField<z.ZodNullable<S>, Flags> {
    return super.nullable() as SField<z.ZodNullable<S>, Flags>;
  }
  override default(value: z.input<S>): SField<z.ZodDefault<S>, Flags> {
    return super.default(value) as SField<z.ZodDefault<S>, Flags>;
  }
  override prefault(value: z.input<S>): SField<z.ZodPrefault<S>, Flags> {
    return super.prefault(value) as SField<z.ZodPrefault<S>, Flags>;
  }
  override catch(value: z.output<S>): SField<z.ZodCatch<S>, Flags> {
    return super.catch(value) as SField<z.ZodCatch<S>, Flags>;
  }
  override array(): SField<z.ZodArray<S>, Flags> {
    return super.array() as SField<z.ZodArray<S>, Flags>;
  }
  override nullish(): SField<z.ZodOptional<z.ZodNullable<S>>, Flags> {
    return super.nullish() as SField<z.ZodOptional<z.ZodNullable<S>>, Flags>;
  }
  override or<F extends AnyField | z.ZodType>(
    other: F,
  ): SField<z.ZodUnion<[S, SchemaOf<F>]>> {
    return super.or(other) as SField<z.ZodUnion<[S, SchemaOf<F>]>>;
  }
  override and<F extends AnyField | z.ZodType>(
    other: F,
  ): SField<z.ZodIntersection<S, SchemaOf<F>>> {
    return super.and(other) as SField<z.ZodIntersection<S, SchemaOf<F>>>;
  }
  override readonly(): SField<z.ZodReadonly<S>, Flags> {
    return super.readonly() as SField<z.ZodReadonly<S>, Flags>;
  }
  override transform<NewOut>(
    fn: (arg: z.output<S>, ctx: z.core.$RefinementCtx<z.output<S>>) => NewOut,
  ): SField<z.ZodPipe<S, z.ZodTransform<Awaited<NewOut>, z.output<S>>>, Flags> {
    return super.transform(fn) as SField<
      z.ZodPipe<S, z.ZodTransform<Awaited<NewOut>, z.output<S>>>,
      Flags
    >;
  }
  override pipe<T extends z.core.$ZodType<unknown, z.output<S>>>(
    target: T,
  ): SField<z.ZodPipe<S, T>, Flags> {
    return super.pipe(target) as SField<z.ZodPipe<S, T>, Flags>;
  }
  override unwrap(): SField<InnerOf<S>, Flags> {
    return super.unwrap() as unknown as SField<InnerOf<S>, Flags>;
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
   * `COMPUTED <expr>` — a derived, read-only column computed from other fields. Never written, so
   * it's create-OPTIONAL: `s.string().$computed(surql\`string::concat(first, " ", last)\`)`.
   */
  $computed(expr: BoundQuery): SField<S, Flags | "create"> {
    return new SField(this.schema, { ...this.surreal, computed: expr });
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
  /**
   * Index this field — `DEFINE INDEX <name> ON TABLE <table> FIELDS <field>`. `name` overrides the
   * derived `<table>_<field>_idx` index name.
   */
  $index(name?: string): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      index: { ...this.surreal.index, ...(name !== undefined ? { name } : {}) },
    });
  }
  /** Index this field with a uniqueness constraint (`… UNIQUE`). `name` overrides the derived name. */
  $unique(name?: string): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      index: {
        ...this.surreal.index,
        unique: true,
        ...(name !== undefined ? { name } : {}),
      },
    });
  }
  /**
   * Full-text search index over this field — `… FIELDS <field> FULLTEXT [ANALYZER <analyzer>]
   * [BM25[(k1,b)]] [HIGHLIGHTS]`. The analyzer is optional — omit it (`.$fulltext()`) and SurrealDB
   * uses its built-in `like` analyzer; pass a {@link defineAnalyzer} name/def for real tokenizing:
   *   `.$fulltext()` · `.$fulltext("english")` · `.$fulltext(english)` · `.$fulltext({ analyzer: english, bm25: true, highlights: true })`.
   * `bm25: true` is default scoring, `[k1, b]` tunes it; `highlights` enables `search::highlight`.
   * The DEFAULT analyzer/bm25 are omitted from emitted DDL (SurrealDB always applies them) — see
   * {@link FulltextOptions}. Mutually exclusive with `.$unique()`.
   */
  $fulltext(analyzer?: string | AnalyzerDef): SField<S, Flags>;
  $fulltext(opts: FulltextFieldOptions): SField<S, Flags>;
  $fulltext(
    arg?: string | AnalyzerDef | FulltextFieldOptions,
  ): SField<S, Flags> {
    const opts: FulltextFieldOptions =
      arg === undefined || typeof arg === "string" || arg instanceof AnalyzerDef
        ? { analyzer: arg }
        : arg;
    const analyzer =
      opts.analyzer instanceof AnalyzerDef ? opts.analyzer.name : opts.analyzer;
    return this.withIndexSpec(
      buildIndexSpec({
        fulltext: { analyzer, bm25: opts.bm25, highlights: opts.highlights },
      }),
      opts.name,
    );
  }
  /** HNSW vector index over this field (an `array<number>` embedding). `name` overrides the derived name. */
  $hnsw(opts: HnswOptions & { name?: string }): SField<S, Flags> {
    return this.withIndexSpec(buildIndexSpec({ hnsw: opts }), opts.name);
  }
  /** DISKANN vector index over this field (an `array<number>` embedding). `name` overrides the derived name. */
  $diskann(opts: DiskannOptions & { name?: string }): SField<S, Flags> {
    return this.withIndexSpec(buildIndexSpec({ diskann: opts }), opts.name);
  }
  /** Set a FULLTEXT/HNSW/DISKANN index `spec` (+ optional custom `name`) on this field. */
  private withIndexSpec(
    spec: string | undefined,
    name?: string,
  ): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      index: {
        ...this.surreal.index,
        ...(spec !== undefined ? { spec } : {}),
        ...(name !== undefined ? { name } : {}),
      },
    });
  }
  /** @deprecated Renamed to {@link SField.$index} — field DDL clauses are `$`-prefixed. */
  index(name?: string): SField<S, Flags> {
    return this.$index(name);
  }
  /** @deprecated Renamed to {@link SField.$unique} — field DDL clauses are `$`-prefixed. */
  unique(name?: string): SField<S, Flags> {
    return this.$unique(name);
  }
  /**
   * Mark a record-link field as a `REFERENCE` so the DB tracks back-links (`$`-prefixed like the other
   * DDL clauses). `onDelete` sets the `ON DELETE` action — `"reject" | "cascade" | "ignore" | "unset"`,
   * or a `surql` expression (emitted as `ON DELETE THEN …`). Omit it for a bare `REFERENCE`.
   */
  $reference(opts?: {
    onDelete?: "reject" | "cascade" | "ignore" | "unset" | BoundQuery;
  }): SField<S, Flags> {
    return new SField(this.schema, {
      ...this.surreal,
      reference:
        opts?.onDelete === undefined ? true : { onDelete: opts.onDelete },
    });
  }
  /**
   * Teach @schemic/core how to store this value in SurrealDB: give the **wire type** as an `s.*`
   * field (its SurrealQL DDL type and Zod schema are derived from it) plus a codec
   * (`encode`: app -> wire, `decode`: wire -> app). This turns an otherwise-unmappable field
   * (e.g. `s.custom`/`s.instanceof`) into a real table field and clears the no-mapping brand;
   * `s.input<>` then reports the wire type. Omit the codec for an identity mapping (the app
   * value is stored as-is). `$`-prefixed to avoid clashing with Zod.
   */
  $surreal<WF extends AnyField | z.ZodType, A = z.output<S>>(
    wire: WF,
    codec?: {
      encode: (app: A) => z.output<SchemaOf<WF>>;
      decode: (wire: z.output<SchemaOf<WF>>) => A;
    },
  ): SField<z.ZodCodec<SchemaOf<WF>, S>, Exclude<Flags, NoDdl>> {
    const wireSchema = toZod(wire) as SchemaOf<WF>;
    const c = z.codec(wireSchema, this.schema, {
      decode: (w) => (codec ? codec.decode(w as never) : w) as never,
      encode: (a) => (codec ? codec.encode(a as A) : a) as never,
    });
    return new SField(c, this.surreal) as SField<
      z.ZodCodec<SchemaOf<WF>, S>,
      Exclude<Flags, NoDdl>
    >;
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

/** Like `datetimeCodec`, but the app side coerces to `Date` (`s.coerce.date`). Same `datetime` DDL. */
function coercedDatetimeCodec() {
  const codec = z.codec(z.instanceof(DateTime), z.coerce.date(), {
    decode: (dt): Date => new Date(dt.toString()),
    // the schema coerces the value to a `Date` before `encode` runs (typed `unknown` by Zod).
    encode: (d) => new DateTime(d as Date),
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
    // The `this`-returning Zod passthroughs (refine/check/…) wrap the schema and rebuild via the hook
    // below; this lets such a rebuild carry the wrapped schema instead of rebuilding the bare record
    // schema. Defaults to the record schema for the normal `s.recordId(...)` construction.
    schemaOverride?: z.ZodType<RecordId<T, V>, RecordId<T, V>>,
  ) {
    super(schemaOverride ?? recordIdSchema<T, V>(tables, valueType), surreal);
  }

  // The base `this`-returning wrappers (refine/superRefine/check/…) construct via `rebuild`. SField's
  // rebuild makes a plain SField, which would make `this` (typed RecordIdField) a LIE at runtime —
  // `s.recordId("x").refine(p).for(id)` would crash. Override so those chains stay a RecordIdField
  // (the schema-CHANGING wrappers like `.optional()` still narrow to SField via SField's overrides).
  protected override rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: SurrealMeta,
  ): SField<S2, F2> {
    return new RecordIdField<T, V>(
      this.tables,
      this.valueType,
      native,
      schema as unknown as z.ZodType<RecordId<T, V>, RecordId<T, V>>,
    ) as unknown as SField<S2, F2>;
  }

  /** Restrict the id value's type — reflected as `RecordId<T, V>` and validated at runtime. */
  type<V2 extends RecordIdValue>(schema: z.ZodType<V2>): RecordIdField<T, V2> {
    return new RecordIdField<T, V2>(this.tables, schema, this.surreal);
  }

  /** Build a RecordId. Single-table: `for(id)`; multi-table: `for(table, id)`. */
  for(idOrTable: V | T, id?: V): RecordId<T, V> {
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

/**
 * Internal `Flags` brand for a field with no SurrealQL mapping. It rides the `Flags` channel,
 * so it survives every wrapper (`.optional()`/`.array()`/…); `defineTable`/`defineRelation`
 * reject a branded field at compile time, and `.$surreal(...)` clears it. (Runtime `inferField`
 * is the backstop for nested/dynamic shapes.)
 */
type NoDdl = "~no-ddl";
const noDdl = <S extends z.ZodType>(f: SField<S>): SField<S, NoDdl> =>
  f as SField<S, NoDdl>;
type ZodsOf<T extends readonly (AnyField | z.ZodType)[]> = {
  -readonly [K in keyof T]: SchemaOf<T[K]>;
};

/** Field constructors — the authoring surface. */
export const s = {
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

  // String fields validated by SurrealDB's `string::is_*` (no Zod format — plain string
  // app-side, the baked ASSERT enforces the format in the DB).
  alpha: () => formatField(z.string(), "alpha"),
  alphanum: () => formatField(z.string(), "alphanum"),
  ascii: () => formatField(z.string(), "ascii"),
  numeric: () => formatField(z.string(), "numeric"),
  semver: () => formatField(z.string(), "semver"),
  hexadecimal: () => formatField(z.string(), "hexadecimal"),
  latitude: () => formatField(z.string(), "latitude"),
  longitude: () => formatField(z.string(), "longitude"),
  ip: () => formatField(z.string(), "ip"),
  domain: () => formatField(z.string(), "domain"),

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
  /**
   * A `record<…>` link. Pass a table name, the imported `TableDef`/`RelationDef`, or an array for a
   * multi-table union — `s.recordId(User)`, `s.recordId([User, Service])` — so a table's name is
   * only ever written in its own definition. (For a single-table link `User.record()` is preferred:
   * it also carries the id value type; `User.record().or(Post.record())` composes a union.)
   *
   * Called with NO argument — `s.recordId()` — it emits a bare `record` (a link to ANY table), since a
   * record id's table is optional in SurrealDB.
   */
  recordId: <T extends string | AnyTable = string>(
    table?: T | readonly T[],
  ): RecordIdField<T extends string ? T : NamesOf<T>> =>
    new RecordIdField(
      (table === undefined ? [] : Array.isArray(table) ? table : [table]).map(
        (t) => (typeof t === "string" ? t : t.name),
      ) as (T extends string ? T : NamesOf<T>)[],
    ),
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
  /** An array of `element`. `opts.max` -> sized `array<T, N>` (N is the MAX length). */
  array: <F extends AnyField | z.ZodType>(
    element: F,
    opts?: { max?: number },
  ): SField<z.ZodArray<SchemaOf<F>>> => {
    const base = (
      element instanceof SField ? element : new SField(element)
    ).array() as SField<z.ZodArray<SchemaOf<F>>>;
    return opts?.max === undefined
      ? base
      : new SField(base.schema.max(opts.max), base.surreal);
  },
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
  /** A `Set<element>` -> SurrealQL `set<element>`. `opts.max` -> sized `set<T, N>` (MAX). */
  set: <V extends AnyField | z.ZodType>(
    element: V,
    opts?: { max?: number },
  ): SField<z.ZodSet<SchemaOf<V>>> => {
    const base = z.set(toZod(element) as SchemaOf<V>);
    return new SField(
      opts?.max === undefined ? base : base.max(opts.max),
    ) as SField<z.ZodSet<SchemaOf<V>>>;
  },
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

  /** Optional **and** nullable — Zod's `nullish`. */
  nullish: <F extends AnyField | z.ZodType>(
    field: F,
  ): SField<z.ZodNullable<z.ZodOptional<SchemaOf<F>>>, FlagsOf<F>> => {
    const f = field instanceof SField ? field : new SField(field);
    return f.optional().nullable() as SField<
      z.ZodNullable<z.ZodOptional<SchemaOf<F>>>,
      FlagsOf<F>
    >;
  },

  /**
   * Zod-style coercion. Each maps to the **same** SurrealQL type as its non-coerced builder —
   * coercion only loosens the app/input side; the DB/wire type is unchanged.
   */
  coerce: {
    string: () => new SField(z.coerce.string()),
    number: () => new SField(z.coerce.number()),
    boolean: () => new SField(z.coerce.boolean()),
    bigint: () => new SField(z.coerce.bigint()),
    date: () => new SField(coercedDatetimeCodec()),
  },

  // Catch-alls.
  any: () => new SField(z.any()),
  unknown: () => new SField(z.unknown()),
  null: () => new SField(z.null()),

  // --- Non-Surreal types ---
  // Present so a global `z.*` -> `s.*` swap never collides. They carry NO SurrealQL mapping,
  // so they're rejected as a table field at compile time (and by `inferField` at runtime) —
  // unless you teach them to serialize via `.$surreal(type, codec)`.
  symbol: () => noDdl(new SField(z.symbol())),
  undefined: () => noDdl(new SField(z.undefined())),
  void: () => noDdl(new SField(z.void())),
  never: () => noDdl(new SField(z.never())),
  nan: () => noDdl(new SField(z.nan())),
  custom: <T>(check?: (val: unknown) => boolean) =>
    noDdl(new SField(z.custom<T>(check))),
  instanceof: <T extends Parameters<typeof z.instanceof>[0]>(cls: T) =>
    noDdl(new SField(z.instanceof(cls))),
  promise: <F extends AnyField | z.ZodType>(schema: F) =>
    noDdl(new SField(z.promise(toZod(schema)))),
  /** Zod's function factory (not a schema/field — present for drop-in `z.*` parity). */
  function: (...args: Parameters<typeof z.function>) => z.function(...args),
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
 * The schema type returned by `s.object`: a plain `z.ZodObject` carrying its original
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

/**
 * Renameable field-name refs for the `.index(name, t => [t.a, t.b])` callback form. A HOMOMORPHIC
 * mapped type (`{ [K in keyof S]: K }`), so the LSP links each `t.<field>` back to its definition in
 * the `defineTable(…)` shape — enabling go-to-definition and rename, which a `["a","b"]` string array
 * cannot. Each property's value IS its own name, so the callback returns plain field-name strings.
 */
export type FieldRefs<S extends Shape> = { readonly [K in keyof S]: K };

/** Build the runtime {@link FieldRefs} accessor: every field key mapped to itself. */
function fieldRefs<S extends Shape>(fields: Fields<S>): FieldRefs<S> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(fields)) out[k] = k;
  return out as FieldRefs<S>;
}

export interface TableConfig {
  schemafull: boolean;
  /** Table `TYPE`: `normal` (default) or `any` (holds both records and graph edges). */
  type?: "normal" | "any";
  drop?: boolean;
  comment?: string;
  /** Table-level `PERMISSIONS`. Omitted ops default to NONE in SurrealDB. See `.permissions()`. */
  permissions?: TablePermissions;
  relation?: { from: string[]; to: string[]; enforced?: boolean };
  /** Composite (multi-field) indexes. See `.index(name, fields, opts)`. */
  indexes?: TableIndex[];
  /** Row-change events. See `.event(name, { when?, then })`. */
  events?: TableEvent[];
  /** `CHANGEFEED <dur> [INCLUDE ORIGINAL]`. See `.changefeed(dur, opts?)`. */
  changefeed?: { expiry: string; includeOriginal?: boolean };
  /**
   * A pre-computed (materialized) VIEW — `AS <SELECT …>`. When set, the table is computed from the
   * query (forced `TYPE ANY SCHEMALESS`, no authored fields). See {@link defineView}.
   */
  view?: Expr;
}

/** A table index definition (single- or multi-field, or a row-count index). */
export interface TableIndex {
  name: string;
  fields: string[];
  unique?: boolean;
  /** A materialized row-count index (`DEFINE INDEX … COUNT`, no fields). */
  count?: boolean;
  /** `COMMENT <string>` on the index. */
  comment?: string;
  /**
   * A special index spec appended after `FIELDS` — a vector (`HNSW …`/`DISKANN …`) or full-text
   * (`FULLTEXT ANALYZER …`) index. Built from the `.index()` opts; minimal form (SurrealDB
   * materializes the rest), so it round-trips against the introspected, canonicalized spec.
   */
  spec?: string;
}

/** Options for a HNSW vector index (`.index(name, [field], { hnsw: {…} })`). */
export interface HnswOptions {
  dimension: number;
  dist?: "euclidean" | "cosine" | "manhattan" | "minkowski" | "hamming";
  type?: "f64" | "f32" | "i64" | "i32" | "i16";
  efc?: number;
  m?: number;
}
/** Options for a DISKANN vector index (`.index(name, [field], { diskann: {…} })`). */
export interface DiskannOptions {
  dimension: number;
  dist?: "euclidean" | "cosine" | "manhattan";
  type?: "f64" | "f32" | "i64" | "i32" | "i16";
  degree?: number;
  l_build?: number;
  alpha?: number;
}
/** Options for a FULL-TEXT search index (`.index(name, [field], { fulltext: {…} })`). All fields are
 *  optional — bare `{ fulltext: {} }` emits `DEFINE INDEX … FULLTEXT`, which SurrealDB accepts.
 *
 *  NOTE ON DEFAULTS: SurrealDB materializes two defaults on every full-text index, so they are OMITTED
 *  from the generated DDL (the database re-applies them on apply) and stripped from the canonical form
 *  so authoring and introspection stay in sync:
 *   - `analyzer` — omit it and SurrealDB injects its built-in `like` analyzer (`INFO` reports
 *     `… ANALYZER like`). A real {@link defineAnalyzer} name is required for proper tokenizing/stemming.
 *   - `bm25` — always-on; `true` / `[1.2, 0.75]` is the default and is dropped. Only a NON-default
 *     `bm25: [k1, b]` (and a non-`like` analyzer) survive into the `DEFINE INDEX`. */
export interface FulltextOptions {
  analyzer?: string;
  bm25?: boolean | [number, number];
  highlights?: boolean;
}

/** Options for the field-level `.$fulltext({…})` form. `analyzer` (optional) accepts the `AnalyzerDef`
 *  or its name — omit it for SurrealDB's built-in `like`; `name` overrides the derived
 *  `<table>_<field>_idx` index name. The default `analyzer`/`bm25` are omitted from emitted DDL — see
 *  {@link FulltextOptions}. See {@link SField.$fulltext}. */
export interface FulltextFieldOptions {
  analyzer?: string | AnalyzerDef;
  bm25?: boolean | [number, number];
  highlights?: boolean;
  name?: string;
}

/** Options for the composite `table.index(name, fields, opts)` — UNIQUE/COUNT/COMMENT or a vector/
 *  full-text spec. See {@link TableDef.index}. */
export interface IndexOptions {
  unique?: boolean;
  count?: boolean;
  comment?: string;
  /** A HNSW vector index over the field. */
  hnsw?: HnswOptions;
  /** A DISKANN vector index over the field. */
  diskann?: DiskannOptions;
  /** A full-text search index — needs a `defineAnalyzer` of `analyzer`'s name. */
  fulltext?: FulltextOptions;
}

/** Build the special index spec string (minimal — SurrealDB fills in the rest). */
function buildIndexSpec(opts: {
  hnsw?: HnswOptions;
  diskann?: DiskannOptions;
  fulltext?: FulltextOptions;
}): string | undefined {
  if (opts.hnsw) {
    const h = opts.hnsw;
    let s = `HNSW DIMENSION ${h.dimension}`;
    if (h.dist) s += ` DIST ${h.dist.toUpperCase()}`;
    if (h.type) s += ` TYPE ${h.type.toUpperCase()}`;
    if (h.efc !== undefined) s += ` EFC ${h.efc}`;
    if (h.m !== undefined) s += ` M ${h.m}`;
    return s;
  }
  if (opts.diskann) {
    const d = opts.diskann;
    let s = `DISKANN DIMENSION ${d.dimension}`;
    if (d.dist) s += ` DIST ${d.dist.toUpperCase()}`;
    if (d.type) s += ` TYPE ${d.type.toUpperCase()}`;
    if (d.degree !== undefined) s += ` DEGREE ${d.degree}`;
    if (d.l_build !== undefined) s += ` L_BUILD ${d.l_build}`;
    if (d.alpha !== undefined) s += ` ALPHA ${d.alpha}`;
    return s;
  }
  if (opts.fulltext) {
    const f = opts.fulltext;
    let s = "FULLTEXT"; // analyzer optional — omit it and SurrealDB injects its built-in `like`.
    if (f.analyzer) s += ` ANALYZER ${f.analyzer}`;
    if (Array.isArray(f.bm25)) s += ` BM25(${f.bm25[0]},${f.bm25[1]})`;
    else if (f.bm25) s += " BM25"; // `true` → bare BM25 (SurrealDB's default k1=1.2,b=0.75)
    if (f.highlights) s += " HIGHLIGHTS";
    return s;
  }
  return undefined;
}

/** A SurrealQL expression: a `surql\`…\`` bound query (bindings inlined) or a raw string. */
export type Expr = BoundQuery | string;

/**
 * A table event: `DEFINE EVENT <name> ON TABLE <table> [WHEN <when>] THEN <then>`. The event
 * body sees `$before`/`$after`/`$event`/`$value`. `then` may be one expression or several
 * (run in order). Author expressions with `surql\`…\`` (bindings inline) or a raw string.
 */
/** `ASYNC` runs the event off the write path. `true` is a bare `ASYNC`; the object form tunes
 *  `RETRY @retry` (re-runs on failure) and/or `MAXDEPTH @max_depth` (cascade-recursion limit). */
export type EventAsync = boolean | { retry?: number; maxDepth?: number };

export interface TableEvent {
  name: string;
  when?: Expr;
  then: Expr | Expr[];
  /** `ASYNC [RETRY @retry] [MAXDEPTH @max_depth]` — fire the event asynchronously. */
  async?: EventAsync;
  /** `COMMENT @string` — a stored description. */
  comment?: string;
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

/** If `core` is a `ZodArray` whose (unwrapped) element is a registered `s.object`, return
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
 * of both `encode` and `safeEncode`). A nested `s.object` (or an array of one) recurses via
 * `safeEncodeInput`, so absent nested keys are OMITTED — on CREATE the DB fills their defaults;
 * on UPDATE `encodePartial` is deep-partial and pairs with `MERGE` (which deep-merges), so
 * omitted siblings are preserved. Leaf fields go through `z.safeEncode` (which validates);
 * issues are pushed into `issues` with their path prefixed by `path`, so the aggregate
 * `ZodError` carries fully-qualified paths. Object-LEVEL refinements on a nested `s.object`
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
 * `s.object`).
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
 * nested `s.object` (or array of one) via `safeEncodeInputAsync`. Backs the `*Async` writes. */
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
 * Recover the nested `Shape` of an `s.object` schema (`never` if the schema isn't one).
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
 * The element `Shape` of an `s.object(...).array()` field (`never` otherwise). Peels the
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
 * The create-input VALUE type for a field. A nested `s.object` recurses into its own
 * `CreateShape` (so nested `$default`/`"create"` fields become optional too); an array of
 * `s.object` becomes that nested create-shape's array; everything else is the plain app
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
// `CreateValue` so a nested `s.object`'s own create-optional fields (a nested `$default`)
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
 * `s.object` recurses into its own `UpdateShape` (every nested field optional); an array
 * of `s.object` becomes that update-shape's array; everything else is the plain app type
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
// nested `s.object` is itself a deep partial (every nested key optional), matching MERGE.
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

  /**
   * A SurrealDB `Table` instance for this table — for direct SDK calls that take a table reference,
   * e.g. `db.select(User.table)`. (For a record id, chain `User.record().for(id)`.)
   */
  get table(): Table<Name> {
    return new Table(this.name);
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
  /** `CHANGEFEED <dur> [INCLUDE ORIGINAL]` — track row changes for `SHOW CHANGES`. */
  changefeed(expiry: string, opts: { includeOriginal?: boolean } = {}) {
    return this.withConfig({
      changefeed: { expiry, includeOriginal: opts.includeOriginal },
    });
  }
  /**
   * Add a composite index: `DEFINE INDEX <name> ON TABLE <table> FIELDS <fields> [UNIQUE]`, or a
   * materialized row-count index with `{ count: true }` (no fields → `DEFINE INDEX <name> … COUNT`).
   *
   * `fields` is either a plain name array (`["a", "b"]`) or a callback over the table's field refs
   * (`(t) => [t.a, t.b]`). Prefer the callback: each `t.<field>` is a real property reference the LSP
   * can rename and go-to-definition, so an index survives a field rename — a string array can't.
   */
  index(
    name: string,
    fields: readonly (keyof S & string)[],
    opts?: IndexOptions,
  ): TableDef<Name, S>;
  index(
    name: string,
    fields: (t: FieldRefs<S>) => readonly (keyof S & string)[],
    opts?: IndexOptions,
  ): TableDef<Name, S>;
  index(
    name: string,
    fields:
      | readonly (keyof S & string)[]
      | ((t: FieldRefs<S>) => readonly (keyof S & string)[]),
    opts: IndexOptions = {},
  ): TableDef<Name, S> {
    const cols =
      typeof fields === "function" ? fields(fieldRefs(this.fields)) : fields;
    const index: TableIndex = {
      name,
      fields: [...cols],
      unique: opts.unique,
      count: opts.count,
      comment: opts.comment,
      spec: buildIndexSpec(opts),
    };
    return this.withConfig({
      indexes: [...(this.config.indexes ?? []), index],
    });
  }
  /**
   * Add a row-change event: `DEFINE EVENT <name> ON TABLE <table> [ASYNC …] [WHEN <when>] THEN <then>
   * [COMMENT …]`. The body sees `$before`/`$after`/`$event`/`$value`; author with `surql\`…\`` or a raw
   * string. `async` fires it off the write path; `comment` stores a description.
   */
  event(
    name: string,
    spec: {
      when?: Expr;
      then: Expr | Expr[];
      async?: EventAsync;
      comment?: string;
    },
  ) {
    const event: TableEvent = {
      name,
      when: spec.when,
      // biome-ignore lint/suspicious/noThenProperty: `then` is the SurrealQL THEN clause (a string/BoundQuery), not a PromiseLike.
      then: spec.then,
      async: spec.async,
      comment: spec.comment,
    };
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
/**
 * Reject a shape field carrying the `NoDdl` brand (no SurrealQL mapping) at compile time: the
 * offending key resolves to an error string, so the shape literal won't type-check. Give such a
 * field `.$surreal(type, codec)` to make it storable, or drop it.
 */
type RejectNoDdl<S extends Shape> = {
  // `string extends FlagsOf` -> flags are unresolved (e.g. the callback form leaves `S` broad);
  // only reject when the brand is a concrete member, never on the generic fallback.
  [K in keyof S]: string extends FlagsOf<S[K]>
    ? S[K]
    : NoDdl extends FlagsOf<S[K]>
      ? "no SurrealQL mapping for this field — give it `.$surreal(type, codec)` or remove it"
      : S[K];
};

// The output (id value) type of an authored `id` field — WITHOUT the widen-to-RecordIdValue fallback
// `IdValue` does, so `RejectBadId` can see whether it's actually a valid record-id value type.
type IdOutput<Id> =
  Id extends RecordIdField<string, infer V>
    ? V
    : Id extends SField<infer Sc, infer _>
      ? z.output<Sc>
      : Id extends z.ZodType
        ? z.output<Id>
        : never;

/** Compile-time guard: an explicit `id` field must have a valid `RecordIdValue` value type — a
 *  `s.symbol()`/`s.boolean()` id (not a valid id value) is rejected rather than silently widened. */
type RejectBadId<S extends Shape> = "id" extends keyof S
  ? [IdOutput<S["id"]>] extends [RecordIdValue]
    ? unknown
    : {
        id: "the `id` field's value must be a valid RecordId value type (string | number | bigint | uuid | array | object) — e.g. s.string(), s.int(), s.uuid()";
      }
  : unknown;

// biome-ignore lint/complexity/noBannedTypes: `{}` is the empty default shape — a bare table (just `id`), like defineRelation.
export function defineTable<Name extends string, S extends Shape = {}>(
  name: Name,
  // The object form is rejected at compile time (`RejectNoDdl` + `RejectBadId`); the callback form
  // keeps its precise `S` inference (a `& RejectNoDdl<S>` in a function-return position collapses it),
  // so a no-DDL field there is caught by the runtime `inferField` backstop instead. Omitting `shape`
  // gives a bare table (just the implicit `id`) — same as `defineRelation(name)`.
  shape?:
    | (S & RejectNoDdl<S> & RejectBadId<S>)
    | ((self: RecordIdField<Name>) => S),
): TableDef<Name, WithSmartId<Name, S>> {
  const resolved =
    shape === undefined
      ? ({} as S)
      : typeof shape === "function"
        ? shape(new RecordIdField([name]))
        : shape;
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
/** A single relation endpoint: a table def, a SurrealDB `Table` instance, or a bare table name. */
type TableLike = AnyTable | Table<string> | string;
/** A relation endpoint reference — one table, or an array (a `|`-union of `in`/`out` tables); mix freely. */
type TableRef = TableLike | readonly TableLike[];
/** The table-name string literal a single {@link TableLike} carries. */
type NameOf<T> = T extends string
  ? T
  : T extends TableDef<infer N extends string, infer _>
    ? N
    : T extends Table<infer N extends string>
      ? N
      : never;
/** The endpoint name(s) a {@link TableRef} carries — drives the typed `in`/`out` record links. */
type NamesOf<T> = T extends readonly (infer E)[] ? NameOf<E> : NameOf<T>;

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
  const arr = (Array.isArray(ref) ? ref : [ref]) as readonly TableLike[];
  return arr.map((t) => (typeof t === "string" ? t : t.name));
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
    private readonly isEnforced: boolean = false,
  ) {
    super(
      name,
      relationFields(name, edge, fromNames, toNames) as unknown as Fields<
        RelationShape<Name, S, In, Out>
      >,
      {
        schemafull: true,
        relation: {
          from: fromNames,
          to: toNames,
          ...(isEnforced ? { enforced: true } : {}),
        },
      },
    );
  }
  /** Restrict the source endpoint(s) (`in`) — a `TableDef`, a SurrealDB `Table`, a bare name string, or
   *  an array mixing them for a `FROM a | b` union. Endpoint names flow into the typed `in` record link. */
  from<F extends TableRef>(ref: F): RelationDef<Name, S, NamesOf<F>, Out> {
    return new RelationDef(
      this.name,
      this.edge,
      tableNames(ref),
      this.toNames,
      this.isEnforced,
    ) as unknown as RelationDef<Name, S, NamesOf<F>, Out>;
  }
  /** Restrict the target endpoint(s) (`out`) — a `TableDef`, a SurrealDB `Table`, a bare name string, or
   *  an array mixing them for a `TO a | b` union. Endpoint names flow into the typed `out` record link. */
  to<T extends TableRef>(ref: T): RelationDef<Name, S, In, NamesOf<T>> {
    return new RelationDef(
      this.name,
      this.edge,
      this.fromNames,
      tableNames(ref),
      this.isEnforced,
    ) as unknown as RelationDef<Name, S, In, NamesOf<T>>;
  }
  /** Require both endpoints to exist on RELATE (`TYPE RELATION … ENFORCED`). */
  enforced(): RelationDef<Name, S, In, Out> {
    return new RelationDef(
      this.name,
      this.edge,
      this.fromNames,
      this.toNames,
      true,
    ) as unknown as RelationDef<Name, S, In, Out>;
  }
}

/**
 * Define a graph relation (edge table). Endpoints are optional — the result is a usable table
 * right away; chain `.from(X).to(Y)` to restrict the `in`/`out` records.
 */
export function defineRelation<Name extends string, S extends Shape = {}>(
  name: Name,
  fields?: S & RejectNoDdl<S>,
): RelationDef<Name, S> {
  return new RelationDef(name, (fields ?? {}) as S);
}

/**
 * The intermediate of `defineView(name, shape?)` — call `.as(query)` to set the SELECT. The optional
 * `shape` is TYPE-ONLY: it types the projected rows (`App<typeof View>` + the `encode`/`decode` codecs)
 * but emits NO `DEFINE FIELD` — a view's rows are computed, so the DDL stays `TYPE ANY SCHEMALESS AS …`.
 */
export class ViewBuilder<Name extends string, S extends Shape> {
  constructor(
    private readonly name: Name,
    private readonly shape: S,
  ) {}
  /**
   * Set the view's query — `DEFINE TABLE <name> TYPE ANY SCHEMALESS AS <query>`. Returns a normal
   * table, so `.permissions()` / `.comment()` / `.changefeed()` chain after as on any table. The
   * `shape` must match the SELECT's projection (the query is freeform SurrealQL — unchecked).
   */
  as(query: Expr): TableDef<Name, WithSmartId<Name, S>> {
    return new TableDef(
      this.name,
      applySmartId(this.name, this.shape) as unknown as Fields<
        WithSmartId<Name, S>
      >,
      { schemafull: false, type: "any", view: query },
    );
  }
}

/**
 * Define a pre-computed (materialized) VIEW table — `defineView(name, shape?).as(query)` emits
 * `DEFINE TABLE <name> TYPE ANY SCHEMALESS AS <query>`. Its rows are computed from the SELECT (SurrealDB
 * keeps them in sync). The optional `shape` types the projected rows for `App`/decode (it emits no
 * fields). Chain `.permissions()` / `.comment()` / `.changefeed()` after `.as(…)` as on any table:
 *
 * ```ts
 * const Raw = defineView("raw").as(surql`SELECT * FROM person`);            // untyped rows
 * const Adults = defineView("adults", { name: s.string(), age: s.number() })
 *   .as(surql`SELECT name, age FROM person WHERE age >= 18`);               // App = { id, name, age }
 * ```
 */
export function defineView<Name extends string, S extends Shape = {}>(
  name: Name,
  shape?: S,
): ViewBuilder<Name, S> {
  return new ViewBuilder(name, (shape ?? ({} as S)) as S);
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
    readonly async?: EventAsync,
    readonly comment?: string,
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
  spec: {
    when?: Expr;
    then: Expr | Expr[];
    async?: EventAsync;
    comment?: string;
  },
): EventDef {
  const tableName = typeof table === "string" ? table : table.name;
  return new EventDef(
    tableName,
    name,
    spec.when,
    spec.then,
    spec.async,
    spec.comment,
  );
}

interface FunctionConfig {
  /** Return type (an s schema, inferred to a SurrealQL type — like a field). */
  returns?: AnyField;
  /** Function body: a `surql\`…\`` block (or raw string). Required to emit. */
  body?: Expr;
  /** `PERMISSIONS FULL` (true) / `NONE` (false) / a `surql` condition. */
  permissions?: boolean | Expr;
  comment?: string;
}

/** The typed argument object for calling a function — each named param as its **app** type
 *  (`{ a: s.int(), b: s.int() }` -> `{ a: number, b: number }`). */
export type CallArgs<A extends Shape> = { [K in keyof A]: App<A[K]> };

/**
 * A custom function — `DEFINE FUNCTION fn::<name>(<args>) [-> <returns>] { <body> }`. Built with a
 * chainable, immutable API (like {@link TableDef}): `defineFunction(name, args).returns(…).body(…)`.
 * Args and the return type are s schemas (inferred to SurrealQL types, same as table fields). The
 * generics carry the arg shape `A` and the decoded return type `R` so `.call(db, args)` is fully typed.
 */
export class FunctionDef<A extends Shape = Shape, R = unknown> {
  readonly kind = "function" as const;
  constructor(
    readonly name: string,
    /** Ordered named args, each an s schema. */
    readonly args: Record<string, AnyField>,
    readonly config: FunctionConfig = {},
  ) {}
  private withConfig<R2 = R>(c: Partial<FunctionConfig>): FunctionDef<A, R2> {
    return new FunctionDef<A, R2>(this.name, this.args, {
      ...this.config,
      ...c,
    });
  }
  /** Declare the return type (an s schema) — types `.call()`'s decoded result. */
  returns<RF extends AnyField>(type: RF): FunctionDef<A, App<RF>> {
    return this.withConfig<App<RF>>({ returns: type });
  }
  /** The function body — a `surql\`…\`` block (braces optional) or a raw string. */
  body(body: Expr): FunctionDef<A, R> {
    return this.withConfig({ body });
  }
  /** `PERMISSIONS`: `FULL` (true, the default), `NONE` (false), or a `surql` condition. */
  permissions(p: boolean | Expr): FunctionDef<A, R> {
    return this.withConfig({ permissions: p });
  }
  comment(comment: string): FunctionDef<A, R> {
    return this.withConfig({ comment });
  }
  /**
   * Invoke the function on a live connection — DB-functions-as-code. Args are passed by name (matching
   * the schema params) and **encoded** to wire via the param schemas; the raw result is **decoded**
   * through `.returns(R)` (so you get real `App` types — `Date`/`RecordId`/…). Without a declared
   * `.returns()`, the result type is `unknown`. The `args` object is optional for a no-param function.
   *
   * The query layer is opt-in, so its machinery is loaded lazily here — calling `.call()` keeps the
   * authoring index's static graph free of `@schemic/core/query` and the driver.
   */
  async call(
    db: Surreal,
    ...rest: Record<string, never> extends CallArgs<A>
      ? [args?: CallArgs<A>]
      : [args: CallArgs<A>]
  ): Promise<R> {
    const appArgs = (rest[0] ?? {}) as Record<string, unknown>;
    const encoded: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(this.args))
      encoded[key] = field.encode(appArgs[key] as never);
    const [{ callFunction }, { surrealDriver }] = await Promise.all([
      import("@schemic/core/query"),
      import("./driver/surreal"),
    ]);
    const callable = surrealDriver.callable;
    if (!callable)
      throw new Error("the surrealdb driver has no `callable` capability.");
    const returns = this.config.returns?.schema ?? z.unknown();
    return callFunction(
      callable,
      db,
      this.name,
      encoded,
      returns,
    ) as Promise<R>;
  }
}

/**
 * Declare a custom function as a standalone, exportable object:
 * `export const greet = defineFunction("greet", { name: s.string() }).returns(s.string()).body(surql\`…\`)`.
 * Emitted as `DEFINE FUNCTION fn::greet(...)`. Args are s schemas (inferred to SurrealQL types); the
 * arg shape flows into `.call(db, args)` typing.
 */
export function defineFunction<A extends Shape = Record<string, never>>(
  name: string,
  args: A = {} as A,
): FunctionDef<A> {
  return new FunctionDef<A>(
    name,
    normalizeFields(args) as unknown as Record<string, AnyField>,
  );
}

/** The access type + its type-specific config. `RECORD` (default) / `JWT` / `BEARER`. */
export type AccessKind =
  | { type: "record" }
  | { type: "jwt"; alg?: string; key?: string; url?: string }
  | { type: "bearer"; subject: "record" | "user" };

/** Token/session/grant lifetimes, e.g. `{ token: "1h", session: "12h", grant: "30d" }`. */
export interface AccessDuration {
  grant?: string;
  token?: string;
  session?: string;
}

interface AccessConfig {
  /** `ON DATABASE` (default) or `ON NAMESPACE`. */
  on: "database" | "namespace";
  kind: AccessKind;
  /** RECORD-only: SIGNUP/SIGNIN/AUTHENTICATE blocks. */
  signup?: Expr;
  signin?: Expr;
  authenticate?: Expr;
  duration?: AccessDuration;
}

/**
 * An access definition — `DEFINE ACCESS <name> ON DATABASE TYPE …`. Chainable like {@link TableDef}.
 * Pick a type with `.record()` (default; SIGNUP/SIGNIN), `.jwt({ alg, key } | { url })` (validate
 * external tokens), or `.bearer({ for })` (API-key grants). The RECORD bodies are `surql\`…\`` blocks
 * (braces optional). NOTE: SurrealDB redacts signing keys in introspection, so `pull` can't recover
 * them — see the CLI (`--access` is opt-in for that reason).
 */
export class AccessDef {
  readonly kind = "access" as const;
  constructor(
    readonly name: string,
    readonly config: AccessConfig = {
      on: "database",
      kind: { type: "record" },
    },
  ) {}
  private withConfig(c: Partial<AccessConfig>): AccessDef {
    return new AccessDef(this.name, { ...this.config, ...c });
  }
  /** `TYPE RECORD` (the default) — end users sign up / sign in directly. */
  record(): AccessDef {
    return this.withConfig({ kind: { type: "record" } });
  }
  /** `TYPE JWT` — validate tokens from an external issuer: `{ alg, key }` (symmetric/PEM) or `{ url }` (JWKS). */
  jwt(opts: { alg?: string; key?: string; url?: string }): AccessDef {
    return this.withConfig({ kind: { type: "jwt", ...opts } });
  }
  /** `TYPE BEARER FOR USER|RECORD` — bearer-token / API-key grants. */
  bearer(opts: { for: "record" | "user" }): AccessDef {
    return this.withConfig({ kind: { type: "bearer", subject: opts.for } });
  }
  onNamespace(): AccessDef {
    return this.withConfig({ on: "namespace" });
  }
  onDatabase(): AccessDef {
    return this.withConfig({ on: "database" });
  }
  /** `SIGNUP { … }` (RECORD) — a `surql\`…\`` block (braces optional) run on sign-up. */
  signup(body: Expr): AccessDef {
    return this.withConfig({ signup: body });
  }
  /** `SIGNIN { … }` (RECORD) — a `surql\`…\`` block run on sign-in. */
  signin(body: Expr): AccessDef {
    return this.withConfig({ signin: body });
  }
  /** `AUTHENTICATE { … }` — a `surql\`…\`` block run on each authenticated request. */
  authenticate(body: Expr): AccessDef {
    return this.withConfig({ authenticate: body });
  }
  /** Token/session/grant lifetimes (`DURATION FOR TOKEN …, FOR SESSION …, FOR GRANT …`). */
  duration(d: AccessDuration): AccessDef {
    return this.withConfig({ duration: d });
  }
}

/**
 * Declare an access definition: `export const account = defineAccess("account").record()
 * .signup(surql\`…\`).signin(surql\`…\`).duration({ token: "1h", session: "12h" })`. See {@link AccessDef}
 * for `.jwt(…)` / `.bearer(…)`.
 */
export function defineAccess(name: string): AccessDef {
  return new AccessDef(name);
}

/** SurrealDB's built-in tokenizers (autocompletable). The list is open — any other string is accepted
 *  too (forward-compatible with tokenizers a newer server may add), via the `string & {}` escape. */
export type Tokenizer = "blank" | "camel" | "class" | "punct" | (string & {});

/** A token filter — a bare built-in (`ascii`/`lowercase`/`uppercase`, autocompletable) or a
 *  parameterized one built typesafely via the `.filters(f => …)` callback ({@link FilterBuilder}).
 *  The list is open: any other string is accepted too (forward-compatible / escape hatch). */
export type Filter = "ascii" | "lowercase" | "uppercase" | (string & {});

/** The 18 stemmer languages SurrealDB's `snowball` filter accepts (rust-stemmers). */
export type SnowballLanguage =
  | "arabic"
  | "danish"
  | "dutch"
  | "english"
  | "finnish"
  | "french"
  | "german"
  | "greek"
  | "hungarian"
  | "italian"
  | "norwegian"
  | "portuguese"
  | "romanian"
  | "russian"
  | "spanish"
  | "swedish"
  | "tamil"
  | "turkish";

/** Typed builders for token filters, handed to the `.filters(f => [...])` callback — so the
 *  parameterized filters (`snowball`/`ngram`/`edgengram`/`mapper`) are constructed with checked args
 *  instead of hand-written strings, and the bare ones are still available as `f.lowercase` etc. */
export interface FilterBuilder {
  readonly ascii: "ascii";
  readonly lowercase: "lowercase";
  readonly uppercase: "uppercase";
  /** `snowball(<language>)` — stemmer for one of the supported {@link SnowballLanguage}s. */
  snowball(language: SnowballLanguage): string;
  /** `ngram(<min>,<max>)` — character n-grams of length `min..max`. */
  ngram(min: number, max: number): string;
  /** `edgengram(<min>,<max>)` — edge n-grams (prefixes) of length `min..max`. */
  edgengram(min: number, max: number): string;
  /** `mapper("<path>")` — map tokens via a file (the path must point to an existing file). */
  mapper(path: string): string;
}

/** The singleton {@link FilterBuilder} passed to `.filters(f => …)`. */
const FILTER_BUILDER: FilterBuilder = {
  ascii: "ascii",
  lowercase: "lowercase",
  uppercase: "uppercase",
  snowball: (language) => `snowball(${language})`,
  ngram: (min, max) => `ngram(${min},${max})`,
  edgengram: (min, max) => `edgengram(${min},${max})`,
  mapper: (path) => `mapper(${JSON.stringify(path)})`,
};

/** A text-search `DEFINE ANALYZER`'s config: an ordered tokenizer + filter pipeline. */
export interface AnalyzerConfig {
  /** `FUNCTION fn::<name>` — the bare name of the custom tokenizing function the analyzer references. */
  function?: string;
  /** An inline function auto-created by `.function(input => surql\`…\`)` — auto-named `<analyzer>_fn`
   *  and emitted alongside the analyzer (the schema lowering expands it into the functions list, so it
   *  diffs/pulls as a normal `defineFunction`). Absent when `.function` was given a name/reference. */
  functionDef?: FunctionDef;
  /** `TOKENIZERS …` — e.g. `["blank", "class", "camel", "punct"]`. The built-ins autocomplete; any
   *  other string is allowed too (see {@link Tokenizer}). Optional: a bare `DEFINE ANALYZER <name>`
   *  (no tokenizers/filters) is valid SurrealQL. */
  tokenizers?: Tokenizer[];
  /** `FILTERS …` — e.g. `["lowercase", "ascii", "snowball(english)", "ngram(1,3)"]`. The built-in
   *  names autocomplete; parameterized forms + any other string are allowed too (see {@link Filter}). */
  filters?: Filter[];
  /** `COMMENT "…"` — a human description stored with the analyzer. */
  comment?: string;
}

/**
 * A text-search analyzer (`DEFINE ANALYZER`), referenced by a `FULLTEXT` index. A fluent builder
 * (like {@link AccessDef}); every clause is optional, so a bare `defineAnalyzer("text")` is valid:
 * `export const english = defineAnalyzer("english").tokenizers("blank").filters("lowercase", "snowball(english)")`.
 */
export class AnalyzerDef {
  readonly kind = "analyzer" as const;
  constructor(
    readonly name: string,
    readonly config: AnalyzerConfig = {},
  ) {}
  private withConfig(c: Partial<AnalyzerConfig>): AnalyzerDef {
    return new AnalyzerDef(this.name, { ...this.config, ...c });
  }
  /** `FUNCTION fn::<name>` — a custom tokenizing function run before the tokenizers. Pass:
   *  - a `surql` builder `input => surql\`…\`` — auto-defines an `<analyzer>_fn(input: string)` function
   *    inline (auto-named, like a field index) and references it; `input` is the `$input` param token;
   *  - a {@link FunctionDef} from `defineFunction` (renameable, no hardcoded name);
   *  - or the name as a string (the `fn::` prefix optional).
   *  Emitted as `FUNCTION fn::<name>` in every case. */
  function(fn: string | FunctionDef | ((input: Expr) => Expr)): AnalyzerDef {
    if (typeof fn === "function") {
      const def = defineFunction(`${this.name}_fn`, { input: s.string() }).body(
        fn(surql`$input`),
      );
      return this.withConfig({ function: def.name, functionDef: def });
    }
    return this.withConfig({ function: typeof fn === "string" ? fn : fn.name });
  }
  /** `TOKENIZERS …` — one or more tokenizers (built-ins autocomplete), applied in order. */
  tokenizers(...tokenizers: Tokenizer[]): AnalyzerDef {
    return this.withConfig({ tokenizers });
  }
  /** `FILTERS …` — one or more token filters, applied in order. Pass bare filters directly
   *  (`.filters("lowercase", "ascii")`), or a callback for the typed/parameterized builders
   *  (`.filters(f => [f.lowercase, f.snowball("english"), f.ngram(1, 3)])`) — no extra import needed. */
  filters(...filters: Filter[]): AnalyzerDef;
  filters(build: (f: FilterBuilder) => readonly Filter[]): AnalyzerDef;
  filters(
    ...args: [(f: FilterBuilder) => readonly Filter[]] | Filter[]
  ): AnalyzerDef {
    const list =
      typeof args[0] === "function"
        ? [...args[0](FILTER_BUILDER)]
        : (args as Filter[]);
    return this.withConfig({ filters: list });
  }
  /** `COMMENT "…"` — a human-readable description stored with the analyzer. */
  comment(comment: string): AnalyzerDef {
    return this.withConfig({ comment });
  }
}

/** Declare a text-search analyzer, then chain its clauses fluently — `defineAnalyzer("english")
 *  .tokenizers("class").filters("lowercase")`. Reference it from a `fulltext` index. A bare
 *  `defineAnalyzer("text")` emits `DEFINE ANALYZER text`. */
export function defineAnalyzer(name: string): AnalyzerDef {
  return new AnalyzerDef(name);
}

/** A schema object declared apart from a table (collected by the CLI loader and emitted on its own). */
export type StandaloneDef = EventDef | FunctionDef | AccessDef | AnalyzerDef;

/**
 * The underlying Zod schema of any s value: a field (`SField`), a table/relation def
 * (anything carrying an `.object`), or a raw Zod type.
 */
type ZodOf<T> = T extends { object: infer O }
  ? O extends z.ZodType
    ? O
    : never
  : SchemaOf<T>;

/** The app-facing type (what your code reads). Same as `s.output` / Zod's `infer`. */
export type App<T> = z.output<ZodOf<T>>;
/** The DB wire type (what crosses the wire). Same as `s.input`. */
export type Wire<T> = z.input<ZodOf<T>>;

/**
 * Zod-style inference helpers, exposed on `s` (a type-only namespace merged with the `s`
 * value — the same trick Zod uses for `z.infer`). They accept fields, table/relation defs,
 * and raw schemas alike:
 *   - `s.infer<T>` / `s.output<T>` / `s.TypeOf<T>` -> the decoded **app** type (== `App<T>`)
 *   - `s.input<T>`                                   -> the **wire/DB** type (== `Wire<T>`)
 */
export namespace s {
  export type infer<T> = z.output<ZodOf<T>>;
  export type output<T> = z.output<ZodOf<T>>;
  export type input<T> = z.input<ZodOf<T>>;
  export type TypeOf<T> = z.output<ZodOf<T>>;
  /** Any s field — the `z.ZodTypeAny` analogue, for typing generic schemas. */
  export type Field = AnyField;
}
/** The typed input for creating a record (DB-filled fields optional). */
export type Create<T> =
  T extends TableDef<string, infer S> ? CreateShape<S> : never;
/** The typed input for updating a record (partial; excludes id and readonly fields). */
export type Update<T> =
  T extends TableDef<string, infer S> ? UpdateShape<S> : never;
