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

import type {
  ApplyOptions,
  ConnectionConfigBase,
  ConnectionEntry,
  ConnectionInput,
  ConnectionOverrides,
  Definable,
  Diff,
  Driver,
  MigrationDirection,
  MigrationRecord,
  MigrationStore,
  PortableField,
  PortableObject,
  PortableType,
  ResolveContext,
  ResolvedConfig,
  ScalarName,
  ShadowCapability,
} from "@schemic/core/driver";
import {
  connectionEntry,
  nullable,
  registerDriver,
} from "@schemic/core/driver";
import type { PgTableDef } from "./authoring";
import { escId, type PgIndexInfo, type PgTable } from "./emit";
import { registry, splitTables } from "./kinds";
import { pgLower } from "./lower";

// The pg-native authoring surface (`s.*`, defineTable, PgField, $postgres escape hatch, …).
export * from "./authoring";

// A minimal structural view of a PGlite/node-postgres connection (so core needs no hard pg dep).
export interface PgConn {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

// --- introspect: information_schema -> portable IR ----------------------------------------------

interface ColRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  is_identity: string;
  identity_generation: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}
interface FkRow {
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  delete_rule: string;
  update_rule: string;
}
interface PkRow {
  table_name: string;
  column_name: string;
}
interface IdxRow {
  table_name: string;
  index_name: string;
  column_name: string;
}

const nativeT = (name: string, params?: (string | number)[]): PortableType =>
  params && params.length > 0
    ? { t: "native", db: "postgres", name, params }
    : { t: "native", db: "postgres", name };
const scalarT = (name: ScalarName): PortableType => ({ t: "scalar", name });

/** information_schema data_type -> the CANONICAL portable scalar (mirrors lower's CANON, reversed). */
const DATATYPE_TO_SCALAR: Record<string, ScalarName> = {
  text: "string",
  integer: "int",
  "double precision": "float",
  boolean: "bool",
  uuid: "uuid",
  bytea: "bytes",
  interval: "duration",
};
/** data_type spellings that differ from our pg-type token (so a native node matches what lower made). */
const DATATYPE_TO_NATIVE: Record<string, string> = {
  "time without time zone": "time",
  "time with time zone": "timetz",
};

/** A column row -> portable type, INVERSE of lower's token->portable (canonical -> scalar, else native+params). */
function introspectType(c: ColRow): PortableType {
  const dt = c.data_type;
  if (dt === "ARRAY") {
    // udt_name is the element type prefixed with `_` (e.g. `_int4`, `_text`).
    return { t: "array", elem: pgScalarFromUdt(c.udt_name.replace(/^_/, "")) };
  }
  if (dt === "jsonb") return { t: "object", fields: {} };
  if (dt === "json") return nativeT("json");
  if (dt === "character varying")
    return c.character_maximum_length != null
      ? nativeT("varchar", [c.character_maximum_length])
      : nativeT("varchar");
  if (dt === "character")
    return c.character_maximum_length != null
      ? nativeT("char", [c.character_maximum_length])
      : nativeT("char");
  if (dt === "numeric")
    return c.numeric_precision != null
      ? nativeT("numeric", [c.numeric_precision, c.numeric_scale ?? 0])
      : scalarT("decimal");
  if (dt === "timestamp without time zone") return nativeT("timestamp");
  if (dt === "timestamp with time zone") return scalarT("datetime");
  const sc = DATATYPE_TO_SCALAR[dt];
  if (sc) return scalarT(sc);
  return nativeT(DATATYPE_TO_NATIVE[dt] ?? dt);
}

