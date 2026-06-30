// The POSTGRES native authoring surface — `s.*` in pg vocabulary, built on the neutral core base
// (@schemic/core/authoring). A pg project authors with THESE types (pg lingo: text/varchar/numeric/
// timestamptz/jsonb/serial/...) and the driver lowers them to the portable IR (see ./lower.ts), then
// emits pg DDL. Per the multi-DB decision (every driver owns its own `s.*`), this mirrors
// @schemic/surrealdb's surface but in Postgres terms.
//
// Design constraints (Manuel):
//  - LAYER ON ZOD: every field IS a Zod schema (`PgField extends SFieldBase`); pg-native metadata
//    rides the field's opaque `native` slot (PgMeta), never patching Zod internals.
//  - ESCAPE HATCH: `s.$postgres(pgType, codec)` for any type not representable on the wire — a Zod
//    codec (encode/decode) App-side, stored as the given pg type (mirrors surreal's `$surreal`).
//  - DX FIRST: native types + `$`-methods ($default/$check/$generated/$identity/$unique/$primaryKey/
//    $references/$comment) + the full Zod wrapper/passthrough chain, all type-preserving.

import {
  type AnyField,
  type SchemaOf,
  SFieldBase,
  toZod,
} from "@schemic/core/authoring";
import * as z from "zod";

// --- PgMeta: the pg-native metadata bag carried on every field ----------------------------------

/** A pg column type token + optional params (`varchar`/[255], `numeric`/[10,2]); the leaf factory sets it. */
export interface PgTypeRef {
  type: string;
  params?: (string | number)[];
}

/** Postgres-native field metadata (the `native` slot of {@link PgField}). All optional; merged by `$`-methods. */
export interface PgMeta {
  /** The pg base type (sans option/nullable/array wrappers, which live on the Zod schema). */
  pg?: PgTypeRef;
  /** `DEFAULT <expr>` (verbatim SQL). */
  default?: string;
  /** Field-level `CHECK (<expr>)` (verbatim SQL boolean expr). */
  check?: string;
  /** `GENERATED ALWAYS AS (<expr>) STORED` (verbatim SQL expr). */
  generated?: string;
  /** `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` (also how `serial` is modeled). */
  identity?: "always" | "by-default";
  /** Column-level `UNIQUE`. */
  unique?: boolean;
  /** Column is (part of) the PRIMARY KEY. */
  primaryKey?: boolean;
  /** A foreign key to `table(id)` with optional referential actions. */
  references?: { table: string; onDelete?: string; onUpdate?: string };
  /** `COMMENT ON COLUMN`. */
  comment?: string;
}

const blankMeta = (): PgMeta => ({});

/** A raw SQL expression marker for DDL clauses (`$default`/`$check`/`$generated`) — spliced verbatim. */
export interface SqlExpr {
  readonly __sql: string;
}
/** Mark a string as a raw SQL expression (vs a literal value) for a DDL clause: `s.timestamptz().$default(sqlExpr("now()"))`. */
export const sqlExpr = (sql: string): SqlExpr => ({ __sql: sql });
const isSqlExpr = (v: unknown): v is SqlExpr =>
  typeof v === "object" && v !== null && "__sql" in v;

