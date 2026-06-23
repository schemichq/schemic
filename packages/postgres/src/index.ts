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

import type { SeedContext } from "@schemic/core";
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
import type {
  PgDomainDef,
  PgEnumDef,
  PgExtensionDef,
  PgFunctionDef,
  PgMatViewDef,
  PgPolicyDef,
  PgSequenceDef,
  PgTableDef,
  PgTriggerDef,
  PgViewDef,
} from "./authoring";
import {
  escId,
  type PgForeignKey,
  type PgIndexInfo,
  type PgTable,
  triggerDefSql,
} from "./emit";
import {
  domainPortable,
  enumPortable,
  extensionPortable,
  functionPortable,
  matViewPortable,
  policyPortable,
  registry,
  sequencePortable,
  splitTables,
  triggerPortable,
  viewPortable,
} from "./kinds";
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

/** A seed function: receives the live {@link PgConn} + the dialect-neutral {@link SeedContext}. */
export type PgSeed = (db: PgConn, ctx: SeedContext) => void | Promise<void>;
/**
 * Type a `database/seed/*` module — an identity wrapper (like `defineConfig`) so a seed gets full
 * typing for `(db, ctx)` with no imports of the connection/context types. The seed runner calls the
 * default export as `seed(db, ctx)`; `ctx.file(name)` reads a supporting file (raw `.sql`, JSON, …)
 * relative to the seed as a string, `ctx.dir` is its directory.
 */
export function defineSeed(fn: PgSeed): PgSeed {
  return fn;
}

// --- introspect: information_schema -> portable IR ----------------------------------------------

interface ColRow {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  domain_name: string | null;
  is_nullable: string;
  is_identity: string;
  identity_generation: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}
interface FkRow {
  name: string;
  table_name: string;
  ref_table: string;
  del: string;
  upd: string;
  cols: string[];
  ref_cols: string[];
}

