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

const mk = (
  type: string,
  schema: z.ZodType,
  params?: (string | number)[],
): PgField => new PgField(schema, { pg: params ? { type, params } : { type } });

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

/** Table-level pg config: composite PK, table CHECKs, and secondary indexes. */
export interface PgTableConfig {
  primaryKey?: string[];
  checks?: string[];
  indexes?: { name?: string; cols: string[]; unique?: boolean }[];
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
  constructor(
    readonly name: Name,
    readonly fields: F,
    readonly config: PgTableConfig = {},
  ) {}

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
  /** A secondary index over `cols` (optionally `UNIQUE`). */
  index(
    cols: (keyof F & string)[],
    opts?: { name?: string; unique?: boolean },
  ): PgTableDef<Name, F> {
    return new PgTableDef(this.name, this.fields, {
      ...this.config,
      indexes: [...(this.config.indexes ?? []), { cols, ...(opts ?? {}) }],
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

// --- App/Wire type inference (DX) --------------------------------------------------------------

/** The decoded (App-land) row type of a table — `z.output` of each field's schema. */
export type App<T extends PgTableDef> = {
  [K in keyof T["fields"]]: z.output<T["fields"][K]["schema"]>;
};
/** The encoded (wire) row type of a table — `z.input` of each field's schema. */
export type Wire<T extends PgTableDef> = {
  [K in keyof T["fields"]]: z.input<T["fields"][K]["schema"]>;
};
