// The POSTGRES driver — driver #2, the spike's proof the seam holds for a very different database
// (see docs/MULTI-DB-SPIKE.md, Milestone 3). It produces/consumes the PORTABLE IR natively: `emit`
// translates portable types to `CREATE TABLE`, `introspect` reads `information_schema` back into the
// portable IR, and `normalize` PROJECTS the portable IR onto what Postgres can actually represent.
//
// The execution engine is PGlite (embedded Postgres in WASM) — a real engine, so the round-trip is
// genuine, and it doubles as the driver's `shadow` capability (the "embedded engine" option the
// design calls out for DBs that can't spin an in-process throwaway the way SurrealDB can).
//
// KNOWN CAPABILITY GAPS (deliberate, documented — not silent loss):
//  - `option<T>` and `T | null` BOTH collapse to a nullable column: Postgres has no column-level
//    notion of "absent" distinct from NULL, so `normalize` folds option -> nullable. This is the
//    portable model working as designed — a rich superset projected down per dialect.
//  - Nested objects map to a single `jsonb` column; the dotted sub-fields are folded in (dropped by
//    `normalize`), mirroring how the Surreal IR auto-creates `x.*` elements.
//  - Surreal-only constructs (events, access, db functions, relations, changefeed, permissions) have
//    no Postgres analogue and are dropped by `normalize` with no DDL emitted.

import type { ResolvedConfig } from "../cli/config";
import type { DefineStatement } from "../ddl";
import type {
  ApplyOptions,
  ConnectionOverrides,
  Driver,
  EmitOptions,
  ShadowCapability,
  Statement,
} from "./driver";
import { registerDriver } from "./driver";
import type { PortableType, ScalarName } from "./portable";
import { nullable } from "./portable";
import type { PortableDb, PortableField, PortableTable } from "./portable-ir";

// A minimal structural view of a PGlite/node-postgres connection (so core needs no hard pg dep).
export interface PgConn {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

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

// information_schema.data_type -> portable scalar.
const PG_TO_SCALAR: Record<string, ScalarName> = {
  text: "string",
  "character varying": "string",
  character: "string",
  integer: "int",
  bigint: "int",
  smallint: "int",
  "double precision": "float",
  real: "float",
  numeric: "decimal",
  boolean: "bool",
  "timestamp with time zone": "datetime",
  "timestamp without time zone": "datetime",
  uuid: "uuid",
  bytea: "bytes",
  interval: "duration",
};

const escId = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** A portable column type and how it lands in Postgres: base SQL type, nullability, and FK target. */
interface PgColumn {
  sql: string;
  nullable: boolean;
  /** A `record<table>` link -> a FK to that table (single-target only; spike scope). */
  references?: string;
}

function pgColumn(type: PortableType): PgColumn {
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
    return { sql: type.name, nullable: false };
  }
  throw new Error(`postgres: cannot emit type ${JSON.stringify(type)}`);
}

// --- normalize: project the portable IR onto what Postgres represents ---------------------------

