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

// --- the `s` vocabulary (pg lingo) -------------------------------------------------------------

// Generic in the Zod schema so each `s.*` factory keeps its precise type — without this, `App<T>` (and
// the query builder's result typing) collapse every field to `unknown`.
const mk = <S extends z.ZodType>(
  type: string,
  schema: S,
  params?: (string | number)[],
): PgField<S> =>
  new PgField<S>(schema, { pg: params ? { type, params } : { type } });

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
  // numeric
  smallint: () => mk("smallint", z.int().gte(-32768).lte(32767)),
  integer: () => mk("integer", z.int()),
  int: () => mk("integer", z.int()),
  bigint: () => mk("bigint", z.int()),
  serial: () => mk("integer", z.int()).$identity("by-default"),
  bigserial: () => mk("bigint", z.int()).$identity("by-default"),
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
  jsonb: <T extends z.ZodType = z.ZodUnknown>(shape?: T) =>
    mk("jsonb", shape ?? z.unknown()),
  json: <T extends z.ZodType = z.ZodUnknown>(shape?: T) =>
    mk("json", shape ?? z.unknown()),
  // enum (string-literal union -> text) and single literal
  enum: <const T extends readonly [string, ...string[]]>(values: T) =>
    mk("text", z.enum(values)),
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
  object: (shape: Record<string, AnyField | z.ZodType>) =>
    mk(
      "jsonb",
      z.object(
        Object.fromEntries(
          Object.entries(shape).map(([k, v]) => [k, toZod(v)]),
        ),
      ),
    ),
  // array(elem) -> `<elem>[]`; carries the element's pg metadata so it lowers to an array of that type.
  array: (elem: AnyField | z.ZodType): PgField =>
    new PgField(
      z.array(toZod(elem)),
      elem instanceof PgField ? elem.native : {},
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

/**
 * A Postgres table definition — the `Authored` object the driver's `lower` reads. Structurally a
 * `{ name }` (the neutral `Authored` bound); also carries its `fields` (a `{ col: PgField }` map) and
 * table-level config. Chainable: `.primaryKey(...)`, `.check(expr)`, `.index([...])`.
 */
export class PgTableDef<
  Name extends string = string,
  F extends Record<string, PgField> = Record<string, PgField>,
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
  F extends Record<string, PgField>,
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