// Array element udt -> portable scalar (CANONICAL only; non-canonical elements ride as native, which
// may not match lower's type name -> arrays of native types are a documented round-trip gap).
const UDT_TO_SCALAR: Record<string, ScalarName> = {
  text: "string",
  int4: "int",
  float8: "float",
  numeric: "decimal",
  bool: "bool",
  timestamptz: "datetime",
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
): Promise<PgTable[]> {
  // Also skip the companion lock table this driver creates for any excluded (bookkeeping) table.
  const skip = new Set(exclude);
  for (const t of exclude) skip.add(`${t}_lock`);
  const { rows: cols } = await conn.query<ColRow>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable,
            is_identity, identity_generation,
            character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const { rows: fks } = await conn.query<FkRow>(
    `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
            rc.delete_rule, rc.update_rule
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  const { rows: pks } = await conn.query<PkRow>(
    `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ORDER BY kcu.ordinal_position`,
  );
  // UNIQUE secondary indexes (NOT the PK's implicit index, NOT expression indexes) — the ones this
  // driver emits via $unique/.index({unique}). Columns kept in index order. Required so the `index`
  // kind ROUND-TRIPS (the registry diffs by presence; an un-introspected index would phantom-add).
  const { rows: idxs } = await conn.query<IdxRow>(
    `SELECT t.relname AS table_name, i.relname AS index_name, a.attname AS column_name
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
       JOIN pg_index ix ON ix.indrelid = t.oid AND ix.indisunique AND NOT ix.indisprimary
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN LATERAL unnest(string_to_array(ix.indkey::text, ' ')::int[])
            WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relkind = 'r'
      ORDER BY t.relname, i.relname, k.ord`,
  );

  const fkBy = new Map<string, FkRow>();
  for (const f of fks) fkBy.set(`${f.table_name}.${f.column_name}`, f);
  const pkBy = new Map<string, string[]>();
  for (const p of pks) {
    const list = pkBy.get(p.table_name) ?? [];
    list.push(p.column_name);
    pkBy.set(p.table_name, list);
  }
  // The implicit key is the lone `id text` PK pgEmit adds; a custom/composite PK is anything else.
  const isImplicit = (table: string) => {
    const pk = pkBy.get(table);
    return pk?.length === 1 && pk[0] === "id";
  };

  const seen = new Set<string>();
  const byTable = new Map<string, PortableField[]>();
  for (const c of cols) {
    if (skip.has(c.table_name)) continue;
    seen.add(c.table_name);
    if (c.column_name === "id" && isImplicit(c.table_name)) continue;
    const fk = fkBy.get(`${c.table_name}.${c.column_name}`);
    let type: PortableType = fk
      ? { t: "record", tables: [fk.foreign_table_name] }
      : introspectType(c);
    if (c.is_nullable === "YES") type = nullable(type);
    const pf: PortableField = {
      name: c.column_name,
      table: c.table_name,
      type,
    };
    if (c.is_identity === "YES")
      pf.identity =
        c.identity_generation === "ALWAYS" ? "always" : "by-default";
    if (fk) {
      const ref: { on_delete?: string; on_update?: string } = {};
      if (fk.delete_rule && fk.delete_rule !== "NO ACTION")
        ref.on_delete = fk.delete_rule;
      if (fk.update_rule && fk.update_rule !== "NO ACTION")
        ref.on_update = fk.update_rule;
      if (ref.on_delete !== undefined || ref.on_update !== undefined)
        pf.reference = ref;
    }
    const list = byTable.get(c.table_name) ?? [];
    list.push(pf);
    byTable.set(c.table_name, list);
  }

  // Group index rows -> PgIndexInfo[] per table (columns in index order, dedup by index name).
  const idxBy = new Map<string, Map<string, PgIndexInfo>>();
  for (const r of idxs) {
    if (skip.has(r.table_name)) continue;
    const byName = idxBy.get(r.table_name) ?? new Map<string, PgIndexInfo>();
    const ix = byName.get(r.index_name) ?? {
      name: r.index_name,
      cols: [],
      unique: true,
    };
    ix.cols.push(r.column_name);
    byName.set(r.index_name, ix);
    idxBy.set(r.table_name, byName);
  }

  return [...seen].map((name) => {
    const t: PgTable = {
      name,
      fields: byTable.get(name) ?? [],
      indexes: [...(idxBy.get(name)?.values() ?? [])],
    };
    if (!isImplicit(name)) {
      const pk = pkBy.get(name);
      if (pk && pk.length > 0) t.primaryKey = pk;
    }
    return t;
  });
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
  // A throwaway in-memory PGlite IS the shadow: apply the DDL, read it back as kind objects, done (no
  // drop needed — the instance is discarded). This is the "embedded engine" canonicalization path.
  async roundTrip(_conn, _config, ddl): Promise<PortableObject[]> {
    const scratch = await newPglite();
    try {
      if (ddl.trim()) await scratch.exec(ddl);
      return splitTables(await pgIntrospect(scratch));
    } finally {
      await scratch.close();
    }
  },
  async ephemeral() {
    const conn = await newPglite();
    return { conn, stop: () => conn.close() };
  },
};

// --- pgSql: a safe tagged-template query builder (the Postgres analogue of `surql`) -------------

/** A bound Postgres query: text with positional `$1..$n` placeholders + the values bound to them. */
export interface BoundPgQuery {
  query: string;
  params: unknown[];
}

/** A raw SQL fragment spliced VERBATIM into a `pgSql` template (NOT parameterized — caller-trusted). */
interface PgFragment {
  readonly __pgRaw: string;
}
const isFragment = (v: unknown): v is PgFragment =>
  typeof v === "object" && v !== null && "__pgRaw" in v;
const isBound = (v: unknown): v is BoundPgQuery =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as BoundPgQuery).query === "string" &&
  Array.isArray((v as BoundPgQuery).params);

/** Splice a raw SQL string verbatim (NOT parameterized — only for caller-trusted SQL). */
export function raw(sql: string): PgFragment {
  return { __pgRaw: sql };
}

/** A safely double-quoted identifier (table/column) to splice into a `pgSql` template. */
export function identifier(name: string): PgFragment {
  return { __pgRaw: escId(name) };
}

/**
 * Tagged-template SQL builder — the Postgres analogue of SurrealDB's `surql`. Interpolated values
 * become positional bind params (`$1..$n`), so values are never string-interpolated (injection-safe).
 * Wrap a value in {@link raw} / {@link identifier} to splice SQL STRUCTURE instead of a param, and a
 * nested `pgSql` composes (its placeholders renumber, its params merge). Returns a {@link BoundPgQuery}
 * — it does NOT execute; pass it to `postgresDriver.query` / `conn.query`, or nest it in another `pgSql`.
 *
 *   pgSql`SELECT * FROM ${identifier("user")} WHERE id = ${id}`
 *   // -> { query: 'SELECT * FROM "user" WHERE id = $1', params: [id] }
 */
export function pgSql(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BoundPgQuery {
  let query = "";
  const params: unknown[] = [];
  strings.forEach((str, i) => {
    query += str;
    if (i >= values.length) return;
    const v = values[i];
    if (isFragment(v)) {
      query += v.__pgRaw;
    } else if (isBound(v)) {
      // Compose: renumber the nested query's $n by the params already collected, then merge.
      query += v.query.replace(
        /\$(\d+)/g,
        (_m, n) => `$${params.length + Number(n)}`,
      );
      params.push(...v.params);
    } else {
      params.push(v);
      query += `$${params.length}`;
    }
  });
  return { query, params };
}

// --- postgresConnection: the multi-connection authoring factory ---------------------------------

/** Postgres connection params, on top of the dialect-neutral base ({schema, key?, migrations?}). */
export interface PostgresConnectionConfig extends ConnectionConfigBase {
  /**
   * Where to connect. `file:<dir>` (or a bare path) -> embedded PGlite data dir; empty/omitted ->
   * in-memory PGlite. A `postgres://` URL is reserved for a future node-postgres client.
   */
  url?: string;
}

/**
 * Typed `postgresConnection(...)` factory — the only thing a config's `connections` map accepts for
 * this driver. Wraps {@link connectionEntry} with the Postgres connection shape. Pass a static config,
 * a resolver yielding one config, or a resolver yielding a keyed COLLECTION (each entry needs `key`).
 */
export function postgresConnection(
  config: PostgresConnectionConfig,
): ConnectionEntry;
export function postgresConnection(
  resolver: (
    ctx: ResolveContext,
  ) => PostgresConnectionConfig | Promise<PostgresConnectionConfig>,
): ConnectionEntry;
export function postgresConnection(
  resolver: (
    ctx: ResolveContext,
  ) =>
    | (PostgresConnectionConfig & { key: string })[]
    | Promise<(PostgresConnectionConfig & { key: string })[]>,
): ConnectionEntry;
export function postgresConnection(
  input: ConnectionInput<PostgresConnectionConfig>,
): ConnectionEntry {
  return connectionEntry("postgres", input);
}

// --- migration bookkeeping (apply-time SQL behind migrate/rollback/status) ----------------------

const MIG_UP = "-- schemic:up";
const MIG_DOWN = "-- schemic:down";

/** Render a diff to a Postgres migration file: marker-delimited `up` and `down` DDL sections. */
function renderMigration(_tag: string, diff: Diff): string {
  return `${MIG_UP}\n${diff.up.join("\n")}\n\n${MIG_DOWN}\n${diff.down.join("\n")}\n`;
}

/** Extract the `up` or `down` DDL section from a migration file body. */
function migSection(content: string, direction: MigrationDirection): string {
  const up = content.indexOf(MIG_UP);
  const down = content.indexOf(MIG_DOWN);
  if (up === -1 || down === -1) return direction === "up" ? content : "";
  return direction === "up"
    ? content.slice(up + MIG_UP.length, down)
    : content.slice(down + MIG_DOWN.length);
}

const sqlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;
const lockTableOf = (table: string) => `${table}_lock`;

async function ensureMigTable(conn: PgConn, table: string): Promise<void> {
  await conn.exec(
    `CREATE TABLE IF NOT EXISTS ${escId(table)} (
  ${escId("tag")} text PRIMARY KEY,
  ${escId("file")} text NOT NULL,
  ${escId("checksum")} text NOT NULL,
  ${escId("applied_at")} timestamptz NOT NULL DEFAULT now()
);`,
  );
}

const recordInsert = (table: string, r: MigrationRecord) =>
  `INSERT INTO ${escId(table)} (${escId("tag")}, ${escId("file")}, ${escId("checksum")}) VALUES (${sqlStr(r.tag)}, ${sqlStr(r.file)}, ${sqlStr(r.checksum)});`;

const migrations: MigrationStore<PgConn> = {
  render: renderMigration,
  ensure: ensureMigTable,

  async applied(conn, table) {
    const { rows } = await conn.query<{ tag: string; checksum: string }>(
      `SELECT ${escId("tag")}, ${escId("checksum")} FROM ${escId(table)};`,
    );
    return new Map(rows.map((r) => [r.tag, r.checksum]));
  },

  // Postgres runs DDL inside a transaction, so the migration's section + its bookkeeping write commit
  // atomically — the record lands iff the DDL applied.
  async apply(conn, table, { content, direction, record }) {
    const ddl = migSection(content, direction).trim();
    const book =
      direction === "up"
        ? recordInsert(table, record)
        : `DELETE FROM ${escId(table)} WHERE ${escId("tag")} = ${sqlStr(record.tag)};`;
    await conn.exec(`BEGIN;\n${ddl ? `${ddl}\n` : ""}${book}\nCOMMIT;`);
  },

  async record(conn, table, record) {
    await ensureMigTable(conn, table);
    await conn.exec(recordInsert(table, record));
  },

  async clear(conn, table) {
    await conn.exec(`DELETE FROM ${escId(table)};`);
  },

  // A persisted lock ROW (survives across separate CLI runs on a file-based PGlite, unlike a session
  // advisory lock). The PK collision on a held lock is the "already locked" signal.
  async lock(conn, table) {
    const lt = lockTableOf(table);
    await conn.exec(
      `CREATE TABLE IF NOT EXISTS ${escId(lt)} (${escId("id")} int PRIMARY KEY);`,
    );
    try {
      await conn.exec(`INSERT INTO ${escId(lt)} (${escId("id")}) VALUES (1);`);
    } catch {
      throw new Error(
        "Migrations are locked — another run is in progress. If it's stale, run `schemic unlock`.",
      );
    }
  },

  async unlock(conn, table) {
    const lt = lockTableOf(table);
    await conn.exec(
      `CREATE TABLE IF NOT EXISTS ${escId(lt)} (${escId("id")} int PRIMARY KEY);\nDELETE FROM ${escId(lt)} WHERE ${escId("id")} = 1;`,
    );
  },
};

export const postgresDriver: Driver<PgConn> = {
  name: "postgres",

  // The kind registry (table/index/constraint) — core runs lower/diff/emit/order generically over it.
  registry,

  // Authoring (pg-native `defineTable` -> PgTableDef) -> kinded Definables: lower each table to the
  // driver's `PgTable` IR (./lower.ts), then split it into [table, ...index, ...constraint] objects
  // (./kinds.ts splitTable). Core then runs lowerSchema(registry, explode(...)). pg has no standalone
  // defs, so `defs` is unused.
  explode: (tables): Definable[] =>
    splitTables(pgLower(tables as unknown as PgTableDef[])),

  // One information_schema/pg_catalog read -> ALL kind objects, canonicalized identically to lowering
  // (a clean apply round-trips to a zero diff) and complete (table + index + FK), so no phantom diffs.
  introspectAll: async (conn, exclude) =>
    splitTables(await pgIntrospect(conn, exclude)),

  /**
   * Raw READ query for connection RESOLVERS + seed (returns rows opaquely). Postgres binds
   * POSITIONALLY, so the uniform `vars` record is mapped onto `$1..$n`: a string with NAMED `$name`
   * placeholders + `vars` is rewritten to positional `$1..$n` with `vars` bound by name (never
   * string-interpolated); native numeric `$1` is left untouched; no `vars` -> run as-is. To build a
   * query safely from interpolated values, use {@link pgSql} (positional) and run it via the raw
   * connection: `conn.query(q.query, q.params)` — that also avoids rewriting `$` inside string literals.
   */
  async query<T = unknown>(
    conn: PgConn,
    sql: string,
    vars?: Record<string, unknown>,
  ): Promise<T[]> {
    if (!vars || Object.keys(vars).length === 0) {
      return (await conn.query<T>(sql)).rows;
    }
    const params: unknown[] = [];
    const text = sql.replace(
      /\$([A-Za-z_][A-Za-z0-9_]*)/g,
      (_m, name: string) => {
        if (!(name in vars)) {
          throw new Error(`postgres query: no binding for $${name}`);
        }
        params.push(vars[name]);
        return `$${params.length}`;
      },
    );
    return (await conn.query<T>(text, params)).rows;
  },

  connect(
    config: ResolvedConfig,
    _over?: ConnectionOverrides,
  ): Promise<PgConn> {
    // The neutral ResolvedConfig carries the driver-specific connection bag in `params` (our
    // PostgresConnectionConfig minus the neutral schema/migrations/key). PGlite is embedded; treat a
    // `file:`/path url as a data dir, else in-memory.
    const url = typeof config.params.url === "string" ? config.params.url : "";
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

  close(conn: PgConn): Promise<void> {
    return conn.close();
  },

  // Apply-time migration bookkeeping (the `_migrations` table SQL behind migrate/rollback/status).
  migrations,

  // `schemic init --driver postgres` scaffolds a real connections-only pg project from these files
  // (the CLI adds the neutral migration snapshot).
  initScaffold: () => ({
    "schemic.config.ts": INIT_CONFIG_TS,
    "database/schema/tables.ts": INIT_SCHEMA_TS,
    "database/seed.ts": INIT_SEED_TS,
    ".env.example": INIT_ENV,
  }),

  shadow,
};

// --- `schemic init` scaffold templates ----------------------------------------------------------

const INIT_CONFIG_TS = `import { defineConfig } from "@schemic/core/config";
import { postgresConnection } from "@schemic/postgres";

// Connections-only config: a map of named connections, each from a driver factory. Values are
// explicit — read env yourself (no magic env vars).
export default defineConfig({
  connections: {
    default: postgresConnection({
      schema: "./database/schema",
      // PGlite (embedded): \`file:<dir>\` is a persistent data dir; "" is in-memory. Point
      // DATABASE_URL at a real server (\`postgres://…\`) once the node-postgres client lands.
      url: process.env.DATABASE_URL ?? "file:./.pgdata",
    }),
  },
});
`;

const INIT_SCHEMA_TS = `import { defineTable, s, sqlExpr } from "@schemic/postgres";

export const user = defineTable("user", {
  email: s.varchar(255).$unique(),
  name: s.text(),
  age: s.smallint().optional(),
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});
`;

const INIT_SEED_TS = `// Seed script — run with \`schemic seed\`. Receives the live connection(s).
export default async function seed() {
  // await conn.query("INSERT INTO ...");
}
`;

const INIT_ENV = `# A real Postgres server (uncomment to use instead of embedded PGlite):
# DATABASE_URL=postgres://user:pass@localhost:5432/app
`;

registerDriver(postgresDriver as Driver<unknown>);