/** Render a JS literal as a Postgres literal (numbers/bools bare, strings single-quoted, null -> NULL). */
function pgLiteral(v: string | number | boolean | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${v.replace(/'/g, "''")}'`;
}
const toExpr = (v: string | number | boolean | null | SqlExpr): string =>
  isSqlExpr(v) ? v.__sql : pgLiteral(v);

// --- PgField: the dialect subclass -------------------------------------------------------------

/**
 * A Postgres field: a Zod schema (App/Wire typing) + {@link PgMeta} (pg-native DDL metadata). Extends
 * the neutral {@link SFieldBase}, which supplies the codecs, the Zod wrappers, and the `z.*` passthrough;
 * this subclass re-types the wrappers so a chain stays a `PgField`, and adds the pg `$`-methods.
 */
export class PgField<
  S extends z.ZodType = z.ZodType,
  Flags extends string = never,
> extends SFieldBase<S, Flags, PgMeta> {
  protected rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: PgMeta,
  ): PgField<S2, F2> {
    return new PgField<S2, F2>(schema, native);
  }
  protected blank(): PgMeta {
    return blankMeta();
  }

  // Type-only narrowing of the inherited portable wrappers (runtime impl is the base's, which builds a
  // PgField via rebuild) — so a mixed chain like `s.text().$default("x").optional()` stays a PgField.
  declare optional: () => PgField<z.ZodOptional<S>, Flags>;
  declare nullable: () => PgField<z.ZodNullable<S>, Flags>;
  declare nullish: () => PgField<z.ZodOptional<z.ZodNullable<S>>, Flags>;
  declare array: () => PgField<z.ZodArray<S>, Flags>;
  declare default: (value: z.input<S>) => PgField<z.ZodDefault<S>, Flags>;
  declare prefault: (value: z.input<S>) => PgField<z.ZodPrefault<S>, Flags>;
  declare catch: (value: z.output<S>) => PgField<z.ZodCatch<S>, Flags>;

  private with(meta: Partial<PgMeta>): PgField<S, Flags> {
    return new PgField<S, Flags>(this.schema, { ...this.native, ...meta });
  }

  // --- pg-native `$`-methods (DDL authoring) ---
  /** `DEFAULT <value>` — a JS literal, or `sqlExpr("now()")` for a raw SQL default. */
  $default(value: z.input<S> | SqlExpr): PgField<S, Flags> {
    return this.with({ default: toExpr(value as never) });
  }
  /** Field-level `CHECK (<expr>)`. */
  $check(expr: string | SqlExpr): PgField<S, Flags> {
    return this.with({ check: isSqlExpr(expr) ? expr.__sql : expr });
  }
  /** `GENERATED ALWAYS AS (<expr>) STORED` — a computed column. */
  $generated(expr: string | SqlExpr): PgField<S, Flags> {
    return this.with({ generated: isSqlExpr(expr) ? expr.__sql : expr });
  }
  /** `GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY` (auto-increment). */
  $identity(mode: "always" | "by-default" = "by-default"): PgField<S, Flags> {
    return this.with({ identity: mode });
  }
  /** Column-level `UNIQUE`. */
  $unique(): PgField<S, Flags> {
    return this.with({ unique: true });
  }
  /** Mark this column (part of) the PRIMARY KEY. */
  $primaryKey(): PgField<S, Flags> {
    return this.with({ primaryKey: true });
  }
  /** Foreign key to `table(id)` with optional `ON DELETE`/`ON UPDATE` actions. */
  $references(
    table: string,
    opts?: { onDelete?: string; onUpdate?: string },
  ): PgField<S, Flags> {
    return this.with({ references: { table, ...(opts ?? {}) } });
  }
  /** `COMMENT ON COLUMN`. */
  $comment(text: string): PgField<S, Flags> {
    return this.with({ comment: text });
  }

  // --- Zod chain methods (string + number constraints/transforms) ---
  // These are native Zod refinements/transforms forwarded to the inner schema and rebuilt as a PgField,
  // so a chain like `s.text().email().min(3).trim()` is a drop-in for Zod. They validate/normalize
  // APP-SIDE only — the pg column type is UNCHANGED (no DDL). For a DB-side constraint use `$check`.
  // Runtime-dispatched so the method just calls the inner schema's same-named method (throwing the same
  // way Zod would if it doesn't apply to this field's base type, e.g. `.regex()` on a number).
  private chain(method: string, ...args: unknown[]): PgField<S, Flags> {
    const inner = this.schema as unknown as Record<
      string,
      ((...a: unknown[]) => z.ZodType) | undefined
    >;
    const fn = inner[method];
    if (typeof fn !== "function")
      throw new Error(
        `postgres: .${method}() is not available on this field's base type.`,
      );
    return this.rebuild(fn.apply(this.schema, args) as S, this.native);
  }
  // string + number length/bounds
  min(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("min", value, params);
  }
  max(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("max", value, params);
  }
  length(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("length", value, params);
  }
  // string patterns / transforms
  regex(re: RegExp, params?: unknown): PgField<S, Flags> {
    return this.chain("regex", re, params);
  }
  startsWith(value: string, params?: unknown): PgField<S, Flags> {
    return this.chain("startsWith", value, params);
  }
  endsWith(value: string, params?: unknown): PgField<S, Flags> {
    return this.chain("endsWith", value, params);
  }
  includes(value: string, params?: unknown): PgField<S, Flags> {
    return this.chain("includes", value, params);
  }
  nonempty(params?: unknown): PgField<S, Flags> {
    return this.chain("nonempty", params);
  }
  trim(): PgField<S, Flags> {
    return this.chain("trim");
  }
  toLowerCase(): PgField<S, Flags> {
    return this.chain("toLowerCase");
  }
  toUpperCase(): PgField<S, Flags> {
    return this.chain("toUpperCase");
  }
  // number bounds + checks
  gt(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("gt", value, params);
  }
  gte(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("gte", value, params);
  }
  lt(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("lt", value, params);
  }
  lte(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("lte", value, params);
  }
  positive(params?: unknown): PgField<S, Flags> {
    return this.chain("positive", params);
  }
  negative(params?: unknown): PgField<S, Flags> {
    return this.chain("negative", params);
  }
  nonnegative(params?: unknown): PgField<S, Flags> {
    return this.chain("nonnegative", params);
  }
  nonpositive(params?: unknown): PgField<S, Flags> {
    return this.chain("nonpositive", params);
  }
  multipleOf(value: number, params?: unknown): PgField<S, Flags> {
    return this.chain("multipleOf", value, params);
  }
  // string FORMAT chain methods (Zod-4 deprecated-but-present forms, so `s.text().email()` is a drop-in;
  // the prefer-factory equivalents are `s.email()` etc.). All validate APP-SIDE; column stays `text`.
  email(params?: unknown): PgField<S, Flags> {
    return this.chain("email", params);
  }
  url(params?: unknown): PgField<S, Flags> {
    return this.chain("url", params);
  }
  emoji(params?: unknown): PgField<S, Flags> {
    return this.chain("emoji", params);
  }
  uuid(params?: unknown): PgField<S, Flags> {
    return this.chain("uuid", params);
  }
  guid(params?: unknown): PgField<S, Flags> {
    return this.chain("guid", params);
  }
  nanoid(params?: unknown): PgField<S, Flags> {
    return this.chain("nanoid", params);
  }
  cuid(params?: unknown): PgField<S, Flags> {
    return this.chain("cuid", params);
  }
  cuid2(params?: unknown): PgField<S, Flags> {
    return this.chain("cuid2", params);
  }
  ulid(params?: unknown): PgField<S, Flags> {
    return this.chain("ulid", params);
  }
  xid(params?: unknown): PgField<S, Flags> {
    return this.chain("xid", params);
  }
  ksuid(params?: unknown): PgField<S, Flags> {
    return this.chain("ksuid", params);
  }
  base64(params?: unknown): PgField<S, Flags> {
    return this.chain("base64", params);
  }
  base64url(params?: unknown): PgField<S, Flags> {
    return this.chain("base64url", params);
  }
  e164(params?: unknown): PgField<S, Flags> {
    return this.chain("e164", params);
  }
  jwt(params?: unknown): PgField<S, Flags> {
    return this.chain("jwt", params);
  }
  // string transforms
  lowercase(params?: unknown): PgField<S, Flags> {
    return this.chain("lowercase", params);
  }
  uppercase(params?: unknown): PgField<S, Flags> {
    return this.chain("uppercase", params);
  }
  normalize(form?: string): PgField<S, Flags> {
    return this.chain("normalize", form);
  }

  /**
   * ESCAPE HATCH (chainable form) — teach the driver how to STORE this field's value in Postgres:
   * give the **wire type** as an `s.*`/Zod field (its pg column type is taken from it) plus a codec
   * (`encode`: app -> wire, `decode`: wire -> app). This turns an otherwise-unmappable App value
   * (e.g. `s.instanceof(Money)`) into a real pg column. Omit the codec for an identity mapping (the
   * app value is stored as-is). Mirrors SurrealDB's `.$surreal(wire, codec)`; the standalone
   * {@link s.$postgres} factory is the from-scratch equivalent. `$`-prefixed to avoid clashing with Zod.
   */
  $postgres<WF extends AnyField | z.ZodType, A = z.output<S>>(
    wire: WF,
    codec?: {
      encode: (app: A) => z.output<SchemaOf<WF>>;
      decode: (wire: z.output<SchemaOf<WF>>) => A;
    },
  ): PgField<z.ZodCodec<SchemaOf<WF>, S>, Flags> {
    const wireSchema = toZod(wire) as SchemaOf<WF>;
    const c = z.codec(wireSchema, this.schema, {
      decode: (w) => (codec ? codec.decode(w as never) : w) as never,
      encode: (a) => (codec ? codec.encode(a as A) : a) as never,
    });
    // The stored pg type comes from the WIRE field (its column type); App typing comes from `this`.
    const wirePg = wire instanceof PgField ? wire.native.pg : undefined;
    return new PgField<z.ZodCodec<SchemaOf<WF>, S>, Flags>(c, {
      ...this.native,
      ...(wirePg ? { pg: wirePg } : {}),
    });
  }
}

/**
 * A Postgres OBJECT field — the result of `s.object({...})`. A {@link PgField} over a `z.ZodObject`
 * (one `jsonb` column) that additionally carries the Zod object-composition methods. They live HERE,
 * on the object subclass — NOT on the base `PgField` — so the base field (and its `AnyField` erasure)
 * stays free of generic-return methods that would break structural assignability. Each method forwards
 * to the inner `z.object` and re-wraps as a `PgObjectField`, so the result stays composable and the
 * App type stays precise (mirrors how Zod itself puts `.extend`/`.pick`/… on `ZodObject`, not `ZodType`).
 */
export class PgObjectField<
  Sh extends z.ZodRawShape = z.ZodRawShape,
  Flags extends string = never,
