// The driver-PARAMETRIC diff path (multi-DB spike — see docs/MULTI-DB-SPIKE.md). When `config.driver`
// (or `sz diff --driver <name>`) names a non-surreal driver, the diff command routes here instead of
// the SurrealQL snapshot pipeline. It speaks only the portable IR + the Driver interface, so it is
// dialect-free: author with `sz.*` (lowered + lifted to the portable IR), introspect the target DB
// through its driver, compare with the driver's structured equality, and show the DDL gap.
//
// SCOPE: this is the spike's proof that the CLI can drive a second database end-to-end. It does NOT
// replace the full snapshot/migration-file pipeline (that stays Surreal-only until the engine-wide
// kind->PortableType swap graduates from spike to implementation).

import type { Statement } from "../driver";
import { getDriver } from "../driver";
import type { PortableDb } from "../driver/portable-ir";
import { surrealDriver } from "../driver/surreal";
import type { ResolvedConfig } from "./config";
import { loadDefs } from "./schema";
import { ok, plural, style } from "./style";

/** A loaded, opaque driver connection (each driver's `connect` returns its own type). */
type Conn = unknown;

/** Statement identity for structural comparison — `kind:table:name` (matches the Surreal diff). */
const keyOf = (s: Statement) => `${s.kind}:${s.table ?? ""}:${s.name}`;

export type PortableDiffItem =
  | { op: "add"; key: string; ddl: string }
  | { op: "change"; key: string; before: string; after: string }
  | { op: "remove"; key: string; ddl: string };

/**
 * A driver-neutral STRUCTURAL diff: emit both sides through the driver, key each statement by
 * `kind:table:name`, and compare per object — added / changed / removed. Dialect-free; works for any
 * driver. (Preview-level: `change`/`remove` show the desired/current DDL; turning these into ALTER/
 * DROP `up`/`down` is the next increment, once the Driver gains the change-vocabulary ops.)
 */
export function diffPortable(
  driver: ReturnType<typeof getDriver>,
  current: PortableDb,
  desired: PortableDb,
): PortableDiffItem[] {
  const index = (db: PortableDb) => {
    const m = new Map<string, string>();
    for (const s of driver.emit(driver.normalize(db))) m.set(keyOf(s), s.ddl);
    return m;
  };
  const cur = index(current);
  const des = index(desired);
  const items: PortableDiffItem[] = [];
  for (const [key, ddl] of des) {
    const before = cur.get(key);
    if (before === undefined) items.push({ op: "add", key, ddl });
    else if (before !== ddl)
      items.push({ op: "change", key, before, after: ddl });
  }
  for (const [key, ddl] of cur) {
    if (!des.has(key)) items.push({ op: "remove", key, ddl });
  }
  return items;
}

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

  if (opts.json) {
    console.log(JSON.stringify({ driver: driverName, items }));
    return;
  }

  console.log(style.dim(`  driver: ${driverName}`));
  if (!items.length) {
    console.log(ok("Schema is in sync with the target database."));
    return;
  }
  const line = (s: string) => (s.includes("\n") ? s : `  ${s}`);
  for (const it of items) {
    if (it.op === "add") console.log(style.green(`+ ${line(it.ddl)}`));
    else if (it.op === "remove") console.log(style.red(`- ${line(it.ddl)}`));
    else console.log(style.yellow(`~ ${line(it.after)}`));
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
