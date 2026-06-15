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
// The dialect-free diff engine now lives in the driver layer; re-export so existing CLI/test
// imports (`diffPortable`/`planPortable`) keep resolving here.
import {
  diffPortable,
  type PortableDiffItem,
  planPortable,
} from "../driver/portable-diff";
import type { PortableDb } from "../driver/portable-ir";
import { surrealDriver } from "../driver/surreal";
import type { ResolvedConfig } from "./config";
import { loadDefs } from "./schema";
import { ok, plural, style } from "./style";

export type { PortableDiffItem } from "../driver/portable-diff";
export { diffPortable, planPortable } from "../driver/portable-diff";

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

  const items = diffPortable(driver, live, desired);
  const { up, down } = planPortable(driver, items);

  if (opts.json) {
    console.log(JSON.stringify({ driver: driverName, up, down }));
    return;
  }

  console.log(style.dim(`  driver: ${driverName}`));
  if (!items.length) {
    console.log(ok("Schema is in sync with the target database."));
    return;
  }
  const line = (s: string) => (s.includes("\n") ? s : `  ${s}`);
  for (const it of items) {
    if (it.op === "add") console.log(style.green(`+ ${line(it.stmt.ddl)}`));
    else if (it.op === "remove")
      console.log(style.red(`- ${line(driver.remove(it.stmt))}`));
    else console.log(style.yellow(`~ ${line(it.after.ddl)}`));
  }
  const n = (op: PortableDiffItem["op"]) =>
    items.filter((i) => i.op === op).length;
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