> extends PgField<z.ZodObject<Sh>, Flags> {
  // An object-producing op (incl. the inherited .loose()/.strict()/.flexible()) stays a PgObjectField;
  // anything else (e.g. .optional()/.array()) degrades to a base PgField, matching the wrapper's type.
  protected rebuild<S2 extends z.ZodType, F2 extends string>(
    schema: S2,
    native: PgMeta,
  ): PgField<S2, F2> {
    if (schema instanceof z.ZodObject)
      return new PgObjectField(schema as never, native) as unknown as PgField<
        S2,
        F2
      >;
    return new PgField<S2, F2>(schema, native);
  }
  private obj<Sh2 extends z.ZodRawShape>(
    schema: z.ZodObject<Sh2>,
  ): PgObjectField<Sh2, Flags> {
    return new PgObjectField<Sh2, Flags>(schema, this.native);
  }
  /** Add fields (existing keys are overwritten). Accepts fields OR raw Zod, like `s.object`. */
  extend<T extends Record<string, AnyField | z.ZodType>>(shape: T) {
    const lifted = Object.fromEntries(
      Object.entries(shape).map(([k, v]) => [k, toZod(v)]),
    ) as { [K in keyof T]: SchemaOf<T[K]> };
    return this.obj(this.schema.extend(lifted));
  }
  /** Merge another object's shape in (its fields win on conflict). */
  merge<T extends z.ZodRawShape>(other: PgObjectField<T> | z.ZodObject<T>) {
    return this.obj(
      this.schema.merge(other instanceof PgObjectField ? other.schema : other),
    );
  }
  /** Keep only the masked keys. */
  pick<M extends Parameters<z.ZodObject<Sh>["pick"]>[0]>(mask: M) {
    return this.obj(this.schema.pick(mask));
  }
  /** Drop the masked keys. */
  omit<M extends Parameters<z.ZodObject<Sh>["omit"]>[0]>(mask: M) {
    return this.obj(this.schema.omit(mask));
  }
  /** Make all fields optional. */
  partial() {
    return this.obj(this.schema.partial());
  }
  /** Make all fields required. */
  required() {
    return this.obj(this.schema.required());
  }
  /** Type unknown keys with a schema (field OR raw Zod). */
  catchall<C extends AnyField | z.ZodType>(schema: C) {
    return this.obj(this.schema.catchall(toZod(schema) as SchemaOf<C>));
  }
  /** The object's field shape. */
  get shape(): Sh {
    return this.schema.shape;
  }
}

/**
 * A Postgres ENUM field — the result of `s.enum([...])` (a string-literal union projected to a `text`
 * column). A {@link PgField} over a `z.ZodEnum` that additionally carries the Zod enum-derivation
 * methods `.exclude`/`.extract`. Like {@link PgObjectField}, they live on THIS subclass — not base
 * `PgField` — and forward to the inner `z.enum`, re-wrapping as a `PgEnumField` so the result stays a
 * derivable enum and the App type narrows precisely (mirrors Zod, where `.exclude`/`.extract` are on
 * `ZodEnum`). The pg column stays `text`.
 */
export class PgEnumField<
  T extends z.core.util.EnumLike = z.core.util.EnumLike,
  Flags extends string = never,
> extends PgField<z.ZodEnum<T>, Flags> {
  private enumField<T2 extends z.core.util.EnumLike>(
    schema: z.ZodEnum<T2>,
  ): PgEnumField<T2, Flags> {
    return new PgEnumField<T2, Flags>(schema, this.native);
  }
  /** Derive an enum without the listed members. */
  exclude<const U extends Parameters<z.ZodEnum<T>["exclude"]>[0]>(values: U) {
    return this.enumField(this.schema.exclude(values));
  }
  /** Derive an enum with only the listed members. */
  extract<const U extends Parameters<z.ZodEnum<T>["extract"]>[0]>(values: U) {
    return this.enumField(this.schema.extract(values));
  }
}

// --- the `s` vocabulary (pg lingo) -------------------------------------------------------------

// Generic in the Zod schema so each `s.*` factory keeps its precise type — without this, `App<T>` (and
// the query builder's result typing) collapse every field to `unknown`.
const mk = <S extends z.ZodType>(
  type: string,
  schema: S,
  params?: (string | number)[],
): PgField<S> =>
  new PgField<S>(schema, { pg: params ? { type, params } : { type } });

/** Map a tuple of fields/Zod schemas to their inner Zod schemas (for tuple/union/discriminatedUnion). */
type ZodsOf<T extends readonly (AnyField | z.ZodType)[]> = {
  [K in keyof T]: SchemaOf<T[K]>;
};

/**
 * Infer the pg column type for an `s.codec(wire, app, …)` from its RAW-Zod WIRE schema (the on-disk
 * side). `s.*` factories normally set `native.pg` explicitly, but a codec's wire is a bare Zod schema,
 * so map its base type here (peeling option/nullable/etc.). Mirrors the canonical scalar choices the
 * leaf factories make; structural/unknown wires fall back to `jsonb`.
 */
function wirePgType(schema: z.ZodType): PgTypeRef {
  let cur = schema as {
    _zod?: { def?: { type?: string; innerType?: z.ZodType } };
  };
  const peel = new Set([
    "optional",
    "nullable",
    "default",
    "prefault",
    "catch",
    "readonly",
    "nonoptional",
    "pipe",
  ]);
  while (
    cur?._zod?.def &&
    peel.has(cur._zod.def.type ?? "") &&
    cur._zod.def.innerType
  )
    cur = cur._zod.def.innerType as typeof cur;
  switch (cur?._zod?.def?.type) {
    case "string":
      return { type: "text" };
    case "int":
      return { type: "integer" };
    case "number":
      return { type: "double precision" };
    case "bigint":
      return { type: "bigint" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "timestamptz" };
    case "object":
    case "array":
    case "tuple":
    case "record":
    case "map":
    case "set":
    case "union":
      return { type: "jsonb" };
    default:
      return { type: "text" };
  }
}

// PGlite returns an int8 (`bigint`) column as a JS `number` when the value fits in 2^53, and a JS
// `bigint` only when it's larger — so any bigint-backed field must accept EITHER on the wire and coerce
// to `bigint`. (A `numeric` column, by contrast, always comes back as a string.) Without this, decode of
// a small value stored in a bigint column throws "expected bigint, received number".
const INT8_WIRE = z.union([z.bigint(), z.number()]);
/** A `bigint` column whose App value is a JS `bigint`, tolerant of PGlite's number|bigint wire. */
const bigintField = (): PgField<z.ZodCodec<typeof INT8_WIRE, z.ZodBigInt>> =>
  new PgField(
    z.codec(INT8_WIRE, z.bigint(), {
      decode: (w) => BigInt(w),
      encode: (b) => b,
    }),
    { pg: { type: "bigint" } },
  );

