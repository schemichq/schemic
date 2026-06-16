// The driver-PARAMETRIC diff path (multi-DB spike — see docs/MULTI-DB-SPIKE.md). When `config.driver`
// (or `sz diff --driver <name>`) names a non-surreal driver, the diff command routes here instead of
// the SurrealQL snapshot pipeline. It speaks only the portable IR + the Driver interface, so it is
// dialect-free: author with `sz.*` (lowered + lifted to the portable IR), introspect the target DB
// through its driver, compare with the driver's structured equality, and show the DDL gap.
//
// SCOPE: this is the spike's proof that the CLI can drive a second database end-to-end. It does NOT
// replace the full snapshot/migration-file pipeline (that stays Surreal-only until the engine-wide
// kind->PortableType swap graduates from spike to implementation).

import type { PortableDb, ResolvedConfig } from "@schemic/core";
import {
  type DiffItem,
  formatItems,
  getDriver,
  loadDefs,
  ok,
  plural,
  style,
} from "@schemic/core";

// The dialect-free diff engine lives in the driver layer; re-export so existing CLI/test imports
// (`diffPortable`/`planPortable`) keep resolving here.
export type { PortableDiffItem } from "@schemic/core";
export { diffPortable, planPortable } from "@schemic/core";

/** A loaded, opaque driver connection (each driver's `connect` returns its own type). */
type Conn = unknown;

/**
 * Run `sz diff` against a non-surreal driver. Authoring is still the `sz.*` surface (lowered to the
 * portable IR via the Surreal authoring lowering); the TARGET driver owns emit/introspect/equal.
 */
export async function portableDiff(
  config: ResolvedConfig,
  driverName: string,
  opts: { json?: boolean } = {},
): Promise<void> {
  const driver = getDriver(driverName);

  // Desired = the declared schema, authored with sz.* and lifted to the portable IR.
  const { tables, defs } = await loadDefs(config.schemaPath);
  const desired: PortableDb = getDriver(config.driver ?? "surrealdb").lower(
    tables,
    defs,
  );

  // Live = the target database, introspected through its own driver, then both sides normalized by
  // the target (which PROJECTS the portable IR onto what that DB can represent).
  const conn = (await driver.connect(config)) as Conn;
  let live: PortableDb;
  try {
    // Exclude the migration bookkeeping tables (and their `_lock` companion) — they're CLI-owned, not
    // schema, so `diff` must not report them as "to remove". Same scoping as migrate's baseline read.
    live = await driver.introspect(
      conn as never,
      new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
    );
  } finally {
    await closeQuietly(conn);
  }

  // Route through the driver's own diff strategy (field-level where the driver supports it), so the
  // `diff --driver` display matches exactly what `gen`/`migrate` would emit for that database.
  const diff = driver.diff(live, desired);

  if (opts.json) {
    console.log(
      JSON.stringify({ driver: driverName, up: diff.up, down: diff.down }),
    );
    return;
  }

  console.log(style.dim(`  driver: ${driverName}`));
  if (!diff.up.length) {
    console.log(ok("Schema is in sync with the target database."));
    return;
  }
  const items = diff.items ?? [];
  console.log(formatItems(items));
  const n = (op: DiffItem["op"]) => items.filter((i) => i.op === op).length;
  console.log(
    style.dim(
      `\n${plural(items.length, "change")} — ${n("add")} added, ${n("change")} changed, ${n("remove")} removed.`,
    ),
  );
}

async function closeQuietly(conn: unknown): Promise<void> {
  const close = (conn as { close?: () => Promise<void> } | null)?.close;
  if (typeof close === "function") {
    try {
      await close.call(conn);
    } catch {
      // best-effort: a failed close shouldn't mask the diff result
    }
  }
}
