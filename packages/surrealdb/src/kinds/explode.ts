// The driver-side EXPLODE (docs/kind-registry-contract.md §7, sanctioned by core-dev): SurrealDB
// authors index/event/field-index INLINE on the table, so a single `TableDef` fans out into one TABLE
// object + N INDEX + M EVENT objects. We flatten the schema into per-kind definables BEFORE lowering,
// so `KindEngine.lower` stays a clean 1:1 and the contract needs no "explode hook". This is exactly
// what `Driver.lower` will wrap around `lowerSchema` at the eventual wholesale flip.
//
// It reuses the EXISTING canonical pipeline — `schemaStruct` (TableDef -> normalized Struct IR, with
// standalone events attached + functions/accesses resolved) then `structuredSnapshot` (Struct ->
// canonical `DEFINE` statements keyed kind:table:name) — so every emitted DDL string is byte-identical
// to the fixed-slot `surrealDriver.diff` path. Functions/accesses are NOT yet registered kinds (later
// slices); their statements are produced by `schemaStruct` but dropped here.

import type { AnyTable, AuthoredDef, Ref } from "@schemic/core";
import { schemaStruct } from "../cli/lower";
import { structuredSnapshot } from "../cli/structure";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import type { SurrealPortable } from "./portable";

/**
 * Flatten authored tables (+ standalone defs) into per-kind portable objects: one {@link PTable} per
 * table (head + nested fields), one {@link PIndex} per index, one {@link PEvent} per event. A table's
 * `deps` are its RELATION in/out endpoint tables (so the graph emits a relation after its endpoints).
 *
 * Params mirror `buildSnapshot`'s public bound (`AnyTable`/`AuthoredDef`) and cast to the src `TableDef`
 * the canonical pipeline reads — the established way to bridge the src-vs-lib type duality.
 */
export function explodeSchema(
  tables: AnyTable[],
  defs: AuthoredDef[] = [],
): SurrealPortable[] {
  const db = schemaStruct(
    tables as unknown as TableDef<string, Shape>[],
    defs as unknown as StandaloneDef[],
  );
  const out: SurrealPortable[] = [];
  for (const st of db.tables) {
    // Render this one table's canonical statements (head + fields + its indexes + its events).
    const snap = structuredSnapshot({
      tables: [st],
      functions: [],
      accesses: [],
    });
    const stmts = Object.values(snap.statements);
    const head = stmts.find((s) => s.kind === "table");
    if (!head) continue; // a table always has a head; defensive only

    const fields = stmts.filter((s) => s.kind === "field");
    const deps: Ref[] = [];
    for (const t of st.kind.in ?? []) deps.push({ kind: "table", name: t });
    for (const t of st.kind.out ?? []) deps.push({ kind: "table", name: t });
    out.push({ kind: "table", name: st.name, head, fields, deps });

    for (const s of stmts.filter((s) => s.kind === "index"))
      out.push({ kind: "index", name: s.name, table: st.name, stmt: s });
    for (const s of stmts.filter((s) => s.kind === "event"))
      out.push({ kind: "event", name: s.name, table: st.name, stmt: s });
  }
  return out;
}