/** The Postgres authoring namespace. Zod drop-ins (string/number/…) + native pg types + `$postgres`. */
export const s = {
  // Zod drop-ins (the canonical superset; each maps to a sensible pg default). Native aliases below
  // (text/varchar/int/numeric/…) give precise control.
  string: () => mk("text", z.string()),
  number: () => mk("double precision", z.number()),
  // text
  text: () => mk("text", z.string()),
  varchar: (n?: number) =>
    n === undefined
      ? mk("varchar", z.string())
      : mk("varchar", z.string().max(n), [n]),
  char: (n?: number) =>
    n === undefined ? mk("char", z.string()) : mk("char", z.string(), [n]),
  citext: () => mk("citext", z.string()),
  // string FORMATS — App-side Zod validators on a `text` column (pg has no format-specific column type;
  // validation runs client-side, the column is plain `text`). `uuid`/`inet`/`cidr`/`macaddr` have their
  // own native types above/below and are not repeated here. Params pass through to Zod (message/etc.).
  email: (params?: Parameters<typeof z.email>[0]) =>
    mk("text", z.email(params)),
  url: (params?: Parameters<typeof z.url>[0]) => mk("text", z.url(params)),
  emoji: (params?: Parameters<typeof z.emoji>[0]) =>
    mk("text", z.emoji(params)),
  nanoid: (params?: Parameters<typeof z.nanoid>[0]) =>
    mk("text", z.nanoid(params)),
  cuid: (params?: Parameters<typeof z.cuid>[0]) => mk("text", z.cuid(params)),
  cuid2: (params?: Parameters<typeof z.cuid2>[0]) =>
    mk("text", z.cuid2(params)),
  ulid: (params?: Parameters<typeof z.ulid>[0]) => mk("text", z.ulid(params)),
  guid: (params?: Parameters<typeof z.guid>[0]) => mk("text", z.guid(params)),
  xid: (params?: Parameters<typeof z.xid>[0]) => mk("text", z.xid(params)),
  ksuid: (params?: Parameters<typeof z.ksuid>[0]) =>
    mk("text", z.ksuid(params)),
  base64: (params?: Parameters<typeof z.base64>[0]) =>
    mk("text", z.base64(params)),
  base64url: (params?: Parameters<typeof z.base64url>[0]) =>
    mk("text", z.base64url(params)),
  e164: (params?: Parameters<typeof z.e164>[0]) => mk("text", z.e164(params)),
  jwt: (params?: Parameters<typeof z.jwt>[0]) => mk("text", z.jwt(params)),
  // long-tail string formats (also -> text, App-side). uuid version variants, http-only url, network
  // name/hex/mac, and keyed hashes. `s.uuid()` stays the native `uuid` type; these are text validators.
  uuidv4: (params?: Parameters<typeof z.uuidv4>[0]) =>
    mk("text", z.uuidv4(params)),
  uuidv6: (params?: Parameters<typeof z.uuidv6>[0]) =>
    mk("text", z.uuidv6(params)),
  uuidv7: (params?: Parameters<typeof z.uuidv7>[0]) =>
    mk("text", z.uuidv7(params)),
  httpUrl: (params?: Parameters<typeof z.httpUrl>[0]) =>
    mk("text", z.httpUrl(params)),
  hostname: (params?: Parameters<typeof z.hostname>[0]) =>
    mk("text", z.hostname(params)),
  hex: (params?: Parameters<typeof z.hex>[0]) => mk("text", z.hex(params)),
  mac: (params?: Parameters<typeof z.mac>[0]) => mk("text", z.mac(params)),
  hash: (...args: Parameters<typeof z.hash>) => mk("text", z.hash(...args)),
  // network string-format validators -> text (App-side; DISTINCT from the native s.inet()/cidr()/
  // macaddr() columns — these are the z.ipv4/ipv6/cidrv4/cidrv6 drop-ins, validated client-side).
  ipv4: (params?: Parameters<typeof z.ipv4>[0]) => mk("text", z.ipv4(params)),
  ipv6: (params?: Parameters<typeof z.ipv6>[0]) => mk("text", z.ipv6(params)),
  cidrv4: (params?: Parameters<typeof z.cidrv4>[0]) =>
    mk("text", z.cidrv4(params)),
  cidrv6: (params?: Parameters<typeof z.cidrv6>[0]) =>
    mk("text", z.cidrv6(params)),
  // ISO string formats (nested, mirroring z.iso.*) — App-side validators on `text`. DISTINCT from the
  // native temporal types s.date()/s.timestamptz()/s.interval() (those are real pg date/time columns).
  iso: {
    date: (params?: Parameters<typeof z.iso.date>[0]) =>
      mk("text", z.iso.date(params)),
    time: (params?: Parameters<typeof z.iso.time>[0]) =>
      mk("text", z.iso.time(params)),
    datetime: (params?: Parameters<typeof z.iso.datetime>[0]) =>
      mk("text", z.iso.datetime(params)),
    duration: (params?: Parameters<typeof z.iso.duration>[0]) =>
      mk("text", z.iso.duration(params)),
  },
  // string-on-disk, boolean in the app (Zod's z.stringbool codec): column is `text`, App value is bool.
  stringbool: (params?: Parameters<typeof z.stringbool>[0]) =>
    mk("text", z.stringbool(params)),
  // numeric
  smallint: () => mk("smallint", z.int().gte(-32768).lte(32767)),
  integer: () => mk("integer", z.int()),
  int: () => mk("integer", z.int()),
  // 64-bit: App value is a JS bigint (NOT a number — a pg bigint exceeds JS's 2^53 safe-integer range,
  // so a number would silently lose precision). Uses {@link bigintField} so decode tolerates PGlite
  // returning the column as number (<=2^53) or bigint (larger) and coerces to bigint either way.
  bigint: () => bigintField(),
  serial: () => mk("integer", z.int()).$identity("by-default"),
  bigserial: () => bigintField().$identity("by-default"),
  numeric: (precision?: number, scale?: number) =>
    precision === undefined
      ? mk("numeric", z.number())
      : // Postgres stores `numeric(p)` as `numeric(p,0)`; keep scale explicit so it round-trips.
        mk("numeric", z.number(), [precision, scale ?? 0]),
  decimal: (precision?: number, scale?: number) => s.numeric(precision, scale),
  real: () => mk("real", z.number()),
  doublePrecision: () => mk("double precision", z.number()),
  float: () => mk("double precision", z.number()),
  money: () => mk("money", z.string()),
  // Zod width-numeric drop-ins. Clean fits: float32->real, float64->double precision, int32->integer,
  // int64->bigint (App bigint, like s.bigint). Postgres has NO unsigned types, so uint32/uint64 store
  // in the next type up via a codec (App keeps z.uint*'s value type): uint32 (0..2^32-1) -> bigint
  // column (wire bigint <-> app number), uint64 (0..2^64-1) -> numeric column (wire string <-> app bigint).
  float32: (params?: Parameters<typeof z.float32>[0]) =>
    mk("real", z.float32(params)),
  float64: (params?: Parameters<typeof z.float64>[0]) =>
    mk("double precision", z.float64(params)),
  int32: (params?: Parameters<typeof z.int32>[0]) =>
    mk("integer", z.int32(params)),
  int64: (params?: Parameters<typeof z.int64>[0]) =>
    new PgField(
      z.codec(INT8_WIRE, z.int64(params), {
        decode: (w) => BigInt(w),
        encode: (b) => b,
      }),
      { pg: { type: "bigint" } },
    ),
  uint32: (params?: Parameters<typeof z.uint32>[0]) =>
    new PgField(
      z.codec(INT8_WIRE, z.uint32(params), {
        decode: (w) => Number(w),
        encode: (n) => BigInt(n),
      }),
      { pg: { type: "bigint" } },
    ),
  uint64: (params?: Parameters<typeof z.uint64>[0]) =>
    new PgField(
      z.codec(z.string(), z.uint64(params), {
        decode: (s) => BigInt(s),
        encode: (b) => String(b),
      }),
      { pg: { type: "numeric" } },
    ),
  // boolean
  boolean: () => mk("boolean", z.boolean()),
  bool: () => mk("boolean", z.boolean()),
  // temporal
  timestamptz: () => mk("timestamptz", z.date()),
  timestamp: () => mk("timestamp", z.date()),
  date: () => mk("date", z.date()),
  time: () => mk("time", z.string()),
  timetz: () => mk("timetz", z.string()),
  interval: () => mk("interval", z.string()),
  // identity / network / uuid / bytes
  uuid: () => mk("uuid", z.uuid()),
  bytea: () => mk("bytea", z.instanceof(Uint8Array)),
  inet: () => mk("inet", z.string()),
  cidr: () => mk("cidr", z.string()),
  macaddr: () => mk("macaddr", z.string()),
  // json
  // no shape -> z.json() (the recursive JSON-value schema), not z.unknown(): a no-shape json/jsonb
  // column still only holds valid JSON, and it makes `s.json()` a literal drop-in for `z.json()`.
  jsonb: <T extends z.ZodType = ReturnType<typeof z.json>>(shape?: T) =>
    mk("jsonb", shape ?? z.json()),
  json: <T extends z.ZodType = ReturnType<typeof z.json>>(shape?: T) =>
    mk("json", shape ?? z.json()),
  // enum (string-literal union -> text) and single literal. Returns a PgEnumField so `.exclude`/
  // `.extract` are available to derive narrower enums (the column stays text).
  enum: <const T extends readonly [string, ...string[]]>(values: T) =>
    new PgEnumField(z.enum(values), { pg: { type: "text" } }),
  literal: <const V extends string | number | boolean>(value: V) =>
    mk(
      typeof value === "number"
        ? "double precision"
        : typeof value === "boolean"
          ? "boolean"
          : "text",
      z.literal(value),
    ),
  // object -> jsonb (opaque on disk). Accepts field OR raw-Zod values (a Zod drop-in superset).
  // Generic over the shape so the App type is the precise object AND the returned PgObjectField's
  // composition methods (.extend/.pick/…) stay precisely typed.
  object: <Sh extends Record<string, AnyField | z.ZodType>>(
    shape: Sh,
  ): PgObjectField<{ [K in keyof Sh]: SchemaOf<Sh[K]> }> =>
    new PgObjectField(
      z.object(
        Object.fromEntries(
          Object.entries(shape).map(([k, v]) => [k, toZod(v)]),
        ),
      ) as z.ZodObject<{ [K in keyof Sh]: SchemaOf<Sh[K]> }>,
      { pg: { type: "jsonb" } },
    ),
  // z.strictObject / z.looseObject drop-ins — same jsonb column, unknown-key mode preset (still a
  // composable PgObjectField). strict rejects extra keys; loose passes them through.
  strictObject: <Sh extends Record<string, AnyField | z.ZodType>>(shape: Sh) =>
    s.object(shape).strict(),
  looseObject: <Sh extends Record<string, AnyField | z.ZodType>>(shape: Sh) =>
    s.object(shape).loose(),
  // array(elem) -> `<elem>[]`; carries the element's pg metadata so it lowers to an array of that type.
  array: (elem: AnyField | z.ZodType): PgField =>
    new PgField(
      z.array(toZod(elem)),
      elem instanceof PgField ? elem.native : {},
    ),
  // composite types -> jsonb (the App value is the composite; stored opaquely as one jsonb column,
  // validated app-side by Zod). Accept fields OR raw Zod (toZod each), mirroring s.object/s.array.
  record: <K extends z.core.$ZodRecordKey, V extends AnyField | z.ZodType>(
    key: K,
    value: V,
  ): PgField<z.ZodRecord<K, SchemaOf<V>>> =>
    mk("jsonb", z.record(key, toZod(value) as SchemaOf<V>)),
  tuple: <
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    items: T,
  ): PgField<z.ZodTuple<ZodsOf<T>>> =>
    mk("jsonb", z.tuple(items.map(toZod) as ZodsOf<T>)),
  union: <
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    options: T,
  ): PgField<z.ZodUnion<ZodsOf<T>>> =>
    mk("jsonb", z.union(options.map(toZod) as ZodsOf<T>)),
  discriminatedUnion: <
    Disc extends string,
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    discriminator: Disc,
    options: T,
  ): PgField<z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>> =>
    mk(
      "jsonb",
      z.discriminatedUnion(
        discriminator,
        options.map(toZod) as never,
      ) as unknown as z.ZodDiscriminatedUnion<ZodsOf<T>, Disc>,
    ),
  intersection: <
    A extends AnyField | z.ZodType,
    B extends AnyField | z.ZodType,
  >(
    a: A,
    b: B,
  ): PgField<z.ZodIntersection<SchemaOf<A>, SchemaOf<B>>> =>
    mk(
      "jsonb",
      z.intersection(toZod(a) as SchemaOf<A>, toZod(b) as SchemaOf<B>),
    ),
  lazy: <V extends AnyField | z.ZodType>(
    getter: () => V,
  ): PgField<z.ZodLazy<SchemaOf<V>>> =>
    mk(
      "jsonb",
      z.lazy(() => toZod(getter()) as SchemaOf<V>),
    ),
  // exclusive union (z.xor) -> jsonb, like s.union but matching exactly one option.
  xor: <
    const T extends readonly [
      AnyField | z.ZodType,
      ...(AnyField | z.ZodType)[],
    ],
  >(
    options: T,
  ) => mk("jsonb", z.xor(options.map(toZod) as ZodsOf<T>)),
  // open-keyed record variants -> jsonb (all-optional values / extra keys allowed). Accept field|raw Zod.
  partialRecord: <
    K extends z.core.$ZodRecordKey,
    V extends AnyField | z.ZodType,
  >(
    key: K,
    value: V,
  ) => mk("jsonb", z.partialRecord(key, toZod(value) as SchemaOf<V>)),
  looseRecord: <K extends z.core.$ZodRecordKey, V extends AnyField | z.ZodType>(
    key: K,
    value: V,
  ) => mk("jsonb", z.looseRecord(key, toZod(value) as SchemaOf<V>)),
  // custom string formats / template-literal strings -> text (App-side validated).
  stringFormat: (...args: Parameters<typeof z.stringFormat>) =>
    mk("text", z.stringFormat(...args)),
  templateLiteral: (...args: Parameters<typeof z.templateLiteral>) =>
    mk("text", z.templateLiteral(...args)),
  // an enum of an object's keys (z.keyof) -> text. Accepts an s.object() field or a raw z.object.
  // biome-ignore lint/suspicious/noExplicitAny: accept any PgObjectField shape (subclass is invariant)
  keyof: (obj: PgObjectField<any> | z.ZodObject) =>
    mk(
      "text",
      z.keyof(obj instanceof PgField ? (obj.schema as z.ZodObject) : obj),
    ),
  // preprocess the input before validation (z.preprocess) — App-side only; the column type is the
  // INNER schema's (inherit its pg metadata when it's an s.* field, else default).
  preprocess: <V extends AnyField | z.ZodType>(
    fn: (arg: unknown) => unknown,
    schema: V,
  ) =>
    new PgField(
      z.preprocess(fn, toZod(schema) as SchemaOf<V>),
      schema instanceof PgField ? schema.native : {},
    ),
  // foreign key: `text` column + FK to `table(id)`
  references: (
    table: string,
    opts?: { onDelete?: string; onUpdate?: string },
  ): PgField =>
    new PgField(z.string(), {
      pg: { type: "text" },
      references: { table, ...(opts ?? {}) },
    }),
  /**
   * ESCAPE HATCH — a pg type with no portable meaning, stored via a Zod codec (encode/decode). The
   * column is emitted as `pgType`; App-side reads/writes go through `codec`. Mirrors surreal `$surreal`.
   */
  $postgres: <C extends z.ZodType>(pgType: string, codec: C): PgField<C> =>
    new PgField<C>(codec, { pg: { type: pgType } }),
  // z.codec drop-in: a low-level codec whose pg column type is INFERRED from the wire schema A (the
  // on-disk side). Mirrors z.codec's arg order — (wire/INPUT, app/OUTPUT, {decode, encode}); A/B are raw
  // Zod (pass `field.schema` for an s.* field). Unlike $postgres (which names the pg type explicitly),
  // s.codec derives it from a schema-expressible wire. App = output(B), Wire = input(A).
  codec: <A extends z.ZodType, B extends z.ZodType>(
    wire: A,
    app: B,
    params: Parameters<typeof z.codec<A, B>>[2],
  ): PgField<z.ZodCodec<A, B>> =>
    new PgField(z.codec(wire, app, params), { pg: wirePgType(wire) }),
};

