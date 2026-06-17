// The driver-side EXPLODE (docs/kind-registry-contract.md §7, sanctioned by core-dev): SurrealDB
// authors index/event/field-index INLINE on the table, so a single `TableDef` fans out into one TABLE
// object + N INDEX + M EVENT objects (and the db-level FUNCTION/ACCESS objects ride alongside). We
// flatten the whole schema into per-kind portable objects BEFORE lowering, so `KindEngine.lower` stays
// a clean 1:1 and the contract needs no "explode hook". This is what `Driver.lower` will wrap around
// `lowerSchema` at the eventual wholesale flip.
//
// It reuses the EXISTING canonical pipeline — `schemaStruct` (TableDef -> normalized Struct IR, with
// standalone events attached + functions/accesses resolved) then `structuredSnapshot` (Struct ->
// canonical `DEFINE` statements keyed kind:table:name) — so every emitted DDL string is byte-identical
// to the fixed-slot `surrealDriver.diff` path.
//
// CROSS-KIND DEPS: an object that calls `fn::name` must emit AFTER that function (the function-before-
// table case the ordinal alone gets wrong). We scan each object's rendered DDL for `fn::` references and
// attach `deps -> {kind:"function", name}` — on a table (field VALUE/ASSERT/DEFAULT/PERMISSIONS + table
// PERMISSIONS), an event (WHEN/THEN), an access (SIGNUP/SIGNIN/AUTHENTICATE), and a function (its body
// calling another fn::). Edges to functions outside the diff are ignored by the spine, so over-reporting
// is harmless. (SEARCH index -> analyzer edges land when the analyzer kind is registered.)

import type { AnyTable, AuthoredDef, PortableDb, Ref } from "@schemic/core";
import { schemaStruct } from "../cli/lower";
import { normalizeDb } from "../cli/struct";
import type { DbStructured } from "../cli/structure";
import { structuredSnapshot } from "../cli/structure";
import type { DefineStatement } from "../ddl";
import { lowerDb } from "../driver/surreal-ir";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import type { SurrealPortable } from "./portable";

/** Match a `fn::name` reference (incl. namespaced `fn::a::b`), capturing the bare function name. */
const FN_REF = /fn::([A-Za-z0-9_]+(?:::[A-Za-z0-9_]+)*)/g;

/**
 * The cross-kind dependency edges for one object: a `base` set (its table, for index/event) plus the
 * `fn::` functions referenced in its DDL — deduped, and excluding `self` (a function's body referencing
 * itself is recursion, not an ordering edge).
 */
function depsOf(ddls: string[], base: Ref[] = [], self?: string): Ref[] {
  const seen = new Set(base.map((r) => `${r.kind}:${r.name}`));
  const out: Ref[] = [...base];
  for (const ddl of ddls) {
    for (const m of ddl.matchAll(FN_REF)) {
      const name = m[1];
      if (name === self) continue;
      const key = `function:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "function", name });
    }
  }
  return out;
}

/**
 * The shared core: a NORMALIZED Struct IR -> per-kind portable objects. Renders each object's canonical
 * `DEFINE` statement(s) via `structuredSnapshot`, then partitions: a {@link PTable} per table (head +
 * nested fields), a {@link PIndex} per index, a {@link PEvent} per event, and the db-level
 * {@link PFunction}/{@link PAccess} objects — each carrying its `fn::`/endpoint dependency edges.
 * Both entry points ({@link explodeSchema} from authoring, {@link decompose} from a {@link PortableDb})
 * feed their normalized Struct here, so they produce byte-identical portable objects.
 */
function fromStructured(db: DbStructured): SurrealPortable[] {
  const stmts = Object.values(structuredSnapshot(db).statements);
  const of = (kind: DefineStatement["kind"]) =>
    stmts.filter((s) => s.kind === kind);

  const out: SurrealPortable[] = [];

  // Tables: head + nested fields. deps = RELATION in/out endpoints + fn:: from the head/fields.
  const headByTable = new Map(of("table").map((s) => [s.name, s]));
  const fieldsByTable = new Map<string, DefineStatement[]>();
  for (const s of of("field")) {
    const arr = fieldsByTable.get(s.table ?? "") ?? [];
    arr.push(s);
    fieldsByTable.set(s.table ?? "", arr);
  }
  for (const st of db.tables) {
    const head = headByTable.get(st.name);
    if (!head) continue; // a table always has a head; defensive only
    const fields = fieldsByTable.get(st.name) ?? [];
    const endpoints: Ref[] = [];
    for (const t of st.kind.in ?? [])
      endpoints.push({ kind: "table", name: t });
    for (const t of st.kind.out ?? [])
      endpoints.push({ kind: "table", name: t });
    const deps = depsOf([head.ddl, ...fields.map((f) => f.ddl)], endpoints);
    out.push({ kind: "table", name: st.name, head, fields, deps });
  }

  for (const s of of("index"))
    out.push({ kind: "index", name: s.name, table: s.table ?? "", stmt: s });
  for (const s of of("event"))
    out.push({
      kind: "event",
      name: s.name,
      table: s.table ?? "",
      stmt: s,
      deps: depsOf([s.ddl], [{ kind: "table", name: s.table ?? "" }]),
    });
  for (const s of of("function"))
    out.push({
      kind: "function",
      name: s.name,
      stmt: s,
      deps: depsOf([s.ddl], [], s.name),
    });
  for (const s of of("access"))
    out.push({ kind: "access", name: s.name, stmt: s, deps: depsOf([s.ddl]) });

  return out;
}

/**
 * Authoring -> per-kind portable objects (what `Driver.lower` wraps around `lowerSchema`). Params mirror
 * `buildSnapshot`'s public bound (`AnyTable`/`AuthoredDef`) and cast to the src `TableDef` the canonical
 * pipeline reads. `schemaStruct` already normalizes (events attached, functions/accesses resolved).
 */
export function explodeSchema(
  tables: AnyTable[],
  defs: AuthoredDef[] = [],
): SurrealPortable[] {
  return fromStructured(
    schemaStruct(
      tables as unknown as TableDef<string, Shape>[],
      defs as unknown as StandaloneDef[],
    ),
  );
}

/**
 * The FACADE adapter: a fixed-slot {@link PortableDb} -> per-kind portable objects. This is what
 * `Driver.diff(prev, next)` will route through at the flip — `buildKindDiff(registry, decompose(prev),
 * decompose(next))`. We normalize the same way the legacy snapshot does (`normalizeDb(lowerDb(db))`) so
 * a decomposed `PortableDb` and an `explodeSchema`'d authoring side converge to identical objects.
 */
export function decompose(db: PortableDb): SurrealPortable[] {
  return fromStructured(normalizeDb(lowerDb(db)));
}
