// The SurrealDB KIND REGISTRY (core-v2 slice 2, docs/kind-registry-contract.md): the per-driver
// registry + the `table`/`index`/`event` engines. Core orchestrates generically over this registry
// (lower -> diff -> order -> emit); each engine delegates to the EXISTING fixed-slot primitives, so the
// generic path is byte-exact with `surrealDriver.diff`:
//   - table.overwrite  -> `diffSnapshots` (the whole field + table-head ALTER engine, scoped to one table)
//   - index            -> recreate (the spine's remove+emit default == legacy `changeUp` for an index)
//   - event.overwrite  -> `overwriteStatement` (DEFINE EVENT OVERWRITE == legacy `changeUp` for an event)
//
// Registration ORDER is each kind's ordinal (the tie-break among independent objects): table (0) before
// index (1) before event (2). index/event point `deps`+`owner` at their table, so the graph emits them
// AFTER and clusters them next to it. Fields are NESTED in the table object (substrate, not a kind).
//
// NOTE (slice 2): the legacy `Driver.lower/emit/diff` path is UNTOUCHED and still production. This
// registry is built + parity-tested ALONGSIDE it; the wholesale flip (routing `Driver` + the `s.*`
// authoring `build` through here) lands once access/function/natives are migrated too.

import {
  type AnyTable,
  type AuthoredDef,
  type KindEngine,
  KindRegistry,
  lowerSchema,
  type PortableObject,
  type Ref,
} from "@schemic/core";
import type { Snapshot } from "../cli/structure";
import { diffSnapshots } from "../cli/surreal-diff";
import type { DefineStatement } from "../ddl";
import { overwriteStatement, removeStatement } from "../ddl";
import { explodeSchema } from "./explode";
import type { PEvent, PIndex, PTable } from "./portable";

/** Statement key matching the legacy engine's `keyOf` (`kind:table:name`). */
const keyOf = (s: Pick<DefineStatement, "kind" | "name" | "table">) =>
  `${s.kind}:${s.table ?? ""}:${s.name}`;

/** A one-table {@link Snapshot} (head + its fields) for the legacy `diffSnapshots` to diff. */
function snapOf(head: DefineStatement, fields: DefineStatement[]): Snapshot {
  const statements: Snapshot["statements"] = {};
  for (const s of [head, ...fields]) statements[keyOf(s)] = s;
  return { version: 1, statements };
}

// --- table: structured, field-level diff inside `overwrite` -------------------------------------

const tableEngine: KindEngine<PTable, PTable> = {
  lower: (t) => t,
  emit: (t) => [t.head.ddl, ...t.fields.map((f) => f.ddl)],
  // REMOVE TABLE covers its fields (no orphan REMOVE FIELDs) — matches the legacy drop.
  remove: (t) => [removeStatement(t.head)],
  // The field + table-head delta IS the legacy engine: build both sides as one-table snapshots and
  // take the up. The spine calls `overwrite(next, prev)` for the down, so this stays symmetric.
  overwrite: (prev, next) =>
    diffSnapshots(
      snapOf(prev.head, prev.fields),
      snapOf(next.head, next.fields),
    ).up,
  deps: (t) => t.deps,
};

// --- index: own kind, owned by its table, recreated on change -----------------------------------

const indexEngine: KindEngine<PIndex, PIndex> = {
  lower: (i) => i,
  emit: (i) => [i.stmt.ddl],
  remove: (i) => [removeStatement(i.stmt)],
  // No `overwrite` -> the spine recreates (remove + emit): `REMOVE INDEX … ; DEFINE INDEX …`,
  // exactly the legacy `changeUp` for an index (ALTER INDEX can't change fields/kind).
  deps: (i) => [{ kind: "table", name: i.table }],
  owner: (i) => ({ kind: "table", name: i.table }),
};

// --- event: own kind, owned by its table, OVERWRITE on change -----------------------------------

const eventEngine: KindEngine<PEvent, PEvent> = {
  lower: (e) => e,
  emit: (e) => [e.stmt.ddl],
  remove: (e) => [removeStatement(e.stmt)],
  // DEFINE EVENT OVERWRITE in place — matches the legacy `changeUp`/`changeDown` for an event.
  overwrite: (_prev, next) => [overwriteStatement(next.stmt.ddl)],
  deps: (e) => [{ kind: "table", name: e.table }],
  owner: (e) => ({ kind: "table", name: e.table }),
};

/** The SurrealDB driver's kind registry. Registration order == kind ordinal (table < index < event). */
export const surrealKinds = new KindRegistry();

// `build` is the kind's authoring entry. At the wholesale flip these route the `s.*` table/index/event
// authoring through the registry; for slice 2 the explode produces portable objects directly, so the
// builds are the identity (the registry only needs the engine behavior registered here).
surrealKinds.define({ name: "table", build: (t: PTable) => t, ...tableEngine });
surrealKinds.define({ name: "index", build: (i: PIndex) => i, ...indexEngine });
surrealKinds.define({ name: "event", build: (e: PEvent) => e, ...eventEngine });

/** Author -> portable via the registry: explode tables/defs into per-kind objects, then lower each. */
export function lowerAll(
  tables: AnyTable[],
  defs: AuthoredDef[] = [],
): PortableObject[] {
  return lowerSchema(surrealKinds, explodeSchema(tables, defs));
}

export type { Ref };