// --- defineTable: a pg table builder producing an `Authored` object -----------------------------

/** A table-level FOREIGN KEY: composite, or referencing a non-`id` column of `refTable`. */
export interface PgForeignKeyConfig {
  name?: string;
  columns: string[];
  refTable: string;
  /** Referenced columns (parallel to `columns`); defaults to `["id"]`. */
  refColumns?: string[];
  onDelete?: string;
  onUpdate?: string;
}

/** Table-level pg config: composite PK, table CHECKs, secondary indexes, and explicit foreign keys. */
/** An access method for a secondary index; `btree` (the default) covers equality/range, the rest are specialized. */
export type PgIndexMethod = "btree" | "gin" | "gist" | "brin" | "hash";

export interface PgIndexConfig {
  name?: string;
  cols: string[];
  unique?: boolean;
  /** Access method (default `btree`); e.g. `gin` for jsonb/array/full-text, `brin` for huge append-only tables. */
  method?: PgIndexMethod;
  /** Partial-index predicate (`WHERE <expr>`) — index only the rows matching it. */
  where?: string;
}

export interface PgTableConfig {
  primaryKey?: string[];
  checks?: string[];
  indexes?: PgIndexConfig[];
  foreignKeys?: PgForeignKeyConfig[];
}

// The element bound for a table's field map. Uses `any` deliberately: `PgField` is invariant in its
// schema param (it appears in both co- and contra-variant positions), so a SUBCLASS like
// `PgObjectField` (S = a concrete `ZodObject`) is NOT assignable to a plain `PgField` bound. `any`
// relaxes that one check — the precise per-field types are still inferred from the literal, so
// App/Wire typing is unaffected.
// biome-ignore lint/suspicious/noExplicitAny: variance escape so PgField subclasses satisfy the bound
type AnyPgField = PgField<any, any>;

