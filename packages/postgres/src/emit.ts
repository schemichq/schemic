// Pure Postgres DDL + type helpers — the shared emit primitives the kind engines (./kinds.ts) +
// authoring lower (./lower.ts) + introspection (./index.ts) build on, so a table's CREATE/ALTER DDL
// is produced by ONE set of functions (no drift). No Driver/connection state here: just IR -> pg DDL
// string transforms. The field/type SUBSTRATE (`PortableField`/`PortableType`) is core's; the table-
// level container is this driver's own (`PgTable`) — `PortableTable` retired at the kind-registry flip.

import type {
  PortableField,
  PortableType,
  ScalarName,
} from "@schemic/core/driver";
import { nullable } from "@schemic/core/driver";

/** A secondary index over one table's columns (this driver emits UNIQUE; others tracked for parity). */
export interface PgIndexInfo {
  name: string;
  cols: string[];
  unique: boolean;
}

/** The driver-private table shape (replaces the retired `PortableTable`): columns + PK + CHECKs + idx. */
export interface PgTable {
  name: string;
  fields: PortableField[];
  indexes: PgIndexInfo[];
  primaryKey?: string[];
  checks?: string[];
}

/** Just what `createTableDdl` needs (a `PgTable` is a structural superset). */
export type PgCreateInput = Omit<PgTable, "indexes">;

export const escId = (name: string) => `"${name.replace(/"/g, '""')}"`;

// --- Type mapping (portable <-> Postgres) -------------------------------------------------------

const SCALAR_TO_PG: Partial<Record<ScalarName, string>> = {
  string: "text",
  int: "integer",
  float: "double precision",
  decimal: "numeric",
  number: "double precision",
  bool: "boolean",
  datetime: "timestamp with time zone",
  uuid: "uuid",
  bytes: "bytea",
  duration: "interval",
};

/** A portable column type and how it lands in Postgres: base SQL type, nullability, and FK target. */
export interface PgColumn {
  sql: string;
  nullable: boolean;
  /** A `record<table>` link -> a FK to that table (single-target only; spike scope). */
  references?: string;
}

export function pgColumn(type: PortableType): PgColumn {
  // Peel option/nullable: Postgres represents both as a nullable column (the documented collapse).
  if (type.t === "option" || type.t === "nullable") {
    return { ...pgColumn(type.inner), nullable: true };
  }
  if (type.t === "scalar") {
    const sql = SCALAR_TO_PG[type.name];
    if (!sql) throw new Error(`postgres: unsupported scalar "${type.name}"`);
    return { sql, nullable: false };
  }
  if (type.t === "literal") {
    // A single literal -> its base scalar (PG has no singleton types). Enums (literal unions) below.
    const base =
      typeof type.value === "number"
        ? "double precision"
        : typeof type.value === "boolean"
          ? "boolean"
          : "text";
    return { sql: base, nullable: false };
  }
  if (type.t === "union") {
    // A union of string literals -> text (an enum-ish column; a CHECK could be added later).
    if (
      type.members.every(
        (m) => m.t === "literal" && typeof m.value === "string",
      )
    ) {
      return { sql: "text", nullable: false };
    }
    throw new Error("postgres: non-enum unions are unsupported");
  }
  if (type.t === "array" || type.t === "set") {
    const elem = pgColumn(type.elem);
    return { sql: `${elem.sql}[]`, nullable: false };
  }
  if (type.t === "object") {
    return { sql: "jsonb", nullable: false };
  }
  if (type.t === "record") {
    if (type.tables.length !== 1) {
      // Multi-target links would need a polymorphic FK; out of spike scope -> plain text id.
      return { sql: "text", nullable: false };
    }
    return { sql: "text", nullable: false, references: type.tables[0] };
  }
  if (type.t === "geometry") {
    // Would map to PostGIS `geometry`; without the extension, store GeoJSON as jsonb.
    return { sql: "jsonb", nullable: false };
  }
  if (type.t === "native") {
    if (type.db !== "postgres") {
      throw new Error(
        `postgres: native type "${type.name}" belongs to driver "${type.db}"`,
      );
    }
    // params are order-significant: varchar -> (n), numeric -> (p[, s]).
    const params = type.params as (string | number)[] | undefined;
    const sql =
      params && params.length > 0
        ? `${type.name}(${params.join(", ")})`
        : type.name;
    return { sql, nullable: false };
  }
  throw new Error(`postgres: cannot emit type ${JSON.stringify(type)}`);
}