/** A FK referential-action char (pg_constraint.confdeltype/confupdtype) -> SQL action; NO ACTION -> undefined. */
const FK_ACTION: Record<string, string> = {
  c: "CASCADE",
  r: "RESTRICT",
  n: "SET NULL",
  d: "SET DEFAULT",
};
const fkAction = (ch: string): string | undefined => FK_ACTION[ch];
interface PkRow {
  table_name: string;
  column_name: string;
}
interface IdxRow {
  table_name: string;
  index_name: string;
  column_name: string;
  is_unique: boolean;
  method: string;
  pred: string | null;
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
  // A column typed as a DOMAIN: information_schema reports the base type in data_type/udt_name but the
  // domain in domain_name — surface the domain (matches how `domain.column()` lowers: native <domain>).
  if (c.domain_name) return nativeT(c.domain_name);
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
  // A user-defined type (e.g. a native enum from `defineEnum`) -> native, named by its udt — matches
  // what lower made from the enum's pg-type token, so an enum column round-trips.
  if (dt === "USER-DEFINED") return nativeT(c.udt_name);
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
    // BASE TABLE only — exclude views (their columns also live in information_schema.columns); views
    // are introspected separately as the `view` kind (pgIntrospectViews).
    `SELECT c.table_name, c.column_name, c.data_type, c.udt_name, c.domain_name, c.is_nullable,
            c.is_identity, c.identity_generation,
            c.character_maximum_length, c.numeric_precision, c.numeric_scale
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position`,
  );
  // FKs via pg_catalog: conkey/confkey are ORDERED column arrays, so composite + non-`id`-target keys
  // round-trip (information_schema can't reliably pair multi-column local + referenced columns).
  const { rows: fks } = await conn.query<FkRow>(
    `SELECT con.conname AS name, c.relname AS table_name, rc.relname AS ref_table,
            con.confdeltype AS del, con.confupdtype AS upd,
            (SELECT array_agg(a.attname ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS cols,
            (SELECT array_agg(a.attname ORDER BY k.ord)
               FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_cols
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_class rc ON rc.oid = con.confrelid
      WHERE con.contype = 'f'
      ORDER BY con.conname`,
  );
  const { rows: pks } = await conn.query<PkRow>(
    `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
      ORDER BY kcu.ordinal_position`,
  );
  // Secondary indexes this driver can author — over real columns, any access method (btree/gin/gist/
  // brin/hash), UNIQUE or not, optionally PARTIAL (indpred). Excludes the PK's implicit index and
  // EXPRESSION indexes (indexprs) — the driver can't author an index on an expression yet, so reading
  // one back would phantom-REMOVE. `am.amname` is the method; `pg_get_expr(indpred)` is the partial
  // predicate (excluded from the index kind's `canonical`, since pg rewrites it). Required so the
  // `index` kind ROUND-TRIPS (the registry diffs by canonical; an un-introspected index phantom-adds).
  const { rows: idxs } = await conn.query<IdxRow>(
    `SELECT t.relname AS table_name, i.relname AS index_name, a.attname AS column_name,
            ix.indisunique AS is_unique, am.amname AS method,
            pg_get_expr(ix.indpred, ix.indrelid) AS pred
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
       JOIN pg_index ix ON ix.indrelid = t.oid AND NOT ix.indisprimary
            AND ix.indexprs IS NULL
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_am am ON am.oid = i.relam
       JOIN LATERAL unnest(string_to_array(ix.indkey::text, ' ')::int[])
            WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE t.relkind = 'r'
      ORDER BY t.relname, i.relname, k.ord`,
  );

  // Split FKs: a single-column FK to the target's `id` rides the column as a `record` type (the inline
  // `s.references` form); composite or non-`id` FKs become explicit table-level `foreignKeys`.
  const singleIdFkBy = new Map<string, FkRow>();
  const explicitFkBy = new Map<string, PgForeignKey[]>();
  for (const f of fks) {
    if (
      f.cols.length === 1 &&
      f.ref_cols.length === 1 &&
      f.ref_cols[0] === "id"
    ) {
      singleIdFkBy.set(`${f.table_name}.${f.cols[0]}`, f);
    } else {
      const onDelete = fkAction(f.del);
      const onUpdate = fkAction(f.upd);
      const list = explicitFkBy.get(f.table_name) ?? [];
      list.push({
        name: f.name,
        columns: f.cols,
        refTable: f.ref_table,
        refColumns: f.ref_cols,
        ...(onDelete ? { onDelete } : {}),
        ...(onUpdate ? { onUpdate } : {}),
      });
      explicitFkBy.set(f.table_name, list);
    }
  }
  const pkBy = new Map<string, string[]>();
  for (const p of pks) {
    const list = pkBy.get(p.table_name) ?? [];
    list.push(p.column_name);
    pkBy.set(p.table_name, list);
  }
  // The `id` column per table (to tell the IMPLICIT id apart from an overridden one).
  const idColBy = new Map<string, ColRow>();
  for (const c of cols)
    if (c.column_name === "id") idColBy.set(c.table_name, c);
  // The implicit key is the EXACT `id text` PK pgEmit adds (no PK authored). A lone `id` PK whose
  // column was overridden — uuid / serial (identity) / bigint / etc. — is a real authored column that
  // must round-trip, so it is NOT implicit (kept as a column + recorded as the table's primaryKey).
  const isImplicit = (table: string) => {
    const pk = pkBy.get(table);
    if (!(pk?.length === 1 && pk[0] === "id")) return false;
    const id = idColBy.get(table);
    return !!id && id.data_type === "text" && id.is_identity !== "YES";
  };

  const seen = new Set<string>();
  const byTable = new Map<string, PortableField[]>();
  for (const c of cols) {
    if (skip.has(c.table_name)) continue;
    seen.add(c.table_name);
    if (c.column_name === "id" && isImplicit(c.table_name)) continue;
    const fk = singleIdFkBy.get(`${c.table_name}.${c.column_name}`);
    let type: PortableType = fk
      ? { t: "record", tables: [fk.ref_table] }
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
      const od = fkAction(fk.del);
      const ou = fkAction(fk.upd);
      if (od) ref.on_delete = od;
      if (ou) ref.on_update = ou;
      if (ref.on_delete !== undefined || ref.on_update !== undefined)
        pf.reference = ref;
    }
    const list = byTable.get(c.table_name) ?? [];
    list.push(pf);
    byTable.set(c.table_name, list);
  }

  // Group index rows -> PgIndexInfo[] per table (columns in index order, dedup by index name). Method +
  // partial predicate are per-index (repeated across its column rows) — set once.
  const idxBy = new Map<string, Map<string, PgIndexInfo>>();
  for (const r of idxs) {
    if (skip.has(r.table_name)) continue;
    const byName = idxBy.get(r.table_name) ?? new Map<string, PgIndexInfo>();
    const ix = byName.get(r.index_name) ?? {
      name: r.index_name,
      cols: [],
      unique: r.is_unique,
      ...(r.method && r.method !== "btree" ? { method: r.method } : {}),
      ...(r.pred ? { where: r.pred } : {}),
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
    const fks = explicitFkBy.get(name);
    if (fks && fks.length > 0) t.foreignKeys = fks;
    return t;
  });
}

