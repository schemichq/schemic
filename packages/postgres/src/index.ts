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
  Diff,
  DiffItem,
  Driver,
  EmitOptions,
  MigrationDirection,
  MigrationRecord,
  MigrationStore,
  PortableDb,
  PortableField,
  PortableIndex,
  PortableTable,
  PortableType,
  ResolveContext,
  ResolvedConfig,
  ScalarName,
  ShadowCapability,
  Statement,
} from "@schemic/core/driver";
import {
  connectionEntry,
  nullable,
  registerDriver,
} from "@schemic/core/driver";
import type { PgTableDef } from "./authoring";
import {
  addColSql,
  addFkSql,
  canonField,
  createTableDdl,
  dropColSql,
  dropTableSql,
  escId,
  fkActions,
  fkName,
  pgColumn,
  pgEmitFields,
} from "./emit";
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

// --- normalize: project the portable IR onto what Postgres represents ---------------------------

function pgNormalizeTable(t: PortableTable): PortableTable {
  // Drop dotted sub-fields (folded into their jsonb parent); keep the equality-relevant per-field
  // shape (canonField) + the structural table objects that round-trip (composite PK).
  const fields = t.fields
    .filter((f) => !f.name.includes("."))
    .map((f) => canonField(f, t.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: PortableTable = {
    name: t.name,
    kind: { kind: "NORMAL" }, // Postgres has no relation/any table kinds.
    schemafull: true,
    fields,
    indexes: [], // secondary/unique indexes emit but aren't introspected back yet (capability gap)
    events: [],
  };
  if (t.primaryKey && t.primaryKey.length > 0)
    out.primaryKey = [...t.primaryKey];
  return out;
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
  const fields = pgEmitFields(t);
  const create: Statement = {
    kind: "table",
    name: t.name,
    ddl: createTableDdl(t),
  };

  const fks: Statement[] = [];
  const idx: Statement[] = [];
  const comments: Statement[] = [];
  for (const f of fields) {
    const col = pgColumn(f.type);
    if (col.references) {
      fks.push({
        kind: "fk", // FK applied after all tables exist (ordered via the RANK below).
        name: fkName(t.name, f.name),
        table: t.name,
        ddl: `ALTER TABLE ${escId(t.name)} ADD CONSTRAINT ${escId(fkName(t.name, f.name))} FOREIGN KEY (${escId(f.name)}) REFERENCES ${escId(col.references)} (${escId("id")})${fkActions(f.reference)};`,
      });
    }
    if (f.comment !== undefined) {
      comments.push({
        kind: "comment",
        name: `${t.name}.${f.name}`,
        table: t.name,
        ddl: `COMMENT ON COLUMN ${escId(t.name)}.${escId(f.name)} IS '${f.comment.replace(/'/g, "''")}';`,
      });
    }
  }
  for (const ix of t.indexes) {
    if (ix.spec !== "UNIQUE") continue; // only UNIQUE indexes in this pass
    idx.push({
      kind: "index",
      name: ix.name,
      table: t.name,
      ddl: `CREATE UNIQUE INDEX ${escId(ix.name)} ON ${escId(t.name)} (${ix.cols.map(escId).join(", ")});`,
    });
  }
  return [create, ...fks, ...idx, ...comments];
}

function pgEmit(db: PortableDb, _opts?: EmitOptions): Statement[] {
  // All CREATE TABLEs first, then FK constraints + indexes, then comments.
  const tables = [...db.tables].sort((a, b) => a.name.localeCompare(b.name));
  const stmts = tables.flatMap(emitTable);
  const RANK: Record<string, number> = {
    table: 0,
    field: 1,
    fk: 2,
    index: 2,
    event: 3,
    function: 4,
    access: 5,
    comment: 6,
  };
  return [...stmts].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
}

/** DROP DDL for one Postgres object. (Postgres emits per-table, so objects are tables + FK constraints.) */
function pgRemove(s: Statement): string {
  if (s.kind === "comment" && s.table) {
    const col = s.name.slice(s.table.length + 1);
    return `COMMENT ON COLUMN ${escId(s.table)}.${escId(col)} IS NULL;`;
  }
  if (s.kind === "fk" && s.table) {
    // FK constraints (ALTER TABLE … ADD CONSTRAINT) are dropped as constraints.
    return `ALTER TABLE ${escId(s.table)} DROP CONSTRAINT IF EXISTS ${escId(s.name)};`;
  }
  if (s.kind === "index") {
    // CREATE [UNIQUE] INDEX … is dropped as an index.
    return `DROP INDEX IF EXISTS ${escId(s.name)};`;
  }
  return `DROP TABLE IF EXISTS ${escId(s.name)} CASCADE;`;
}

/**
 * Replace one Postgres object. Postgres has no in-place CREATE-OR-REPLACE for tables, so a changed
 * table is drop+recreate (COARSE — destructive of row data). Per-column ALTERs are a future
 * refinement once the portable diff tracks field-level changes for the pg driver.
 */
function pgOverwrite(s: Statement): string {
  return `${pgRemove(s)}\n${s.ddl}`;
}

// --- diff: FIELD-LEVEL Postgres DDL (ALTER TABLE), not whole-table drop+recreate ----------------

/** One ordered diff op: forward `up` DDL, the `down` DDL that undoes it (internal order preserved). */
interface PgOp {
  up: string[];
  down: string[];
  items: DiffItem[];
}

/**
 * Field-level Postgres diff. Tables present on BOTH sides diff column-by-column into ALTER TABLE
 * ADD/DROP/ALTER COLUMN — so adding a column no longer drops the table's rows (the old coarse
 * drop+recreate). Whole tables added/removed still CREATE / DROP CASCADE. Ops are built in up-
 * dependency order (all CREATEs before FKs; column drops/table drops last); `down` is the inverse
 * run backwards (ops reversed, each op's own DDL inverted). A column TYPE change is best-effort —
 * Postgres attempts the cast and an incompatible change surfaces at apply.
 */
function pgDiff(prev: PortableDb, next: PortableDb): Diff {
  const a = pgNormalize(prev);
  const b = pgNormalize(next);
  const prevT = new Map(a.tables.map((t) => [t.name, t]));
  const nextT = new Map(b.tables.map((t) => [t.name, t]));
  const refOf = (f: PortableField) => pgColumn(f.type).references;
  // RAW (un-normalized) tables carry the full clauses (default/check/identity/PK/FK actions/…) — emit
  // new/removed tables from these so generated migrations reproduce the authored schema exactly.
  const prevRaw = new Map(prev.tables.map((t) => [t.name, t]));
  const nextRaw = new Map(next.tables.map((t) => [t.name, t]));

  const ops: PgOp[] = [];
  const add = (op: PgOp) => ops.push(op);

  // 1) New tables: full CREATE (composite PK, identity, defaults, …) first, then their FKs/indexes/
  //    comments — so a cross-table FK finds its target. `down` is a DROP CASCADE (handles all of it).
  const newTables = b.tables.filter((t) => !prevT.has(t.name));
  for (const t of newTables) {
    const raw = nextRaw.get(t.name);
    const create = raw && emitTable(raw).find((s) => s.kind === "table");
    if (!create) continue;
    add({
      up: [create.ddl],
      down: [dropTableSql(t.name)],
      items: [
        {
          op: "add",
          key: `table:${t.name}:${t.name}`,
          kind: "table",
          table: t.name,
          ddl: create.ddl,
        },
      ],
    });
  }
  for (const t of newTables) {
    const raw = nextRaw.get(t.name);
    if (!raw) continue;
    for (const stmt of emitTable(raw).filter((s) => s.kind !== "table")) {
      add({
        up: [stmt.ddl],
        down: [pgRemove(stmt)],
        items: [
          {
            op: "add",
            key: `${stmt.kind}:${t.name}:${stmt.name}`,
            kind: stmt.kind,
            table: t.name,
            ddl: stmt.ddl,
          },
        ],
      });
    }
  }

  // 2) Tables on BOTH sides: column-level ALTERs.
  for (const t of b.tables) {
    const before = prevT.get(t.name);
    if (!before) continue;
    const beforeF = new Map(before.fields.map((f) => [f.name, f]));
    const afterF = new Map(t.fields.map((f) => [f.name, f]));

    // added columns (+ FK)
    for (const f of t.fields) {
      if (beforeF.has(f.name)) continue;
      const ref = refOf(f);
      const up = [
        addColSql(t.name, f),
        ...(ref ? [addFkSql(t.name, f.name, ref)] : []),
      ];
      add({
        up,
        down: [dropColSql(t.name, f.name)], // DROP COLUMN cascades to its FK
        items: [
          {
            op: "add",
            key: `field:${t.name}:${f.name}`,
            kind: "field",
            table: t.name,
            ddl: addColSql(t.name, f),
          },
        ],
      });
    }

    // changed columns (type and/or nullability)
    for (const f of t.fields) {
      const bf = beforeF.get(f.name);
      if (!bf) continue;
      const ca = pgColumn(f.type);
      const cb = pgColumn(bf.type);
      if (ca.sql === cb.sql && ca.nullable === cb.nullable) continue;
      const upStmts: string[] = [];
      const downStmts: string[] = [];
      if (ca.sql !== cb.sql) {
        upStmts.push(
          `ALTER TABLE ${escId(t.name)} ALTER COLUMN ${escId(f.name)} TYPE ${ca.sql};`,
        );
        downStmts.push(
          `ALTER TABLE ${escId(t.name)} ALTER COLUMN ${escId(f.name)} TYPE ${cb.sql};`,
        );
      }
      if (ca.nullable !== cb.nullable) {
        const setNull = (n: boolean) =>
          `ALTER TABLE ${escId(t.name)} ALTER COLUMN ${escId(f.name)} ${n ? "DROP NOT NULL" : "SET NOT NULL"};`;
        upStmts.push(setNull(ca.nullable));
        downStmts.push(setNull(cb.nullable));
      }
      add({
        up: upStmts,
        down: downStmts,
        items: [
          {
            op: "change",
            key: `field:${t.name}:${f.name}`,
            kind: "field",
            table: t.name,
            before: `${escId(f.name)} ${cb.sql}${cb.nullable ? "" : " NOT NULL"}`,
            after: `${escId(f.name)} ${ca.sql}${ca.nullable ? "" : " NOT NULL"}`,
          },
        ],
      });
    }

    // dropped columns (DROP COLUMN cascades to its FK; recreate adds the column back + FK on down)
    for (const f of before.fields) {
      if (afterF.has(f.name)) continue;
      const ref = refOf(f);
      add({
        up: [dropColSql(t.name, f.name)],
        down: [
          addColSql(t.name, f),
          ...(ref ? [addFkSql(t.name, f.name, ref)] : []),
        ],
        items: [
          {
            op: "remove",
            key: `field:${t.name}:${f.name}`,
            kind: "field",
            table: t.name,
            ddl: dropColSql(t.name, f.name),
            old: addColSql(t.name, f),
          },
        ],
      });
    }
  }

  // 3) Removed tables: DROP CASCADE up / full recreate (table then FKs/indexes/comments) down.
  for (const t of a.tables) {
    if (nextT.has(t.name)) continue;
    const raw = prevRaw.get(t.name);
    const recreate = raw ? emitTable(raw).map((s) => s.ddl) : [];
    add({
      up: [dropTableSql(t.name)],
      down: recreate,
      items: [
        {
          op: "remove",
          key: `table:${t.name}:${t.name}`,
          kind: "table",
          table: t.name,
          ddl: dropTableSql(t.name),
          old: recreate.join("\n"),
        },
      ],
    });
  }

  const up = ops.flatMap((o) => o.up);
  // `down` undoes `up`: reverse the op order, each op contributing its own (internally-ordered) down.
  const down = [...ops].reverse().flatMap((o) => o.down);
  const items = ops.flatMap((o) => o.items);
  return { up, down, items };
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
): Promise<PortableDb> {
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

  // Group index rows -> PortableIndex[] per table (columns in index order, dedup by index name).
  const idxBy = new Map<string, Map<string, PortableIndex>>();
  for (const r of idxs) {
    if (skip.has(r.table_name)) continue;
    const byName = idxBy.get(r.table_name) ?? new Map<string, PortableIndex>();
    const ix = byName.get(r.index_name) ?? {
      name: r.index_name,
      cols: [],
      spec: "UNIQUE",
    };
    ix.cols.push(r.column_name);
    byName.set(r.index_name, ix);
    idxBy.set(r.table_name, byName);
  }

  const tables: PortableTable[] = [...seen].map((name) => {
    const t: PortableTable = {
      name,
      kind: { kind: "NORMAL" },
      schemafull: true,
      fields: byTable.get(name) ?? [],
      indexes: [...(idxBy.get(name)?.values() ?? [])],
      events: [],
    };
    if (!isImplicit(name)) {
      const pk = pkBy.get(name);
      if (pk && pk.length > 0) t.primaryKey = pk;
    }
    return t;
  });
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

  // Lower the pg-native `s.*` authoring objects to the portable IR (see ./lower.ts). The authored
  // tables are this driver's own `PgTableDef` (a structural `Authored`); core hands them back opaquely.
  lower: (tables) => pgLower(tables as unknown as PgTableDef[]),

  emit: pgEmit,
  remove: pgRemove,
  overwrite: pgOverwrite,
  introspect: (conn, exclude) => pgIntrospect(conn, exclude),
  normalize: pgNormalize,
  equal: (a, b) => deepEqualJson(pgNormalize(a), pgNormalize(b)),
  diff: pgDiff,

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

/** A small structural deep-equal (the portable IR is plain JSON). */
function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

registerDriver(postgresDriver as Driver<unknown>);