/**
 * A Postgres table definition — the `Authored` object the driver's `lower` reads. Structurally a
 * `{ name }` (the neutral `Authored` bound); also carries its `fields` (a `{ col: PgField }` map) and
 * table-level config. Chainable: `.primaryKey(...)`, `.check(expr)`, `.index([...])`.
 */
export class PgTableDef<
  Name extends string = string,
  F extends Record<string, AnyPgField> = Record<string, PgField>,
> {
  /**
   * A Zod object over the columns' schemas — the single source for row validation + encode/decode +
   * the App/Wire types. Mirrors `@schemic/surrealdb`'s `TableDef.object`; the query builder reads its
   * `.shape` for per-column ref schemas and runs it for full-row decode, instead of re-deriving them.
   * NOTE: this is the AUTHORED columns only — a table's implicit `id text PRIMARY KEY` (added at emit
   * time when no PK is declared) is not a field, so it's absent here; declare an `id` column to query it.
   */
  readonly object: z.ZodObject<{ [K in keyof F]: F[K]["schema"] }>;

  constructor(
    readonly name: Name,
    readonly fields: F,
    readonly config: PgTableConfig = {},
  ) {
    const zshape: Record<string, z.ZodType> = {};
    for (const [k, f] of Object.entries(fields)) zshape[k] = f.schema;
    this.object = z.object(zshape) as z.ZodObject<{
      [K in keyof F]: F[K]["schema"];
    }>;
  }

  /** Decode a DB wire row to its App object (`z.decode` through {@link object}). */
  decode(row: unknown): App<this> {
    return z.decode(this.object, row as never) as App<this>;
  }
  /** No-throw decode — `{ success, data } | { success, error }`. */
  safeDecode(row: unknown) {
    return z.safeDecode(this.object, row as never);
  }

  /** Composite / custom PRIMARY KEY (overrides the implicit `id`). */
  primaryKey(...cols: (keyof F & string)[]): PgTableDef<Name, F> {
    return new PgTableDef(this.name, this.fields, {
      ...this.config,
      primaryKey: cols,
    });
  }
  /** A table-level `CHECK (<expr>)`. */
  check(expr: string): PgTableDef<Name, F> {
    return new PgTableDef(this.name, this.fields, {
      ...this.config,
      checks: [...(this.config.checks ?? []), expr],
    });
  }
  /**
   * A secondary index over `cols` — optionally `UNIQUE`, with an access `method` (`gin`/`gist`/`brin`/
   * `hash`; default `btree`) and/or a partial-index `where` predicate.
   */
  index(
    cols: (keyof F & string)[],
    opts?: {
      name?: string;
      unique?: boolean;
      method?: PgIndexMethod;
      where?: string;
    },
  ): PgTableDef<Name, F> {
    return new PgTableDef(this.name, this.fields, {
      ...this.config,
      indexes: [...(this.config.indexes ?? []), { cols, ...(opts ?? {}) }],
    });
  }
  /**
   * A table-level FOREIGN KEY — for a COMPOSITE key (multiple columns) or one referencing a NON-`id`
   * column. `refColumns` defaults to `["id"]`; its length must match `columns`. (For a plain single-
   * column FK to another table's `id`, prefer the inline `author: other.record()` / `s.references(...)`.)
   */
  foreignKey(fk: {
    columns: (keyof F & string)[];
    refTable: string;
    refColumns?: string[];
    onDelete?: string;
    onUpdate?: string;
    name?: string;
  }): PgTableDef<Name, F> {
    return new PgTableDef(this.name, this.fields, {
      ...this.config,
      foreignKeys: [...(this.config.foreignKeys ?? []), fk],
    });
  }

  /**
   * A foreign-key field referencing THIS table (for use in another table's shape):
   * `author: user.record({ onDelete: "cascade" })`. Also satisfies the CLI's structural table check.
   */
  record(opts?: { onDelete?: string; onUpdate?: string }): PgField {
    return s.references(this.name, opts);
  }
}

/** Declare a Postgres table: `export const user = defineTable("user", { name: s.text(), age: s.integer().optional() })`. */
export function defineTable<
  Name extends string,
  F extends Record<string, AnyPgField>,
>(name: Name, fields: F, config?: PgTableConfig): PgTableDef<Name, F> {
  return new PgTableDef(name, fields, config ?? {});
}

// --- defineEnum: a native pg ENUM type (CREATE TYPE … AS ENUM) ----------------------------------

/**
 * A native Postgres enum type — `CREATE TYPE <name> AS ENUM (...)`, a standalone, reusable type.
 * Unlike `s.enum([...])` (which projects to a `text` column, validated App-side only), this emits a
 * real pg type. `.column()` makes a field of this type (App = the literal union, stored as the enum).
 * The `kind` marker lets the schema loader hand it to the driver's `explode` as a standalone def.
 */