/** Read native enum types (CREATE TYPE … AS ENUM) from pg_type/pg_enum -> `enum` kind objects. */
async function pgIntrospectEnums(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{ name: string; value: string }>(
    `SELECT t.typname AS name, e.enumlabel AS value
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
      ORDER BY t.typname, e.enumsortorder`,
  );
  const byName = new Map<string, string[]>();
  for (const r of rows) {
    if (exclude.has(r.name)) continue;
    const vals = byName.get(r.name) ?? [];
    vals.push(r.value);
    byName.set(r.name, vals);
  }
  return [...byName.entries()].map(([name, values]) =>
    enumPortable(name, values),
  );
}

/** Read views (CREATE VIEW) from pg_views -> `view` kind objects (definition is pg's rewritten form). */
async function pgIntrospectViews(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{ name: string; definition: string }>(
    `SELECT viewname AS name, definition
       FROM pg_views WHERE schemaname = 'public' ORDER BY viewname`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) => viewPortable(r.name, (r.definition ?? "").trim()));
}

/** Read materialized views (pg_matviews) -> `matview` kind objects (definition is pg's rewritten form). */
async function pgIntrospectMatViews(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{ name: string; definition: string }>(
    `SELECT matviewname AS name, definition
       FROM pg_matviews WHERE schemaname = 'public' ORDER BY matviewname`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) => matViewPortable(r.name, (r.definition ?? "").trim()));
}

/**
 * Read STANDALONE sequences (pg_sequences) -> `sequence` kind objects; values read as text (bigint-safe).
 * Excludes sequences OWNED BY a column — the implicit ones an `IDENTITY` / `serial` column auto-creates
 * (pg_depend deptype 'i'/'a') — which are table substrate, not standalone objects, so reading them back
 * would phantom-ADD a sequence next to every auto-increment column.
 */
async function pgIntrospectSequences(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{
    name: string;
    start: string;
    min: string;
    max: string;
    increment: string;
    cache: string;
    cycle: boolean;
  }>(
    `SELECT s.sequencename AS name, s.start_value::text AS start, s.min_value::text AS min,
            s.max_value::text AS max, s.increment_by::text AS increment,
            s.cache_size::text AS cache, s.cycle
       FROM pg_sequences s
       JOIN pg_class c ON c.relname = s.sequencename
       JOIN pg_namespace n ON n.oid = c.relnamespace
            AND n.nspname = s.schemaname AND n.nspname = 'public'
      WHERE c.relkind = 'S'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
           WHERE d.objid = c.oid AND d.deptype IN ('a', 'i') AND d.refobjsubid > 0)
      ORDER BY s.sequencename`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) =>
      sequencePortable(r.name, {
        start: r.start,
        min: r.min,
        max: r.max,
        increment: r.increment,
        cache: r.cache,
        cycle: r.cycle,
      }),
    );
}

/** Read domains (information_schema.domains + pg_type.typnotnull) -> `domain` kind objects. */
async function pgIntrospectDomains(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{
    name: string;
    data_type: string;
    char_len: number | null;
    num_precision: number | null;
    num_scale: number | null;
    not_null: boolean;
  }>(
    `SELECT t.typname AS name,
            d.data_type,
            d.character_maximum_length AS char_len,
            d.numeric_precision AS num_precision,
            d.numeric_scale AS num_scale,
            t.typnotnull AS not_null
       FROM information_schema.domains d
       JOIN pg_type t ON t.typname = d.domain_name
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
      WHERE d.domain_schema = 'public'
      ORDER BY t.typname`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) =>
      domainPortable(r.name, {
        baseType: introspectedDomainBaseType(r),
        ...(r.not_null ? { notNull: true } : {}),
      }),
    );
}

