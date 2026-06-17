import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diff, ResolvedConfig } from "@schemic/core";
import {
  type Filter,
  listMigrations,
  loadDefs,
  parseFilter,
} from "@schemic/core";
import { escapeIdent, type Surreal } from "surrealdb";
import type { SurrealParams } from "../config";
import { type DefineStatement, overwriteStatement } from "../ddl";
import { normalizeDb } from "./struct";
import {
  type DbStructured,
  introspectStructured,
  type Snapshot,
  structuredSnapshot,
} from "./structure";
import { buildSnapshot, diffSnapshots } from "./surreal-diff";
import { filterSnapshot, filterStructured } from "./surreal-filter";

const SHADOW_DB = "__surreal_zod_shadow";
const SHADOW_MIG_DB = "__surreal_zod_shadow_mig";

// Apply order: tables, then fields, then indexes.
const RANK: Record<DefineStatement["kind"], number> = {
  function: 0, // db-level; defined first (tables/events may reference fn::…)
  table: 1,
  field: 2,
  index: 3,
  event: 4,
  access: 5, // db-level; defined last (SIGNUP/SIGNIN reference tables)
};
const byCreate = (a: DefineStatement, b: DefineStatement) =>
  RANK[a.kind] - RANK[b.kind];

/**
 * Read the live database into a snapshot of **canonical** DDL, skipping `exclude`d tables. Uses
 * `INFO … STRUCTURE` and rebuilds each object's DDL deterministically (see `structuredSnapshot`),
 * so equivalent schemas compare equal regardless of SurrealDB's formatting (e.g. union order).
 */
export async function introspect(
  db: Surreal,
  exclude: Set<string> = new Set(),
): Promise<Snapshot> {
  return structuredSnapshot(await introspectStructured(db, exclude));
}

/**
 * Apply `ddl` to a fresh scratch database, introspect it back to a canonical snapshot, then drop it
 * (restoring the original namespace/database). Normalizes a desired schema THROUGH SurrealDB so the
 * comparison is free of formatting noise. Used by both `diff --live` and `verify`.
 */
async function applyToShadow(
  db: Surreal,
  config: ResolvedConfig,
  shadowDb: string,
  ddl: string,
): Promise<Snapshot> {
  const { namespace, database } = config.params as unknown as SurrealParams;
  await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(shadowDb)};`);
  await db.query(`DEFINE DATABASE ${escapeIdent(shadowDb)};`);
  try {
    await db.use({ namespace, database: shadowDb });
    if (ddl) await db.query(`BEGIN;\n${ddl}\nCOMMIT;`);
    return await introspect(db);
  } finally {
    await db.use({ namespace, database });
    await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(shadowDb)};`);
  }
}

/**
 * Apply `ddl` to a fresh scratch database and return its STRUCTURED introspection (the Struct-IR
 * form, not the canonical-DDL snapshot), then drop it. Backs `diff --ts`'s desired (schema) side —
 * normalizing the schema THROUGH SurrealDB so it lands in the same form INFO returns for the live DB.
 */
export async function shadowStructured(
  db: Surreal,
  config: ResolvedConfig,
  ddl: string,
): Promise<DbStructured> {
  const { namespace, database } = config.params as unknown as SurrealParams;
  await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(SHADOW_DB)};`);
  await db.query(`DEFINE DATABASE ${escapeIdent(SHADOW_DB)};`);
  try {
    await db.use({ namespace, database: SHADOW_DB });
    if (ddl) await db.query(`BEGIN;\n${ddl}\nCOMMIT;`);
    return await introspectStructured(db);
  } finally {
    await db.use({ namespace, database });
    await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(SHADOW_DB)};`);
  }
}

/**
 * The two sides of `diff --ts --live` as normalized Struct-IR: the live database (`current`) and
 * the declared schema (`desired`, normalized THROUGH SurrealDB via a shadow apply). Both go through
 * the same normalize, so an unchanged schema yields deep-equal structs. The caller renders them.
 */
export async function tsStructsAgainstDb(
  db: Surreal,
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
): Promise<{ current: DbStructured; desired: DbStructured }> {
  const exclude = new Set([
    config.migrationsTable,
    `${config.migrationsTable}_lock`,
  ]);
  const target = await introspectStructured(db, exclude);
  const { tables, defs } = await loadDefs(config.schemaPath);
  const ddl = Object.values(buildSnapshot(tables, defs).statements)
    .sort(byCreate)
    .map((s) => s.ddl)
    .join("\n");
  const desired = await shadowStructured(db, config, ddl);
  const norm = (d: DbStructured) => normalizeDb(filterStructured(d, filter));
  return { current: norm(target), desired: norm(desired) };
}

/**
 * Replay every migration (direction `up`) from zero into a fresh scratch database, introspect the
 * result, then drop it. Surfaces the offending migration if one fails to apply.
 */
async function replayMigrations(
  db: Surreal,
  config: ResolvedConfig,
  shadowDb: string,
  onApply?: (tag: string) => void,
): Promise<Snapshot> {
  const { namespace, database } = config.params as unknown as SurrealParams;
  await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(shadowDb)};`);
  await db.query(`DEFINE DATABASE ${escapeIdent(shadowDb)};`);
  try {
    await db.use({ namespace, database: shadowDb });
    for (const m of listMigrations(config.migrationsDir)) {
      onApply?.(m.tag);
      const sql = readFileSync(join(config.migrationsDir, m.file), "utf8");
      try {
        await db.query(sql, { direction: "up" });
      } catch (e) {
        throw new Error(
          `migration ${m.tag} failed to replay: ${(e as Error).message.split("\n")[0]}`,
        );
      }
    }
    return await introspect(db);
  } finally {
    await db.use({ namespace, database });
    await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(shadowDb)};`);
  }
}

