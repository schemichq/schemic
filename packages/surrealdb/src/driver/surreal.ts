// The SURREAL driver — a SET OF KINDS on the core-v2 registry (see docs/kind-registry-flip-plan.md).
//
// Everything dialect-specific lives here: the kind `registry` (table/index/event/function/access), the
// authoring -> kinded `explode`, the single-read `introspectAll`, the connection lifecycle, and the
// SurrealDB command capabilities. Core orchestrates schema ops (lower/diff/emit/order) GENERICALLY over
// `registry` — it never names a kind. The Struct-IR (`DbStructured`) + `diffSnapshots` stay the driver's
// INTERNAL clause-level engine (the kinds delegate to them); the field/type substrate stays core.

import type {
  ApplyOptions,
  ConnectionOverrides as CfgOverrides,
  ConnectionOverrides,
  Definable,
  Diff,
  Driver,
  Filter,
  MigrationRecord,
  MigrationStore,
  PortableObject,
  PullPlan,
  RenderedUnit,
  ResolvedConfig,
  ShadowCapability,
} from "@schemic/core";
import { registerDriver } from "@schemic/core";
import { escapeIdent, type Surreal } from "surrealdb";
import {
  connectEmbedded,
  spawnEphemeralServer,
  surrealBinaryAvailable,
} from "../cli/engine";
import {
  applyStatements,
  diffAgainstDb,
  shadowStructured,
  syncPlan,
  tsStructsAgainstDb,
  verifyMigrations,
} from "../cli/introspect";
import { planPull, renderPerFile, renderSchemaToTS } from "../cli/pull";
import { initScaffold } from "../cli/scaffold";
import { normalizeDb } from "../cli/struct";
import type { DbStructured } from "../cli/structure";
import { connect as surrealConnect } from "../cli/surreal-connect";
import { renderMigration } from "../cli/surreal-diff";
import { filterStructured } from "../cli/surreal-filter";
import type { SurrealParams } from "../config";
import {
  explodeSchema,
  fromStructured,
  introspectAll as introspectAllKinds,
  toStructured,
} from "../kinds/explode";
import type { SurrealPortable } from "../kinds/portable";
import { surrealKinds } from "../kinds/registry";
import type { Shape, StandaloneDef, TableDef } from "../pure";

const shadow: ShadowCapability<Surreal> = {
  // Apply DDL to a throwaway database, read it back via INFO STRUCTURE, drop it — the live-side
  // canonicalizer. Delegates to `shadowStructured`, then to per-kind portable objects (== lowering).
  roundTrip: async (conn, config, ddl) =>
    fromStructured(normalizeDb(await shadowStructured(conn, config, ddl))),
  // `ephemeral` (full isolated instance for `sz check` replay) is intentionally not wired here —
  // `check` still uses its existing path. A later milestone routes it through this capability.
};

// --- migration bookkeeping (the apply-time SurrealQL, moved behind the driver) -------------------

/** Record one applied migration: a `_migrations` row keyed by tag, with file + checksum + time. */
const RECORD_SQL =
  "CREATE type::record($tbl, $tag) CONTENT { tag: $tag, file: $file, checksum: $sum, applied_at: time::now() }";
const recordVars = (table: string, r: MigrationRecord) => ({
  tbl: table,
  tag: r.tag,
  file: r.file,
  sum: r.checksum,
});

/** `DEFINE TABLE … SCHEMALESS` for an internal tracking table (migrations or its lock). */
async function ensureTrackTable(conn: Surreal, table: string): Promise<void> {
  await conn.query(
    `DEFINE TABLE IF NOT EXISTS ${escapeIdent(table)} TYPE NORMAL SCHEMALESS PERMISSIONS NONE;`,
  );
}

const lockTableOf = (table: string) => `${table}_lock`;