/** Collapse option -> nullable (Postgres can't distinguish absence from NULL). Idempotent. */
function pgCanonType(type: PortableType): PortableType {
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

function pgNormalizeTable(t: PortableTable): PortableTable {
  // Drop dotted sub-fields (folded into their jsonb parent) and Surreal-only field clauses; keep
  // only what a Postgres column carries: name, (canonical) type, nullability via the type.
  const fields = t.fields
    .filter((f) => !f.name.includes("."))
    .map<PortableField>((f) => ({
      name: f.name,
      table: t.name,
      type: pgCanonType(f.type),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    name: t.name,
    kind: { kind: "NORMAL" }, // Postgres has no relation/any table kinds.
    schemafull: true,
    fields,
    indexes: [],
    events: [],
  };
}

function pgNormalize(db: PortableDb): PortableDb {
  return {
    tables: [...db.tables]
      .map(pgNormalizeTable)
      .sort((a, b) => a.name.localeCompare(b.name)),
    functions: [], // no portable Postgres function model in the spike
    accesses: [],
  };
}

// --- emit: portable IR -> CREATE TABLE ----------------------------------------------------------

function emitTable(t: PortableTable): Statement[] {
  const norm = pgNormalizeTable(t);
  const cols: string[] = [`${escId("id")} text PRIMARY KEY`]; // implicit id (mirrors Surreal).
  const fks: Statement[] = [];
  for (const f of norm.fields) {
    const col = pgColumn(f.type);
    cols.push(`${escId(f.name)} ${col.sql}${col.nullable ? "" : " NOT NULL"}`);
    if (col.references) {
      fks.push({
        kind: "index", // reuse a structured kind for ordering; FK applied after all tables exist.
        name: `${t.name}_${f.name}_fkey`,
        table: t.name,
        ddl: `ALTER TABLE ${escId(t.name)} ADD CONSTRAINT ${escId(
          `${t.name}_${f.name}_fkey`,
        )} FOREIGN KEY (${escId(f.name)}) REFERENCES ${escId(col.references)} (${escId("id")});`,
      });
    }
  }
  const create: Statement = {
    kind: "table",
    name: t.name,
    ddl: `CREATE TABLE ${escId(t.name)} (\n  ${cols.join(",\n  ")}\n);`,
  };
  return [create, ...fks];
}

function pgEmit(db: PortableDb, _opts?: EmitOptions): Statement[] {
  // All CREATE TABLEs first, then all FK constraints (so referenced tables already exist).
  const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name));
  const stmts = tables.flatMap(emitTable);
  const RANK: Record<DefineStatement["kind"], number> = {
    table: 0,
    field: 1,
    index: 2,
    event: 3,
    function: 4,
    access: 5,
  };
  return [...stmts].sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

// --- introspect: information_schema -> portable IR ----------------------------------------------

interface ColRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
}
interface FkRow {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
}

function scalarFromPg(dataType: string, udtName: string): PortableType {
  if (dataType === "ARRAY") {
    // udt_name is the element type prefixed with `_` (e.g. `_int4`, `_text`).
    const elem = pgScalarFromUdt(udtName.replace(/^_/, ""));
    return { t: "array", elem };
  }
  if (dataType === "jsonb" || dataType === "json") {
    return { t: "object", fields: {} };
  }
  const name = PG_TO_SCALAR[dataType];
  if (!name) return { t: "native", db: "postgres", name: dataType };
  return { t: "scalar", name };
}

const UDT_TO_SCALAR: Record<string, ScalarName> = {
  text: "string",
  varchar: "string",
  int4: "int",
  int8: "int",
  int2: "int",
  float8: "float",
  float4: "float",
  numeric: "decimal",
  bool: "bool",
  timestamptz: "datetime",
  timestamp: "datetime",
  uuid: "uuid",
  bytea: "bytes",
  interval: "duration",
};
function pgScalarFromUdt(udt: string): PortableType {
  const name = UDT_TO_SCALAR[udt];
  return name
    ? { t: "scalar", name }
    : { t: "native", db: "postgres", name: udt };
}

async function pgIntrospect(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableDb> {
  const { rows: cols } = await conn.query<ColRow>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const { rows: fks } = await conn.query<FkRow>(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  const fkBy = new Map<string, string>(); // `table.col` -> foreign table
  for (const f of fks)
    fkBy.set(`${f.table_name}.${f.column_name}`, f.foreign_table_name);

  const byTable = new Map<string, PortableField[]>();
  for (const c of cols) {
    if (exclude.has(c.table_name)) continue;
    if (c.column_name === "id") continue; // implicit PK, not part of the portable IR.
    let type: PortableType;
    const fkTarget = fkBy.get(`${c.table_name}.${c.column_name}`);
    if (fkTarget) {
      type = { t: "record", tables: [fkTarget] };
    } else {
      type = scalarFromPg(c.data_type, c.udt_name);
    }
    if (c.is_nullable === "YES") type = nullable(type);
    const list = byTable.get(c.table_name) ?? [];
    list.push({ name: c.column_name, table: c.table_name, type });
    byTable.set(c.table_name, list);
  }

  const tables: PortableTable[] = [...byTable.entries()].map(
    ([name, fields]) => ({
      name,
      kind: { kind: "NORMAL" },
      schemafull: true,
      fields,
      indexes: [],
      events: [],
    }),
  );
  return { tables, functions: [], accesses: [] };
}

// --- connection (PGlite, embedded) --------------------------------------------------------------

async function newPglite(dataDir?: string): Promise<PgConn> {
  const pkg: string = "@electric-sql/pglite"; // non-literal so it stays an optional dep.
  let PGlite: (new (dir?: string) => PgConn) | undefined;
  try {
    const mod = (await import(pkg)) as {
      PGlite?: new (dir?: string) => PgConn;
    };
    PGlite = mod.PGlite;
  } catch {
    PGlite = undefined;
  }
  if (!PGlite) {
    throw new Error(
      "postgres driver needs `@electric-sql/pglite` (embedded) — install it, or wire a node-postgres client.",
    );
  }
  return new PGlite(dataDir);
}

const shadow: ShadowCapability<PgConn> = {
  // A throwaway in-memory PGlite IS the shadow: apply the DDL, read it back, done (no drop needed —
  // the instance is discarded). This is the "embedded engine" canonicalization path.
  async roundTrip(_conn, _config, ddl) {
    const scratch = await newPglite();
    try {
      if (ddl.trim()) await scratch.exec(ddl);
      return pgNormalize(await pgIntrospect(scratch));
    } finally {
      await scratch.close();
    }
  },
  async ephemeral() {
    const conn = await newPglite();
    return { conn, stop: () => conn.close() };
  },
};

export const postgresDriver: Driver<PgConn> = {
  name: "postgres",

  // Postgres authoring (a pg-native `sz`) is future work; for now `lower` is unused (the spike
  // authors with the Surreal surface and targets pg via the portable IR). Throw a clear error.
  lower() {
    throw new Error(
      "postgres: native authoring (sz.pg.*) is not part of the spike — author via the portable IR.",
    );
  },

  emit: pgEmit,
  introspect: (conn, exclude) => pgIntrospect(conn, exclude),
  normalize: pgNormalize,
  equal: (a, b) => deepEqualJson(pgNormalize(a), pgNormalize(b)),

  connect(
    config: ResolvedConfig,
    _over?: ConnectionOverrides,
  ): Promise<PgConn> {
    // PGlite is embedded; treat a `file:`/path url as a data dir, else in-memory.
    const url = config.db?.url ?? "";
    const dir = url.startsWith("file:") ? url.slice("file:".length) : undefined;
    return newPglite(dir);
  },

  async apply(
    conn: PgConn,
    statements: string[],
    opts?: ApplyOptions,
  ): Promise<void> {
    if (!statements.length) return;
    const body = statements.join("\n");
    if (opts?.transactional === false) {
      await conn.exec(body);
      return;
    }
    await conn.exec(`BEGIN;\n${body}\nCOMMIT;`);
  },

  shadow,
};

/** A small structural deep-equal (the portable IR is plain JSON). */
function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

registerDriver(postgresDriver as Driver<unknown>);
