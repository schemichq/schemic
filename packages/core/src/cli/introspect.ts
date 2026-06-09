import type { DefineStatement } from "surreal-zod";
import { escapeIdent, type Surreal } from "surrealdb";
import type { ResolvedConfig } from "./config";
import { buildSnapshot, type Diff, diffSnapshots } from "./diff";
import type { Snapshot } from "./meta";
import { loadDefs } from "./schema";
import { introspectStructured, structuredSnapshot } from "./structure";

const SHADOW_DB = "__surreal_zod_shadow";

// Apply order: tables, then fields, then indexes.
const RANK: Record<DefineStatement["kind"], number> = {
  table: 0,
  field: 1,
  index: 2,
  event: 3,
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
 * Diff the current schemas against the **live database**. Both sides are normalized through
 * SurrealDB — the target via `INFO`, the desired by applying the schema to a temporary shadow
 * database and reading IT back — so the comparison is free of formatting noise. The shadow
 * database is created and dropped in the target's namespace (needs root/namespace auth).
 */
export async function diffAgainstDb(
  db: Surreal,
  config: ResolvedConfig,
): Promise<Diff> {
  const { namespace, database } = config.db;
  // Exclude the CLI's own bookkeeping tables — they're not part of the schema (pull excludes
  // them too); otherwise `diff --live`/`sync` always report dropping `_migrations_lock`.
  const target = await introspect(
    db,
    new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
  );

  const { tables, events } = await loadDefs(config.schemaPath);
  const ddl = Object.values(buildSnapshot(tables, events).statements)
    .sort(byCreate)
    .map((s) => s.ddl)
    .join("\n");

  await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(SHADOW_DB)};`);
  await db.query(`DEFINE DATABASE ${escapeIdent(SHADOW_DB)};`);
  let desired: Snapshot;
  try {
    await db.use({ namespace, database: SHADOW_DB });
    if (ddl) await db.query(`BEGIN;\n${ddl}\nCOMMIT;`);
    desired = await introspect(db);
  } finally {
    await db.use({ namespace, database });
    await db.query(`REMOVE DATABASE IF EXISTS ${escapeIdent(SHADOW_DB)};`);
  }

  // up = statements that would bring the live database in line with the schema.
  return diffSnapshots(target, desired);
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
