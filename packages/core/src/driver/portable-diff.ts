// The driver-layer, DIALECT-FREE diff over the portable IR (see docs/MULTI-DB-SPIKE.md). It speaks
// only the portable IR + the Driver interface, so it works for any driver: emit both sides through
// the driver, key each statement by `kind:table:name`, compare per object (added / changed /
// removed), then turn that into executable up/down DDL and human-display items via the driver's
// change-vocabulary (`emit`/`remove`/`overwrite`).
//
// Lives in the driver layer (not cli/) because it is the generic engine a non-surreal driver's
// `diff()` is built from — the cli/ command wrapper re-exports these for the `sz diff --driver` path.

// NOTE: `Diff`/`DiffItem` currently live in cli/diff.ts (a type-only import — erased at compile, so
// no runtime cli->driver coupling). They migrate to a neutral home in the physical-extraction phase.
import type { Diff, DiffItem } from "../cli/diff";
import type { Driver, Statement } from "./driver";
import type { PortableDb } from "./portable-ir";

/** Statement identity for structural comparison — `kind:table:name` (matches the Surreal diff). */
export const keyOf = (s: Statement) => `${s.kind}:${s.table ?? ""}:${s.name}`;

/** The owning object of a statement (a table name, or the object's own name for db-level objects). */
const tableOf = (s: Statement) => s.table ?? s.name;

export type PortableDiffItem =
  | { op: "add"; key: string; stmt: Statement }
  | { op: "change"; key: string; before: Statement; after: Statement }
  | { op: "remove"; key: string; stmt: Statement };

/**
 * A driver-neutral STRUCTURAL diff: emit both sides through the driver, key each statement by
 * `kind:table:name`, and compare per object — added / changed / removed. Dialect-free; works for any
 * driver. Items carry the full {@link Statement} so {@link planPortable} can turn them into up/down.
 */
export function diffPortable(
  driver: Driver<unknown>,
  current: PortableDb,
  desired: PortableDb,
): PortableDiffItem[] {
  const index = (db: PortableDb) => {
    const m = new Map<string, Statement>();
    for (const s of driver.emit(driver.normalize(db))) m.set(keyOf(s), s);
    return m;
  };
  const cur = index(current);
  const des = index(desired);
  const items: PortableDiffItem[] = [];
  for (const [key, stmt] of des) {
    const before = cur.get(key);
    if (before === undefined) items.push({ op: "add", key, stmt });
    else if (before.ddl !== stmt.ddl)
      items.push({ op: "change", key, before, after: stmt });
  }
  for (const [key, stmt] of cur) {
    if (!des.has(key)) items.push({ op: "remove", key, stmt });
  }
  return items;
}

/**
 * Turn a structural diff into executable `up`/`down` DDL via the driver's change-vocabulary:
 * add -> create up / drop down; remove -> drop up / recreate down; change -> overwrite both ways.
 */
export function planPortable(
  driver: Driver<unknown>,
  items: PortableDiffItem[],
): { up: string[]; down: string[] } {
  const up: string[] = [];
  const down: string[] = [];
  for (const it of items) {
    if (it.op === "add") {
      up.push(it.stmt.ddl);
      down.push(driver.remove(it.stmt));
    } else if (it.op === "remove") {
      up.push(driver.remove(it.stmt));
      down.push(it.stmt.ddl);
    } else {
      up.push(driver.overwrite(it.after));
      down.push(driver.overwrite(it.before));
    }
  }
  return { up, down };
}

/** Map structural items to display {@link DiffItem}s (source-file linkage is attached by the caller). */
export function toDiffItems(
  driver: Driver<unknown>,
  items: PortableDiffItem[],
): DiffItem[] {
  return items.map((it) => {
    if (it.op === "add")
      return {
        op: "add",
        key: it.key,
        kind: it.stmt.kind,
        table: tableOf(it.stmt),
        ddl: it.stmt.ddl,
      };
    if (it.op === "remove")
      return {
        op: "remove",
        key: it.key,
        kind: it.stmt.kind,
        table: tableOf(it.stmt),
        ddl: driver.remove(it.stmt),
        old: it.stmt.ddl,
      };
    return {
      op: "change",
      key: it.key,
      kind: it.after.kind,
      table: tableOf(it.after),
      before: it.before.ddl,
      after: it.after.ddl,
    };
  });
}

/**
 * The full {@link Diff} for a non-surreal driver: structural diff -> up/down DDL + display items +
 * the whole desired schema (for `--full`). This is what such a driver's `Driver.diff` returns.
 */
export function buildDiff(
  driver: Driver<unknown>,
  prev: PortableDb,
  next: PortableDb,
): Diff {
  const items = diffPortable(driver, prev, next);
  const { up, down } = planPortable(driver, items);
  const full = driver.emit(driver.normalize(next)).map((s) => ({
    key: keyOf(s),
    table: tableOf(s),
    ddl: s.ddl,
  }));
  return { up, down, items: toDiffItems(driver, items), full };
}
