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

/** SurrealQL DDL metadata — the `$`-prefixed field options. */
export interface SurrealMeta {
  default?: BoundQuery;
  defaultAlways?: boolean;
  value?: BoundQuery;
  assert?: BoundQuery;
  readonly?: boolean;
  comment?: string;
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
  $value(expr: BoundQuery): SField<S, Flags> {
    return new SField(this.schema, { ...this.surreal, value: expr });
  }
  $assert(expr: BoundQuery): SField<S, Flags> {
    return new SField(this.schema, { ...this.surreal, assert: expr });
  }
  $readonly(readonly = true): SField<S, Flags | "readonly"> {
    return new SField(this.schema, { ...this.surreal, readonly });
  }
  $comment(comment: string): SField<S, Flags> {
    return new SField(this.schema, { ...this.surreal, comment });
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
  email: () => new SField(z.email()),

  // String formats — all map to DDL `string` (their Zod def.type is "string").
  url: (params?: Parameters<typeof z.url>[0]) => new SField(z.url(params)),
  /** Surreal native `uuid`: a `string` app-side, stored as a `Uuid`. */
  uuid: () => new SField(uuidCodec()),
  guid: (params?: Parameters<typeof z.guid>[0]) => new SField(z.guid(params)),
  nanoid: (params?: Parameters<typeof z.nanoid>[0]) => new SField(z.nanoid(params)),
  cuid: (params?: Parameters<typeof z.cuid>[0]) => new SField(z.cuid(params)),
  cuid2: (params?: Parameters<typeof z.cuid2>[0]) => new SField(z.cuid2(params)),
  ulid: (params?: Parameters<typeof z.ulid>[0]) => new SField(z.ulid(params)),
  xid: (params?: Parameters<typeof z.xid>[0]) => new SField(z.xid(params)),
  ksuid: (params?: Parameters<typeof z.ksuid>[0]) => new SField(z.ksuid(params)),
  ipv4: (params?: Parameters<typeof z.ipv4>[0]) => new SField(z.ipv4(params)),
  ipv6: (params?: Parameters<typeof z.ipv6>[0]) => new SField(z.ipv6(params)),
  cidrv4: (params?: Parameters<typeof z.cidrv4>[0]) => new SField(z.cidrv4(params)),
  cidrv6: (params?: Parameters<typeof z.cidrv6>[0]) => new SField(z.cidrv6(params)),
  base64: (params?: Parameters<typeof z.base64>[0]) => new SField(z.base64(params)),
  base64url: (params?: Parameters<typeof z.base64url>[0]) => new SField(z.base64url(params)),
  e164: (params?: Parameters<typeof z.e164>[0]) => new SField(z.e164(params)),
  jwt: (params?: Parameters<typeof z.jwt>[0]) => new SField(z.jwt(params)),
  emoji: (params?: Parameters<typeof z.emoji>[0]) => new SField(z.emoji(params)),

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
type ZShape<S extends Shape> = { [K in keyof S]: SchemaOf<S[K]> };
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
type CreateShape<S extends Shape> = Prettify<
  { [K in keyof S as CreateOptional<S, K> extends true ? never : K]: AppOf<S[K]> } & {
    [K in keyof S as CreateOptional<S, K> extends true ? K : never]?: AppOf<S[K]>;
  }
>;

type UpdateExcluded<S extends Shape, K extends keyof S> = K extends "id"
  ? true
  : "readonly" extends FlagsOf<S[K]>
    ? true
    : false;
type UpdateShape<S extends Shape> = Prettify<{
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
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, f] of Object.entries(fields)) zshape[k] = (f as AnyField).schema;
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