// --- normalize: project the portable IR onto what Postgres represents ---------------------------

/** Collapse option -> nullable (Postgres can't distinguish absence from NULL). Idempotent. */
export function pgCanonType(type: PortableType): PortableType {
  if (type.t === "option") return nullable(pgCanonType(type.inner));
  if (type.t === "nullable") return nullable(pgCanonType(type.inner));
  if (type.t === "array")
    return {
      t: "array",
      elem: pgCanonType(type.elem),
      ...(type.size !== undefined ? { size: type.size } : {}),
    };
  if (type.t === "set")
    return {
      t: "set",
      elem: pgCanonType(type.elem),
      ...(type.size !== undefined ? { size: type.size } : {}),
    };
  // A nested object becomes an opaque jsonb column -> canonical empty object (sub-keys not tracked).
  if (type.t === "object") return { t: "object", fields: {} };
  return type;
}

/** Uppercase a referential action so authored `cascade` matches introspected `CASCADE`; drop NO ACTION (default). */
export function normAction(a?: string): string | undefined {
  const u = a?.toUpperCase();
  return u && u !== "NO ACTION" ? u : undefined;
}

/**
 * A field reduced to its EQUALITY-relevant shape: canonical type + the STRUCTURAL clauses Postgres
 * round-trips (identity, FK referential actions). EXPRESSION clauses (`default`/`check`/`computed`/
 * `comment`) are dropped here: Postgres rewrites them on read (`0` -> `0`, `'x'` -> `'x'::text`,
 * `a>0` -> `(a > 0)`), so they emit faithfully but can't round-trip to an exact match — a documented
 * capability gap, not an equality difference (see docs/COVERAGE.md).
 */
export function canonField(f: PortableField, table: string): PortableField {
  const out: PortableField = { name: f.name, table, type: pgCanonType(f.type) };
  if (f.identity !== undefined) out.identity = f.identity;
  if (f.reference) {
    const ref: { on_delete?: string; on_update?: string } = {};
    const od = normAction(f.reference.on_delete);
    const ou = normAction(f.reference.on_update);
    if (od) ref.on_delete = od;
    if (ou) ref.on_update = ou;
    if (ref.on_delete !== undefined || ref.on_update !== undefined)
      out.reference = ref;
  }
  return out;
}