export class PgEnumDef<
  const V extends readonly [string, ...string[]] = [string, ...string[]],
> {
  readonly kind = "enum" as const;
  constructor(
    readonly name: string,
    readonly values: V,
  ) {}

  /** A column typed as this enum: `status: mood.column()` (App = the literal union of `values`). */
  column(): PgField<z.ZodEnum<{ [K in V[number]]: K }>> {
    return new PgField(z.enum(this.values), { pg: { type: this.name } });
  }
}

/** Declare a native pg enum: `export const mood = defineEnum("mood", ["happy", "sad"])`; use `mood.column()`. */
export function defineEnum<const V extends readonly [string, ...string[]]>(
  name: string,
  values: V,
): PgEnumDef<V> {
  return new PgEnumDef(name, values);
}

// --- defineView: a pg VIEW (CREATE VIEW … AS <select>) ------------------------------------------

/**
 * A Postgres view — `CREATE VIEW <name> AS <sql>`, where `sql` is a raw SELECT statement (no bind
 * params; views are static). A standalone def (the `kind` marker routes it to the driver's `explode`).
 * NOTE: Postgres rewrites a view's stored definition (expands `SELECT *`, strips qualifiers, reformats),
 * so the body can't byte-round-trip — the view's PRESENCE round-trips, but a body edit isn't
 * auto-diffed yet (see docs/COVERAGE.md). Drop+recreate or re-gen to change a view's SELECT.
 */
export class PgViewDef {
  readonly kind = "view" as const;
  constructor(
    readonly name: string,
    readonly sql: string,
  ) {}
}

/** Declare a pg view: `export const activeUsers = defineView("active_users", 'SELECT id, name FROM "user" WHERE active')`. */
export function defineView(name: string, sql: string): PgViewDef {
  return new PgViewDef(name, sql);
}

// --- defineMaterializedView: a pg MATERIALIZED VIEW ---------------------------------------------

/**
 * A Postgres materialized view — `CREATE MATERIALIZED VIEW <name> AS <sql>`. Like {@link PgViewDef} but
 * the result set is stored on disk (refresh with `REFRESH MATERIALIZED VIEW`). Same body caveat as a
 * plain view: pg rewrites the stored definition, so the PRESENCE round-trips but a body edit isn't
 * auto-diffed (drop+recreate / re-gen to change the SELECT).
 */
export class PgMatViewDef {
  readonly kind = "matview" as const;
  constructor(
    readonly name: string,
    readonly sql: string,
  ) {}
}

/** Declare a pg materialized view: `export const stats = defineMaterializedView("stats", 'SELECT count(*) FROM "user"')`. */
export function defineMaterializedView(
  name: string,
  sql: string,
): PgMatViewDef {
  return new PgMatViewDef(name, sql);
}

// --- defineSequence: a standalone pg SEQUENCE ---------------------------------------------------

/** Options for a standalone sequence; any omitted field uses Postgres' default (start/min 1, increment 1, …). */
export interface PgSequenceOptions {
  start?: number | string;
  increment?: number | string;
  min?: number | string;
  max?: number | string;
  cache?: number | string;
  cycle?: boolean;
}

const seqStr = (v: number | string | undefined): string | undefined =>
  v === undefined ? undefined : String(v);

/**
 * A standalone Postgres sequence — `CREATE SEQUENCE <name> …`. Reference it from a column default with
 * `s.bigint().$default(sqlExpr("nextval('order_no')"))`. (Auto-increment columns usually want
 * `s.serial()` / `.$identity()` instead — this is for a SHARED or custom-stepped sequence.)
 */
export class PgSequenceDef {
  readonly kind = "sequence" as const;
  readonly start?: string;
  readonly increment?: string;
  readonly min?: string;
  readonly max?: string;
  readonly cache?: string;
  readonly cycle?: boolean;
  constructor(
    readonly name: string,
    opts: PgSequenceOptions = {},
  ) {
    this.start = seqStr(opts.start);
    this.increment = seqStr(opts.increment);
    this.min = seqStr(opts.min);
    this.max = seqStr(opts.max);
    this.cache = seqStr(opts.cache);
    if (opts.cycle !== undefined) this.cycle = opts.cycle;
  }
}

/** Declare a pg sequence: `export const orderNo = defineSequence("order_no", { start: 1000 })`. */
export function defineSequence(
  name: string,
  opts?: PgSequenceOptions,
): PgSequenceDef {
  return new PgSequenceDef(name, opts);
}

// --- defineDomain: a pg DOMAIN (a reusable constrained type) ------------------------------------

const pgTypeRefToSql = (ref: PgTypeRef): string =>
  ref.params && ref.params.length > 0
    ? `${ref.type}(${ref.params.join(", ")})`
    : ref.type;

/** Options for a domain: a `DEFAULT`, a `NOT NULL`, and/or a `CHECK (expr)` (expr uses `VALUE`). */
export interface PgDomainOptions {
  notNull?: boolean;
  default?: string | number | boolean | null | SqlExpr;
  check?: string | SqlExpr;
}

/**
 * A Postgres domain — `CREATE DOMAIN <name> AS <base> [DEFAULT …] [NOT NULL] [CHECK (…)]`: a reusable,
 * named constrained type. `base` is an `s.*` field (its column type becomes the domain's base type).
 * `.column()` makes a field of this domain (App type = the base field's). The CHECK/DEFAULT are
 * emit-faithful but, like table column checks/defaults, excluded from drift-detection (pg rewrites the
 * expression on read) — the domain's presence + base type + NOT NULL round-trip.
 */
export class PgDomainDef<S extends z.ZodType = z.ZodType> {
  readonly kind = "domain" as const;
  readonly baseType: string;
  readonly notNull?: boolean;
  readonly default?: string;
  readonly check?: string;
  constructor(
    readonly name: string,
    private readonly base: PgField<S>,
    opts: PgDomainOptions = {},
  ) {
    const ref = base.native.pg;
    this.baseType = ref ? pgTypeRefToSql(ref) : "text";
    if (opts.notNull !== undefined) this.notNull = opts.notNull;
    if (opts.default !== undefined)
      this.default = toExpr(opts.default as never);
    if (opts.check !== undefined)
      this.check = isSqlExpr(opts.check) ? opts.check.__sql : opts.check;
  }

  /** A column typed as this domain (App type = the base field's; stored as the domain). */
  column(): PgField<S> {
    return new PgField<S>(this.base.schema, { pg: { type: this.name } });
  }
}

/** Declare a pg domain: `export const email = defineDomain("email", s.text(), { check: "VALUE ~ '@'" })`; use `email.column()`. */
export function defineDomain<S extends z.ZodType>(
  name: string,
  base: PgField<S>,
  opts?: PgDomainOptions,
): PgDomainDef<S> {
  return new PgDomainDef(name, base, opts);
}

// --- defineExtension: a pg EXTENSION (CREATE EXTENSION IF NOT EXISTS) ----------------------------

/** Options for an extension install: a target `schema` and/or a pinned `version`. */
export interface PgExtensionOptions {
  schema?: string;
  version?: string;
}

/**
 * A Postgres extension — `CREATE EXTENSION IF NOT EXISTS <name> [SCHEMA …] [VERSION …]`. Enables types
 * /functions like `citext`, `postgis`, `pgcrypto`, `uuid-ossp`, `vector`. NOTE: the embedded PGlite
 * engine only bundles a small set of extensions, so most can't be applied locally — emit + introspect
 * are supported, but a round-trip against PGlite is limited to its available extensions.
 */
