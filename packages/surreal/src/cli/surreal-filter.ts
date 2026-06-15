// The SurrealDB STATEMENT/STRUCT filters — the dialect halves of the per-kind object filter. They
// operate on `DefineStatement`/`Snapshot` (the statement engine) and `DbStructured` (introspection).
// The dialect-free `Filter` definition + the portable-IR filters live in `./filter`. In the package
// split this module moves to `@schemic/surreal` (see docs/MULTI-DB-SPIKE.md).

import type { DefineStatement } from "../ddl";
import { type Filter, inCat } from "@schemic/core";
import type { DbStructured, Snapshot } from "./structure";

/** Whether a `DefineStatement` passes the filter (table-scoped objects also need their table in). */
export function included(f: Filter, s: DefineStatement): boolean {
  const table = s.table ?? s.name;
  switch (s.kind) {
    case "table":
    case "field":
    case "index":
      return inCat(f.tables, table);
    case "event":
      return inCat(f.tables, table) && inCat(f.events, s.name);
    case "function":
      return inCat(f.functions, s.name);
    case "access":
      return inCat(f.access, s.name);
  }
}

/** Keep only the snapshot statements that pass the filter (for `diff`/`sync`/`generate`). */
export function filterSnapshot(snap: Snapshot, f: Filter): Snapshot {
  const statements: Record<string, DefineStatement> = {};
  for (const [k, s] of Object.entries(snap.statements))
    if (included(f, s)) statements[k] = s;
  return { ...snap, statements };
}

/**
 * The snapshot to persist after a filtered `generate`: included kinds take their new state from
 * `next`, excluded kinds keep their prior state from `prev`. So generating without `--access`
 * leaves the snapshot's access untouched (no phantom add/remove) rather than dropping it.
 */
export function mergeSnapshot(
  prev: Snapshot,
  next: Snapshot,
  f: Filter,
): Snapshot {
  const statements: Record<string, DefineStatement> = {};
  for (const [k, s] of Object.entries(prev.statements))
    if (!included(f, s)) statements[k] = s;
  for (const [k, s] of Object.entries(next.statements))
    if (included(f, s)) statements[k] = s;
  return { ...next, statements };
}

/** Keep only the introspected objects that pass the filter (for `pull`). */
export function filterStructured(db: DbStructured, f: Filter): DbStructured {
  const tables = db.tables
    .filter((t) => inCat(f.tables, t.name))
    .map((t) => ({
      ...t,
      events: t.events.filter((e) => inCat(f.events, e.name)),
    }));
  const functions = db.functions.filter((fn) => inCat(f.functions, fn.name));
  const accesses = db.accesses.filter((a) => inCat(f.access, a.name));
  return { tables, functions, accesses };
}
