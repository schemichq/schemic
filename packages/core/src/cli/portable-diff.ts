// The driver-PARAMETRIC diff path (multi-DB spike — see docs/MULTI-DB-SPIKE.md). When `config.driver`
// (or `sz diff --driver <name>`) names a non-surreal driver, the diff command routes here instead of
// the SurrealQL snapshot pipeline. It speaks only the portable IR + the Driver interface, so it is
// dialect-free: author with `sz.*` (lowered + lifted to the portable IR), introspect the target DB
// through its driver, compare with the driver's structured equality, and show the DDL gap.
//
// SCOPE: this is the spike's proof that the CLI can drive a second database end-to-end. It does NOT
// replace the full snapshot/migration-file pipeline (that stays Surreal-only until the engine-wide
// kind->PortableType swap graduates from spike to implementation).

import { getDriver } from "../driver";
import type { PortableDb } from "../driver/portable-ir";
import { surrealDriver } from "../driver/surreal";
import type { ResolvedConfig } from "./config";
import { loadDefs } from "./schema";
import { ok, plural, style } from "./style";

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
  const desired: PortableDb = surrealDriver.lower(tables, defs);

  // Live = the target database, introspected through its own driver, then both sides normalized by
  // the target (which PROJECTS the portable IR onto what that DB can represent).
  const conn = (await driver.connect(config)) as Conn;
  let live: PortableDb;
  try {
    live = await driver.introspect(conn as never);
  } finally {
    await closeQuietly(conn);
  }

  const inSync = driver.equal(desired, live);
  const upStatements = inSync
    ? []
    : driver.emit(driver.normalize(desired)).map((s) => s.ddl);

  if (opts.json) {
    console.log(
      JSON.stringify({ driver: driverName, inSync, up: upStatements }),
    );
    return;
  }

  console.log(style.dim(`  driver: ${driverName}`));
  if (inSync) {
    console.log(ok("Schema is in sync with the target database."));
    return;
  }
  console.log(
    `${plural(upStatements.length, "statement")} to reach the declared schema:\n`,
  );
  for (const ddl of upStatements) {
    console.log(style.green(ddl.includes("\n") ? ddl : `  ${ddl}`));
  }
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