/**
 * Verify that replaying every migration from zero reconstructs the declared schema — the only check
 * that catches "the sum of the migrations no longer equals the schema" (a hand-edited migration, or
 * a schema change someone forgot to `schemic gen`). Replays the migrations into one scratch DB and applies
 * the current schema into another, then diffs the two introspected snapshots; since BOTH sides are
 * normalized through SurrealDB (`INFO`), only genuine drift shows up. An empty diff means they agree.
 * `up` is what the migrations are missing relative to the schema. Needs root/namespace auth.
 */
export async function verifyMigrations(
  db: Surreal,
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
  onApply?: (tag: string) => void,
): Promise<Diff> {
  const migrated = await replayMigrations(db, config, SHADOW_MIG_DB, onApply);
  const { tables, defs } = await loadDefs(config.schemaPath);
  const ddl = Object.values(buildSnapshot(tables, defs).statements)
    .sort(byCreate)
    .map((s) => s.ddl)
    .join("\n");
  const desired = await applyToShadow(db, config, SHADOW_DB, ddl);
  return diffSnapshots(
    filterSnapshot(migrated, filter),
    filterSnapshot(desired, filter),
  );
}

/**
 * Diff the current schemas against the **live database**. Both sides are normalized through
 * SurrealDB — the target via `INFO`, the desired by applying the schema to a temporary shadow
 * database and reading IT back — so the comparison is free of formatting noise. The shadow
 * database is created and dropped in the target's namespace (needs root/namespace auth).
 */
export async function diffAgainstDb(
  db: Surreal,
  config: ResolvedConfig,
  filter: Filter = parseFilter({}),
): Promise<Diff> {
  // Exclude the CLI's own bookkeeping tables — they're not part of the schema (pull excludes
  // them too); otherwise `diff --live`/`sync` always report dropping `_migrations_lock`.
  const target = await introspect(
    db,
    new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
  );

  const { tables, defs } = await loadDefs(config.schemaPath);
  const schema = buildSnapshot(tables, defs);
  const ddl = Object.values(schema.statements)
    .sort(byCreate)
    .map((s) => s.ddl)
    .join("\n");
  const desired = await applyToShadow(db, config, SHADOW_DB, ddl);

  // up = statements that would bring the live database in line with the schema. The filter drops
  // both sides' excluded kinds (access is off by default) so they're neither applied nor pruned.
  const diff = diffSnapshots(
    filterSnapshot(target, filter),
    filterSnapshot(desired, filter),
  );

  // Access is COMPARED via its canonical form (the signing key is redacted identically on both
  // sides, so no false diff), but that form can't be APPLIED — the redacted KEY is gone. Swap in
  // the schema's emit DDL (which carries the key) for any DEFINE ACCESS in the apply plan.
  const accessEmit = new Map<string, string>();
  for (const s of Object.values(schema.statements))
    if (s.kind === "access") accessEmit.set(s.name, s.ddl);
  if (accessEmit.size) {
    const swap = (stmt: string): string => {
      const m = /^DEFINE ACCESS (OVERWRITE )?(\S+)/.exec(stmt);
      const emit = m && accessEmit.get(m[2]);
      return emit ? (m[1] ? overwriteStatement(emit) : emit) : stmt;
    };
    diff.up = diff.up.map(swap);
  }

  // Implicit-wildcard fields (the `.*` element of an `array<object>`/`set<object>`, etc.) are
  // auto-created when their parent field is defined, so the emitter marks them `DEFINE FIELD
  // OVERWRITE`. The INFO-canonical diff form drops that OVERWRITE, so applying it to the live DB
  // fails "already exists" and aborts the whole `push`/`sync` transaction. Re-mark exactly those
  // fields OVERWRITE in the apply plan — the comparison form above is untouched.
  const untick = (s: string) => s.replace(/`/g, "");
  const overwriteFields = new Set<string>();
  for (const s of Object.values(schema.statements))
    if (
      s.kind === "field" &&
      s.table &&
      /^DEFINE FIELD OVERWRITE\b/.test(s.ddl)
    )
      overwriteFields.add(`${s.table} ${untick(s.name)}`);
  if (overwriteFields.size) {
    const fieldRef =
      /^DEFINE FIELD (?:OVERWRITE |IF NOT EXISTS )?(`[^`]+`|\S+) ON TABLE (`[^`]+`|\S+)/;
    diff.up = diff.up.map((stmt) => {
      const m = fieldRef.exec(stmt);
      return m && overwriteFields.has(`${untick(m[2])} ${untick(m[1])}`)
        ? overwriteStatement(stmt)
        : stmt;
    });
  }
  return diff;
}

/**
 * The statements that would reconcile the live database with the schema (the `diff --live`
 * forward changes). With `prune: false`, drops (`REMOVE`) are excluded so existing extras
 * are kept. Run through `applyStatements` to apply.
 */
export function syncPlan(diff: Diff, prune?: boolean): string[] {
  return prune === false
    ? diff.up.filter((s) => !s.startsWith("REMOVE"))
    : diff.up;
}

/** Apply a set of statements to the database in a single transaction. */
export async function applyStatements(
  db: Surreal,
  stmts: string[],
): Promise<void> {
  if (stmts.length) await db.query(`BEGIN;\n${stmts.join("\n")}\nCOMMIT;`);
}