/** Reconstruct a domain's base type SQL from information_schema (length / precision-scale preserved). */
function introspectedDomainBaseType(r: {
  data_type: string;
  char_len: number | null;
  num_precision: number | null;
  num_scale: number | null;
}): string {
  if (r.char_len != null) return `${r.data_type}(${r.char_len})`;
  if (r.data_type === "numeric" && r.num_precision != null)
    return `numeric(${r.num_precision}, ${r.num_scale ?? 0})`;
  return r.data_type;
}

/**
 * Read installed extensions (pg_extension) -> `extension` kind objects. `plpgsql` is excluded: it's a
 * system default present in every database, so tracking it would phantom-diff every schema.
 */
async function pgIntrospectExtensions(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{ name: string }>(
    `SELECT extname AS name FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) => extensionPortable(r.name));
}

/**
 * Read user functions (pg_proc) -> `function` kind objects; excludes extension-owned functions
 * (pg_depend deptype 'e') and C/internal-language builtins. Reconstructs the signature/return/body so a
 * dropped function can be recreated on `down`.
 */
async function pgIntrospectFunctions(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{
    name: string;
    args: string;
    result: string;
    lang: string;
    body: string;
  }>(
    `SELECT p.proname AS name,
            pg_get_function_identity_arguments(p.oid) AS args,
            pg_get_function_result(p.oid) AS result,
            l.lanname AS lang,
            p.prosrc AS body
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
       JOIN pg_language l ON l.oid = p.prolang AND l.lanname IN ('sql', 'plpgsql')
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      ORDER BY p.proname`,
  );
  return rows
    .filter((r) => !exclude.has(r.name))
    .map((r) =>
      functionPortable(r.name, {
        args: r.args,
        returns: r.result,
        language: r.lang,
        body: r.body,
      }),
    );
}

/** Read user triggers (pg_trigger, excl. internal) -> `trigger` kind objects via pg_get_triggerdef. */
async function pgIntrospectTriggers(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{
    name: string;
    table: string;
    fn: string;
    def: string;
  }>(
    `SELECT t.tgname AS name, c.relname AS table, p.proname AS fn,
            pg_get_triggerdef(t.oid) AS def
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE NOT t.tgisinternal
      ORDER BY c.relname, t.tgname`,
  );
  return rows
    .filter((r) => !exclude.has(r.table))
    .map((r) => triggerPortable(r.name, r.table, r.fn, r.def));
}

/** Read RLS policies (pg_policies) -> `policy` kind objects. */
async function pgIntrospectPolicies(
  conn: PgConn,
  exclude: Set<string> = new Set(),
): Promise<PortableObject[]> {
  const { rows } = await conn.query<{
    name: string;
    table: string;
    permissive: string;
    roles: string[];
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    `SELECT policyname AS name, tablename AS table, permissive, roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`,
  );
  return rows
    .filter((r) => !exclude.has(r.table))
    .map((r) =>
      policyPortable(r.name, {
        table: r.table,
        command: r.cmd.toLowerCase() as
          | "all"
          | "select"
          | "insert"
          | "update"
          | "delete",
        ...(r.permissive === "RESTRICTIVE" ? { permissive: false } : {}),
        ...(r.roles ? { roles: r.roles } : {}),
        ...(r.qual != null ? { using: r.qual } : {}),
        ...(r.with_check != null ? { withCheck: r.with_check } : {}),
      }),
    );
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
  extension: ".sql",
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

  // Authoring -> kinded Definables. Tables: lower each to the driver's `PgTable` IR (./lower.ts) then
  // split into [table, ...index, ...constraint] (./kinds.ts splitTable). Standalone `defs`: native
  // `enum` types (defineEnum) + `view`s (defineView) become their kind objects. Core then runs
  // lowerSchema(registry, explode(...)).
  explode: (tables, defs): Definable[] => {
    const standalone = defs as unknown as Array<{ kind?: string }>;
    const of = <T>(kind: string) =>
      standalone.filter((d) => d?.kind === kind) as unknown as T[];
    return [
      ...splitTables(pgLower(tables as unknown as PgTableDef[])),
      ...of<PgExtensionDef>("extension").map((e) =>
        extensionPortable(e.name, {
          ...(e.schema !== undefined ? { schema: e.schema } : {}),
          ...(e.version !== undefined ? { version: e.version } : {}),
        }),
      ),
      ...of<PgEnumDef>("enum").map((e) => enumPortable(e.name, e.values)),
      ...of<PgDomainDef>("domain").map((d) =>
        domainPortable(d.name, {
          baseType: d.baseType,
          ...(d.notNull !== undefined ? { notNull: d.notNull } : {}),
          ...(d.default !== undefined ? { default: d.default } : {}),
          ...(d.check !== undefined ? { check: d.check } : {}),
        }),
      ),
      ...of<PgSequenceDef>("sequence").map((s) =>
        sequencePortable(s.name, {
          ...(s.start !== undefined ? { start: s.start } : {}),
          ...(s.increment !== undefined ? { increment: s.increment } : {}),
          ...(s.min !== undefined ? { min: s.min } : {}),
          ...(s.max !== undefined ? { max: s.max } : {}),
          ...(s.cache !== undefined ? { cache: s.cache } : {}),
          ...(s.cycle !== undefined ? { cycle: s.cycle } : {}),
        }),
      ),
      ...of<PgFunctionDef>("function").map((f) =>
        functionPortable(f.name, {
          args: f.args,
          returns: f.returns,
          language: f.language,
          body: f.body,
          ...(f.volatility !== undefined ? { volatility: f.volatility } : {}),
          ...(f.strict !== undefined ? { strict: f.strict } : {}),
          ...(f.replace !== undefined ? { replace: f.replace } : {}),
        }),
      ),
      ...of<PgViewDef>("view").map((v) => viewPortable(v.name, v.sql)),
      ...of<PgMatViewDef>("matview").map((v) => matViewPortable(v.name, v.sql)),
      ...of<PgTriggerDef>("trigger").map((t) =>
        triggerPortable(
          t.name,
          t.table,
          t.function,
          triggerDefSql(t.name, {
            table: t.table,
            timing: t.timing,
            events: t.events,
            fn: t.function,
            ...(t.forEach !== undefined ? { forEach: t.forEach } : {}),
            ...(t.when !== undefined ? { when: t.when } : {}),
            ...(t.args !== undefined ? { args: t.args } : {}),
          }),
        ),
      ),
      ...of<PgPolicyDef>("policy").map((p) =>
        policyPortable(p.name, {
          table: p.table,
          ...(p.command !== undefined ? { command: p.command } : {}),
          ...(p.roles !== undefined ? { roles: p.roles } : {}),
          ...(p.using !== undefined ? { using: p.using } : {}),
          ...(p.withCheck !== undefined ? { withCheck: p.withCheck } : {}),
          ...(p.permissive !== undefined ? { permissive: p.permissive } : {}),
        }),
      ),
    ];
  },

  // One pg_catalog/information_schema read -> ALL kind objects, canonicalized identically to lowering
  // (a clean apply round-trips to a zero diff) and complete (extension + enum + domain + sequence +
  // table + index + FK + function + view + matview + trigger + policy) so no phantom (view/matview/
  // function/trigger/policy use name-based `canonical` — see those kinds; plpgsql is excluded as a
  // system default).
  introspectAll: async (conn, exclude) => [
    ...(await pgIntrospectExtensions(conn, exclude)),
    ...(await pgIntrospectEnums(conn, exclude)),
    ...(await pgIntrospectDomains(conn, exclude)),
    ...(await pgIntrospectSequences(conn, exclude)),
    ...splitTables(await pgIntrospect(conn, exclude)),
    ...(await pgIntrospectFunctions(conn, exclude)),
    ...(await pgIntrospectViews(conn, exclude)),
    ...(await pgIntrospectMatViews(conn, exclude)),
    ...(await pgIntrospectTriggers(conn, exclude)),
    ...(await pgIntrospectPolicies(conn, exclude)),
  ],

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
    "database/seed/index.ts": INIT_SEED_TS,
    ".env.example": INIT_ENV,
  }),

  // `schemic new <kind> <name>` -> the starter authoring module for a new entity. pg's only
  // standalone definable is the `table`; indexes/FKs are authored INSIDE a table, so those kinds
  // throw with guidance. The CLI writes the returned text under registry.display(kind).folder.
  scaffoldEntity: (kind, name) => scaffoldPgEntity(kind, name),

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

const INIT_SEED_TS = `import { defineSeed } from "@schemic/postgres";

// Seed script — run with \`schemic seed\`. \`defineSeed\` types (db, ctx) for you (no imports of the
// connection/context types needed). This is a seed FOLDER: add more named seeds beside this file —
// \`schemic seed users\` runs ./users.ts (or 01-users.ts), \`schemic seed --all\` runs them in filename
// order, and bare \`schemic seed\` runs this index.ts. Load a supporting file (raw .sql, JSON, …) next
// to this seed with ctx.file(name), e.g. const schema = ctx.file("schema.sql").
export default defineSeed(async (db, ctx) => {
  // await db.query('INSERT INTO "user" ("id", "email", "name") VALUES ($1, $2, $3)', [id, email, name]);
});
`;

const INIT_ENV = `# A real Postgres server (uncomment to use instead of embedded PGlite):
# DATABASE_URL=postgres://user:pass@localhost:5432/app
`;

// --- `schemic new <kind> <name>` entity scaffolding ---------------------------------------------

/** A valid JS identifier from an entity name (snake_case kept; other separators -> camelCase; digit-led -> `_`). */
function toIdentifier(name: string): string {
  const camel = name.replace(
    /[^a-zA-Z0-9_$]+([a-zA-Z0-9])?/g,
    (_m, c?: string) => (c ? c.toUpperCase() : ""),
  );
  return /^[0-9]/.test(camel) ? `_${camel}` : camel || "entity";
}

/** A starter `defineTable` module for a new table — full templating: commented examples of every clause. */
function scaffoldTable(name: string): string {
  const ident = toIdentifier(name);
  return `import { defineTable, s, sqlExpr } from "@schemic/postgres";

// \`sc new table ${name}\` scaffolded this. Author your columns, then \`sc gen\`.
export const ${ident} = defineTable(${JSON.stringify(name)}, {
  // An implicit \`"id" text PRIMARY KEY\` is added unless you declare a PK below.
  name: s.text(),
  // email: s.varchar(255).$unique(),                              // -> UNIQUE INDEX
  // age: s.smallint().optional(),                                 // -> nullable column
  // status: s.text().$check("status in ('active', 'archived')"),  // -> CHECK constraint
  // owner: s.references("other_table", { onDelete: "cascade" }),  // -> FOREIGN KEY
  createdAt: s.timestamptz().$default(sqlExpr("now()")),
});
// Table-level options (chain onto defineTable(...) above):
//   .primaryKey("a", "b")   composite PK (drops the implicit id)
//   .check("age >= 0")      table-level CHECK
//   .index(["name"])        secondary index (add { unique: true } for UNIQUE)
`;
}

/**
 * Author a new entity module for `kind`. Postgres' only standalone definable is the `table`; indexes
 * and foreign keys are authored INSIDE a table (`.index([...])` / `s.references(...)`), so those kinds
 * throw with guidance rather than scaffolding a meaningless standalone file. Unknown kinds throw too.
 */
function scaffoldPgEntity(kind: string, name: string): string {
  switch (kind) {
    case "table":
      return scaffoldTable(name);
    case "index":
    case "constraint":
      throw new Error(
        `postgres: "${kind}" isn't a standalone entity — indexes and foreign keys are authored inside a table (defineTable(...).index([...]) / s.references(...)). Run \`sc new table <name>\`.`,
      );
    default:
      throw new Error(
        `postgres: unknown entity kind "${kind}" — pg scaffolds: table.`,
      );
  }
}

registerDriver(postgresDriver as Driver<unknown>);