const migrations: MigrationStore<Surreal> = {
  render: (tag, diff) => renderMigration(tag, diff),
  ensure: ensureTrackTable,

  async applied(conn, table) {
    const [rows] = await conn.query<[{ tag: string; checksum: string }[]]>(
      "SELECT tag, checksum FROM type::table($tbl)",
      { tbl: table },
    );
    return new Map((rows ?? []).map((r) => [r.tag, r.checksum]));
  },

  // SurrealDB is natively transactional — run the migration program + its bookkeeping write in one
  // BEGIN/COMMIT so the record is written iff the DDL applied. `$direction` drives the up/down branch.
  async apply(conn, table, { content, direction, record }) {
    const bookkeep =
      direction === "up"
        ? { sql: RECORD_SQL, vars: recordVars(table, record) }
        : {
            sql: "DELETE type::record($tbl, $tag)",
            vars: { tbl: table, tag: record.tag },
          };
    await conn.query(`BEGIN;\n${content}\n${bookkeep.sql};\nCOMMIT;`, {
      direction,
      ...bookkeep.vars,
    });
  },

  async record(conn, table, record) {
    await ensureTrackTable(conn, table);
    await conn.query(RECORD_SQL, recordVars(table, record));
  },

  async clear(conn, table) {
    await conn.query("DELETE type::table($tbl)", { tbl: table });
  },

  async lock(conn, table) {
    const tbl = lockTableOf(table);
    await ensureTrackTable(conn, tbl);
    try {
      await conn.query(
        "CREATE type::record($tbl, 'lock') CONTENT { at: time::now() }",
        { tbl },
      );
    } catch {
      throw new Error(
        "Migrations are locked — another run is in progress. If it's stale, run `schemic unlock`.",
      );
    }
  },

  async unlock(conn, table) {
    await conn.query("DELETE type::record($tbl, 'lock')", {
      tbl: lockTableOf(table),
    });
  },
};

/**
 * Render a structured schema to per-file source: one combined module under `single`, else one file
 * per object via `fileFor`. Shared by `renderSchema` (offline `diff --ts`) and `diffTsLive`.
 */
function renderFiles(
  struct: DbStructured,
  fileFor: (kind: string, name: string) => string,
  single?: string,
): Map<string, string> {
  return single
    ? new Map([[single, renderSchemaToTS(struct)]])
    : renderPerFile(
        struct,
        fileFor as (kind: RenderedUnit["kind"], name: string) => string,
      );
}

export const surrealDriver: Driver<
  Surreal,
  TableDef<string, Shape>,
  StandaloneDef