/** Fields ready for emit: drop dotted sub-fields, canonicalize the type, KEEP all DDL clauses, sort. */
export function pgEmitFields(t: PgCreateInput): PortableField[] {
  return t.fields
    .filter((f) => !f.name.includes("."))
    .map((f) => ({ ...f, table: t.name, type: pgCanonType(f.type) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- column + table DDL -------------------------------------------------------------------------

/** `ON DELETE …`/`ON UPDATE …` suffix for a FK constraint (empty when no actions). */
export function fkActions(ref?: {
  on_delete?: string;
  on_update?: string;
}): string {
  let s = "";
  if (ref?.on_delete) s += ` ON DELETE ${ref.on_delete}`;
  if (ref?.on_update) s += ` ON UPDATE ${ref.on_update}`;
  return s;
}

/** A column body for CREATE TABLE: type + NOT NULL + identity/default/generated/check clauses. */
export function fieldColumnDdl(f: PortableField): string {
  const col = pgColumn(f.type);
  let s = `${escId(f.name)} ${col.sql}`;
  if (!col.nullable) s += " NOT NULL";
  if (f.identity)
    s += ` GENERATED ${f.identity === "always" ? "ALWAYS" : "BY DEFAULT"} AS IDENTITY`;
  if (f.default !== undefined) s += ` DEFAULT ${f.default}`;
  if (f.computed !== undefined)
    s += ` GENERATED ALWAYS AS (${f.computed}) STORED`;
  if (f.check !== undefined) s += ` CHECK (${f.check})`;
  return s;
}

/**
 * The `CREATE TABLE (...)` statement body for a table — the implicit `id` PK (or a custom/composite
 * PRIMARY KEY), every column with its clauses, and table-level CHECKs. The single source for table
 * creation DDL, used by the `table` kind's `emit`/`canonical`.
 */
export function createTableDdl(t: PgCreateInput): string {
  const fields = pgEmitFields(t);
  const custom = !!(t.primaryKey && t.primaryKey.length > 0);
  const cols: string[] = [];
  if (!custom) cols.push(`${escId("id")} text PRIMARY KEY`); // implicit id (mirrors Surreal).
  for (const f of fields) cols.push(fieldColumnDdl(f));
  if (custom) cols.push(`PRIMARY KEY (${t.primaryKey?.map(escId).join(", ")})`);
  for (const c of t.checks ?? []) cols.push(`CHECK (${c})`);
  return `CREATE TABLE ${escId(t.name)} (\n  ${cols.join(",\n  ")}\n);`;
}

// --- column-level ALTER helpers (used by the field-level diff + the table kind's overwrite) ------

/** A column definition body (`"name" type [NOT NULL]`) for ADD COLUMN / CREATE TABLE. */
export function colDef(f: PortableField): string {
  const c = pgColumn(f.type);
  return `${escId(f.name)} ${c.sql}${c.nullable ? "" : " NOT NULL"}`;
}
export const fkName = (table: string, field: string) =>
  `${table}_${field}_fkey`;
export const addColSql = (table: string, f: PortableField) =>
  `ALTER TABLE ${escId(table)} ADD COLUMN ${colDef(f)};`;
export const dropColSql = (table: string, field: string) =>
  `ALTER TABLE ${escId(table)} DROP COLUMN IF EXISTS ${escId(field)};`;
export const dropTableSql = (table: string) =>
  `DROP TABLE IF EXISTS ${escId(table)} CASCADE;`;

/** `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY …` for a single-column FK to `ref(id)`. */
export const addFkSql = (
  table: string,
  field: string,
  ref: string,
  actions = "",
) =>
  `ALTER TABLE ${escId(table)} ADD CONSTRAINT ${escId(fkName(table, field))} FOREIGN KEY (${escId(field)}) REFERENCES ${escId(ref)} (${escId("id")})${actions};`;

/** Drop a FK constraint by its generated name. */
export const dropFkSql = (table: string, field: string) =>
  `ALTER TABLE ${escId(table)} DROP CONSTRAINT IF EXISTS ${escId(fkName(table, field))};`;

// --- enum (CREATE TYPE … AS ENUM) ---------------------------------------------------------------

/** A single-quoted enum label (`'` doubled). */
const enumLabel = (v: string) => `'${v.replace(/'/g, "''")}'`;
/** `CREATE TYPE "name" AS ENUM ('a', 'b');` — a native pg enum type. */
export const createEnumDdl = (name: string, values: readonly string[]) =>
  `CREATE TYPE ${escId(name)} AS ENUM (${values.map(enumLabel).join(", ")});`;
/** `DROP TYPE IF EXISTS "name";` (fails if a column still uses it — drop those first). */
export const dropEnumSql = (name: string) =>
  `DROP TYPE IF EXISTS ${escId(name)};`;
/** `ALTER TYPE "name" ADD VALUE 'x';` — append a label (non-destructive; appended values only). */
export const addEnumValueSql = (name: string, value: string) =>
  `ALTER TYPE ${escId(name)} ADD VALUE ${enumLabel(value)};`;

// --- view (CREATE VIEW … AS <select>) -----------------------------------------------------------

/** `CREATE VIEW "name" AS <sql>;` — `sql` is the view's SELECT body, spliced verbatim. */
export const createViewDdl = (name: string, sql: string) =>
  `CREATE VIEW ${escId(name)} AS ${sql.trim().replace(/;\s*$/, "")};`;
/** `DROP VIEW IF EXISTS "name";`. */
export const dropViewSql = (name: string) =>
  `DROP VIEW IF EXISTS ${escId(name)};`;

// --- materialized view (CREATE MATERIALIZED VIEW … AS <select>) ---------------------------------

/** `CREATE MATERIALIZED VIEW "name" AS <sql>;` — `sql` is the SELECT body, spliced verbatim. */
export const createMatViewDdl = (name: string, sql: string) =>
  `CREATE MATERIALIZED VIEW ${escId(name)} AS ${sql.trim().replace(/;\s*$/, "")};`;
/** `DROP MATERIALIZED VIEW IF EXISTS "name";`. */
export const dropMatViewSql = (name: string) =>
  `DROP MATERIALIZED VIEW IF EXISTS ${escId(name)};`;

// --- sequence (CREATE SEQUENCE) -----------------------------------------------------------------

/** The explicit attributes of a standalone sequence (any omitted -> pg's default; see {@link seqDefaults}). */
export interface PgSequenceAttrs {
  start?: string;
  increment?: string;
  min?: string;
  max?: string;
  cache?: string;
  cycle?: boolean;
}

/** Postgres' effective defaults for an ascending `bigint` sequence — what introspect reports for `CREATE SEQUENCE s;`. */
export const seqDefaults = {
  start: "1",
  increment: "1",
  min: "1",
  max: "9223372036854775807",
  cache: "1",
  cycle: false,
} as const;

/**
 * `CREATE SEQUENCE "name" [INCREMENT BY n] [MINVALUE m] [MAXVALUE x] [START WITH s] [CACHE c] [CYCLE];`.
 * Only the attributes the author SET are emitted (pg fills the rest); clause order follows pg's grammar.
 */
export const createSequenceDdl = (name: string, a: PgSequenceAttrs): string => {
  const parts = [`CREATE SEQUENCE ${escId(name)}`];
  if (a.increment !== undefined) parts.push(`INCREMENT BY ${a.increment}`);
  if (a.min !== undefined) parts.push(`MINVALUE ${a.min}`);
  if (a.max !== undefined) parts.push(`MAXVALUE ${a.max}`);
  if (a.start !== undefined) parts.push(`START WITH ${a.start}`);
  if (a.cache !== undefined) parts.push(`CACHE ${a.cache}`);
  if (a.cycle) parts.push("CYCLE");
  return `${parts.join(" ")};`;
};
/** `DROP SEQUENCE IF EXISTS "name";`. */
export const dropSequenceSql = (name: string) =>
  `DROP SEQUENCE IF EXISTS ${escId(name)};`;

// --- domain (CREATE DOMAIN) ---------------------------------------------------------------------

/** A domain's emit-relevant shape: its base type + the optional NOT NULL / DEFAULT / CHECK clauses. */
export interface PgDomainAttrs {
  baseType: string;
  notNull?: boolean;
  default?: string;
  check?: string;
}

/** `CREATE DOMAIN "name" AS <base> [DEFAULT d] [NOT NULL] [CHECK (expr)];` (pg's clause order). */
export const createDomainDdl = (name: string, a: PgDomainAttrs): string => {
  const parts = [`CREATE DOMAIN ${escId(name)} AS ${a.baseType}`];
  if (a.default !== undefined) parts.push(`DEFAULT ${a.default}`);
  if (a.notNull) parts.push("NOT NULL");
  if (a.check !== undefined) parts.push(`CHECK (${a.check})`);
  return `${parts.join(" ")};`;
};
/** `DROP DOMAIN IF EXISTS "name";`. */
export const dropDomainSql = (name: string) =>
  `DROP DOMAIN IF EXISTS ${escId(name)};`;

// --- extension (CREATE EXTENSION) ---------------------------------------------------------------

/** Optional `SCHEMA`/`VERSION` modifiers for a `CREATE EXTENSION`. */
export interface PgExtensionAttrs {
  schema?: string;
  version?: string;
}

/** `CREATE EXTENSION IF NOT EXISTS "name" [SCHEMA "s"] [VERSION 'v'];`. */
export const createExtensionDdl = (
  name: string,
  a: PgExtensionAttrs,
): string => {
  const parts = [`CREATE EXTENSION IF NOT EXISTS ${escId(name)}`];
  if (a.schema !== undefined) parts.push(`SCHEMA ${escId(a.schema)}`);
  if (a.version !== undefined)
    parts.push(`VERSION '${a.version.replace(/'/g, "''")}'`);
  return `${parts.join(" ")};`;
};
/** `DROP EXTENSION IF EXISTS "name";`. */
export const dropExtensionSql = (name: string) =>
  `DROP EXTENSION IF EXISTS ${escId(name)};`;