export class PgExtensionDef {
  readonly kind = "extension" as const;
  readonly schema?: string;
  readonly version?: string;
  constructor(
    readonly name: string,
    opts: PgExtensionOptions = {},
  ) {
    if (opts.schema !== undefined) this.schema = opts.schema;
    if (opts.version !== undefined) this.version = opts.version;
  }
}

/** Declare a pg extension: `export const citext = defineExtension("citext")`. */
export function defineExtension(
  name: string,
  opts?: PgExtensionOptions,
): PgExtensionDef {
  return new PgExtensionDef(name, opts);
}

// --- defineFunction: a pg FUNCTION (CREATE FUNCTION) --------------------------------------------

/** Options for a function: signature + body. `args`/`language` default to `""` / `"sql"`. */
export interface PgFunctionOptions {
  /** Argument list, e.g. `"n integer, label text"` (verbatim SQL); defaults to no args. */
  args?: string;
  /** Return type, e.g. `"integer"`, `"trigger"`, `"setof text"`. */
  returns: string;
  /** Procedural language; defaults to `"sql"` (also `"plpgsql"`, …). */
  language?: string;
  /** The function body, spliced verbatim inside `$$ … $$`. */
  body: string;
  volatility?: "immutable" | "stable" | "volatile";
  strict?: boolean;
  /** Emit `CREATE OR REPLACE` (default `false`). */
  replace?: boolean;
}

/**
 * A Postgres function — `CREATE FUNCTION <name>(args) RETURNS <ret> LANGUAGE <lang> AS $$ <body> $$`.
 * Use it as a trigger handler (`RETURNS trigger`) or a callable helper. NOTE: tracked by NAME — an
 * overloaded function (same name, different args) isn't distinguished; use distinct names. A body edit
 * isn't auto-diffed (re-gen, or author `replace: true` for `CREATE OR REPLACE`).
 */
export class PgFunctionDef {
  readonly kind = "function" as const;
  readonly args: string;
  readonly returns: string;
  readonly language: string;
  readonly body: string;
  readonly volatility?: "immutable" | "stable" | "volatile";
  readonly strict?: boolean;
  readonly replace?: boolean;
  constructor(
    readonly name: string,
    opts: PgFunctionOptions,
  ) {
    this.args = opts.args ?? "";
    this.returns = opts.returns;
    this.language = opts.language ?? "sql";
    this.body = opts.body;
    if (opts.volatility !== undefined) this.volatility = opts.volatility;
    if (opts.strict !== undefined) this.strict = opts.strict;
    if (opts.replace !== undefined) this.replace = opts.replace;
  }
}

/** Declare a pg function: `export const addOne = defineFunction("add_one", { args: "n integer", returns: "integer", body: "SELECT n + 1" })`. */
export function defineFunction(
  name: string,
  opts: PgFunctionOptions,
): PgFunctionDef {
  return new PgFunctionDef(name, opts);
}

// --- defineTrigger: a pg TRIGGER (CREATE TRIGGER) ----------------------------------------------

/** Options for a trigger: when it fires, on which table, and the function it calls. */
export interface PgTriggerOptions {
  table: string;
  timing: "before" | "after" | "instead of";
  events: ("insert" | "update" | "delete" | "truncate")[];
  /** The function to call (must `RETURN trigger`); references a {@link PgFunctionDef} by name. */
  function: string;
  forEach?: "row" | "statement";
  when?: string;
  /** Static arguments passed to the trigger function (rare). */
  args?: string[];
}

/**
 * A Postgres trigger — `CREATE TRIGGER <name> <timing> <events> ON <table> FOR EACH … EXECUTE FUNCTION
 * <fn>()`. The `function` must already exist (define it with {@link defineFunction}); the trigger
 * depends on both its table and that function. Tracked by name + table (a definition edit re-gens).
 */
export class PgTriggerDef {
  readonly kind = "trigger" as const;
  readonly table: string;
  readonly timing: "before" | "after" | "instead of";
  readonly events: ("insert" | "update" | "delete" | "truncate")[];
  readonly function: string;
  readonly forEach?: "row" | "statement";
  readonly when?: string;
  readonly args?: string[];
  constructor(
    readonly name: string,
    opts: PgTriggerOptions,
  ) {
    this.table = opts.table;
    this.timing = opts.timing;
    this.events = opts.events;
    this.function = opts.function;
    if (opts.forEach !== undefined) this.forEach = opts.forEach;
    if (opts.when !== undefined) this.when = opts.when;
    if (opts.args !== undefined) this.args = opts.args;
  }
}

/** Declare a pg trigger: `export const t = defineTrigger("set_updated", { table: "post", timing: "before", events: ["update"], function: "touch" })`. */
export function defineTrigger(
  name: string,
  opts: PgTriggerOptions,
): PgTriggerDef {
  return new PgTriggerDef(name, opts);
}

// --- definePolicy: a pg row-level-security POLICY (CREATE POLICY) -------------------------------

/** Options for an RLS policy. `command` defaults to ALL, `roles` to PUBLIC; `permissive` defaults true. */
export interface PgPolicyOptions {
  table: string;
  command?: "all" | "select" | "insert" | "update" | "delete";
  roles?: string[];
  /** Row-visibility predicate (`USING (…)`). */
  using?: string;
  /** Write predicate (`WITH CHECK (…)`). */
  withCheck?: string;
  /** `false` -> `AS RESTRICTIVE` (default permissive). */
  permissive?: boolean;
}

/**
 * A Postgres row-level-security policy — `CREATE POLICY <name> ON <table> …`. Emitting it also enables
 * RLS on the table (`ALTER TABLE … ENABLE ROW LEVEL SECURITY`, idempotent). Tracked by name + table;
 * a USING / WITH CHECK expression edit isn't auto-diffed (drop+recreate / re-gen).
 */
export class PgPolicyDef {
  readonly kind = "policy" as const;
  readonly table: string;
  readonly command?: "all" | "select" | "insert" | "update" | "delete";
  readonly roles?: string[];
  readonly using?: string;
  readonly withCheck?: string;
  readonly permissive?: boolean;
  constructor(
    readonly name: string,
    opts: PgPolicyOptions,
  ) {
    this.table = opts.table;
    if (opts.command !== undefined) this.command = opts.command;
    if (opts.roles !== undefined) this.roles = opts.roles;
    if (opts.using !== undefined) this.using = opts.using;
    if (opts.withCheck !== undefined) this.withCheck = opts.withCheck;
    if (opts.permissive !== undefined) this.permissive = opts.permissive;
  }
}

/** Declare a pg RLS policy: `export const p = definePolicy("owner_only", { table: "doc", using: "owner = current_user" })`. */
export function definePolicy(name: string, opts: PgPolicyOptions): PgPolicyDef {
  return new PgPolicyDef(name, opts);
}

// --- App/Wire type inference (DX) --------------------------------------------------------------

/** The decoded (App-land) row type of a table — `z.output` of each field's schema. */
export type App<T extends PgTableDef> = {
  [K in keyof T["fields"]]: z.output<T["fields"][K]["schema"]>;
};
/** The encoded (wire) row type of a table — `z.input` of each field's schema. */
export type Wire<T extends PgTableDef> = {
  [K in keyof T["fields"]]: z.input<T["fields"][K]["schema"]>;
};