> = {
  name: "surrealdb",
  registry: surrealKinds,

  // --- kind registry (the schema engine) -----------------------------------------------------
  // Authoring -> kinded definables (the driver-side explode: one inline-authored table fans out into
  // [table, ...index, ...event], db-level functions/accesses alongside). Core lowers via
  // `lowerSchema(registry, explode(...))`, then diffs/emits/orders GENERICALLY — it never names a kind.
  explode: (tables, defs) => explodeSchema(tables, defs),
  // Live DB -> all portable objects: ONE `INFO … STRUCTURE` read fanned per kind, canonicalized
  // IDENTICALLY to lowering (a clean apply round-trips to a zero diff) and complete (every kind).
  introspectAll: (conn, exclude) => introspectAllKinds(conn, exclude),

  // --- execution -----------------------------------------------------------------------------

  connect(
    config: ResolvedConfig,
    over?: ConnectionOverrides,
  ): Promise<Surreal> {
    // The driver's portable `ConnectionOverrides` is a structural superset of the SDK's; the only
    // soft field is `authLevel` (a string here vs. the SDK's `AuthLevel` union) — pass it through.
    return surrealConnect(config, (over ?? {}) as CfgOverrides);
  },

  async apply(
    conn: Surreal,
    statements: string[],
    opts?: ApplyOptions,
  ): Promise<void> {
    if (!statements.length) return;
    if (opts?.transactional === false) {
      for (const s of statements) await conn.query(s);
      return;
    }
    // SurrealDB is natively transactional — one BEGIN/COMMIT around the batch (matches applyStatements).
    await applyStatements(conn, statements);
  },

  async close(conn: Surreal): Promise<void> {
    await conn.close();
  },

  /**
   * Raw READ query -> rows, for connection resolvers (`ctx.connections.<name>.query(...)`) and seed.
   * SurrealQL returns one result per statement; we hand back the LAST statement's rows (the payload of
   * a `… ; SELECT …` resolver), wrapping a scalar/`RETURN` result and treating none as an empty set.
   */
  async query<T = unknown>(
    conn: Surreal,
    sql: string,
    vars?: Record<string, unknown>,
  ): Promise<T[]> {
    const results = (await conn.query(sql, vars)) as unknown[];
    if (!results.length) return [];
    const last = results[results.length - 1];
    return (Array.isArray(last) ? last : last == null ? [] : [last]) as T[];
  },

  shadow,
  migrations,

  // --- command capabilities (thin adapters over the existing surreal cli functions) ----------

  diffLive: (conn, config, filter) => diffAgainstDb(conn, config, filter),
  syncPlan: (diff, prune) => syncPlan(diff, prune),

  // Offline `diff --ts` / `pull`: reconstruct the structured form from the portable objects (no DDL
  // re-parse — the normalized struct rides on them), filter, render to per-file `s.*` source.
  renderSchema(objects, filter, fileFor, single) {
    return renderFiles(
      filterStructured(toStructured(objects as SurrealPortable[]), filter),
      fileFor,
      single,
    );
  },

  // Live `diff --ts`: both sides normalized through SurrealDB, then rendered per file.
  async diffTsLive(conn, config, filter, fileFor, single) {
    const { current, desired } = await tsStructsAgainstDb(conn, config, filter);
    return {
      current: renderFiles(current, fileFor, single),
      desired: renderFiles(desired, fileFor, single),
    };
  },

  planPull: (conn, config, opts) => planPull(conn, config, opts),

  async serverInfo(conn) {
    let v = "unknown";
    try {
      v = (await conn.version()).version;
    } catch {
      // server version unavailable
    }
    return `SurrealDB ${v}`;
  },

  // The files `schemic init` scaffolds for a fresh SurrealDB project (connections-only config + sample
  // s.* schema + seed + .env.example); the CLI writes them and adds the neutral migration snapshot.
  initScaffold,

  // `check`: replay every migration into a throwaway engine and diff the result against the schema.
  // Owns ephemeral-engine selection — an embedded @surrealdb/node instance, an ephemeral server from
  // the local `surreal` binary, or a configured scratch server — and the replay never touches the
  // real database. Progress lines go to `log`; the empty/non-empty diff is reported by the caller.
  async checkReplay(config, over, filter, log) {
    const params = config.params as unknown as SurrealParams;
    const check = params.check;
    const engine = check?.engine ?? "auto";
    const useBinary =
      engine === "binary" ||
      (engine === "auto" && surrealBinaryAvailable(check?.binary));
    if (engine === "binary" && !useBinary) {
      throw new Error(
        'check.engine "binary" needs the `surreal` CLI on PATH (or set `check.binary`). Run `schemic check --schema` to skip the replay.',
      );
    }

    let db: Surreal;
    let checkCfg: ResolvedConfig;
    let cleanup: () => Promise<void>;
    if (typeof engine === "object") {
      const embedded = await connectEmbedded(engine, "check", "check");
      db = embedded.db;
      checkCfg = {
        ...config,
        params: {
          url: embedded.url,
          namespace: "check",
          database: "check",
          authLevel: "root",
        } satisfies SurrealParams,
      };
      cleanup = embedded.stop;
      log(
        `  replaying on an ${embedded.url} SurrealDB (@surrealdb/node) — no server, your data untouched`,
      );
    } else if (useBinary) {
      const server = await spawnEphemeralServer(check?.binary);
      checkCfg = {
        ...config,
        params: {
          url: server.url,
          namespace: "check",
          database: "check",
          username: server.username,
          password: server.password,
          authLevel: "root",
        } satisfies SurrealParams,
      };
      db = await surrealConnect(checkCfg, {});
      cleanup = async () => {
        await db.close().catch(() => {});
        await server.stop();
      };
      log(
        "  replaying on an ephemeral in-memory SurrealDB (local `surreal` binary) — your server is untouched",
      );
    } else {
      // Scratch connection for the `remote` engine: check.db merged over the connection's own params.
      const remote: SurrealParams = { ...params, ...(check?.db ?? {}) };
      checkCfg = {
        ...config,
        params: remote as unknown as Record<string, unknown>,
      };
      try {
        db = await surrealConnect(checkCfg, over as CfgOverrides);
      } catch (e) {
        throw new Error(
          `${e instanceof Error ? e.message : String(e)}\n  (run \`schemic check --schema\` to skip the replay, install the \`surreal\` CLI for an in-memory engine, or set \`check.db\` to point the replay at a scratch server)`,
        );
      }
      cleanup = async () => {
        await db.close().catch(() => {});
      };
      log(
        `  replaying on ${remote.url} (${remote.namespace}) — isolated scratch databases; your data is untouched`,
      );
    }

    try {
      return await verifyMigrations(db, checkCfg, filter, (tag) =>
        log(`  ${tag}`),
      );
    } finally {
      await cleanup();
    }
  },
};

registerDriver(surrealDriver as Driver<unknown>);
