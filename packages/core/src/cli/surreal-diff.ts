// The SurrealDB STATEMENT-diff engine: builds canonical `DEFINE` snapshots from authored schemas
// and diffs two snapshots into SurrealQL up/down (clause-level ALTER where possible). This is the
// Surreal driver's internal diff strategy — invoked via `surrealDriver.diff` and the migrations
// capability's `render`. The dialect-free diff DISPLAY + types live in `./diff`. In the package
// split this module moves to `@schemic/surreal` (see docs/AUTHORING-SPLIT.md / MULTI-DB-SPIKE.md).

import { relative } from "node:path";
import type { DefineStatement, StandaloneDef } from "@schemic/core";
import {
  alterField,
  alterTable,
  emitDefStatement,
  emitStatements,
  overwriteStatement,
  removeStatement,
} from "@schemic/core";
import type { Diff, DiffItem } from "./diff";
import { schemaStruct } from "./lower";
import type { AnyTable } from "./schema";
import { deepEqual } from "./struct";
import type { DbStructured, Snapshot, SnapshotStatement } from "./structure";

const keyOf = (s: Pick<DefineStatement, "kind" | "name" | "table">) =>
  `${s.kind}:${s.table ?? ""}:${s.name}`;

/** Index a normalized DbStructured by statement key (matching `keyOf`) for structural equality. */
function structIndex(db: DbStructured): Map<string, unknown> {
  const idx = new Map<string, unknown>();
  for (const t of db.tables) {
    // The table STATEMENT is just the head — fields/indexes/events are their own statements.
    idx.set(`table::${t.name}`, {
      kind: t.kind,
      schemafull: t.schemafull,
      drop: t.drop,
      comment: t.comment,
      changefeed: t.changefeed,
      permissions: t.permissions,
    });
    for (const f of t.fields) idx.set(`field:${t.name}:${f.name}`, f);
    for (const i of t.indexes) idx.set(`index:${t.name}:${i.name}`, i);
    for (const e of t.events) idx.set(`event:${t.name}:${e.name}`, e);
  }
  for (const fn of db.functions) idx.set(`function::${fn.name}`, fn);
  for (const a of db.accesses) idx.set(`access::${a.name}`, a);
  return idx;
}

/**
 * Build the canonical snapshot (keyed `DEFINE` statements) for the current schemas: every table's
 * statements, plus any standalone defs (`defineEvent`/`defineFunction`), keyed by kind+table+name.
 */
export function buildSnapshot(
  tables: AnyTable[],
  defs: StandaloneDef[] = [],
  opts: {
    fileOf?: Map<unknown, string>;
    root?: string;
    /** Also compute + store the normalized Struct-IR (for `diff --ts`). Off by default. */
    withStruct?: boolean;
  } = {},
): Snapshot {
  const statements: Record<string, SnapshotStatement> = {};
  // The source file each object came from, project-root-relative for portable, readable snapshots.
  const fileFor = (obj: unknown): string | undefined => {
    const abs = opts.fileOf?.get(obj);
    return abs ? (opts.root ? relative(opts.root, abs) : abs) : undefined;
  };
  for (const t of tables) {
    const file = fileFor(t);
    try {
      for (const s of emitStatements(t))
        statements[keyOf(s)] = file ? { ...s, file } : s;
    } catch (e) {
      // Pin an emit failure (e.g. a non-Surreal field type) to the source file.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(file ? `${msg}\n  in ${file}` : msg);
    }
  }
  for (const d of defs) {
    const s = emitDefStatement(d);
    const file = fileFor(d);
    statements[keyOf(s)] = file ? { ...s, file } : s;
  }
  const snap: Snapshot = { version: 1, statements };
  if (opts.withStruct)
    // Bridge the lib/src type duality (AnyTable is the built-lib TableDef; schemaStruct uses src).
    snap.struct = schemaStruct(
      tables as unknown as Parameters<typeof schemaStruct>[0],
      defs as unknown as Parameters<typeof schemaStruct>[1],
    );
  return snap;
}

// Within a table, create order is table -> field -> index (each depends on the prior); drop
// order is the reverse. Statements are grouped by table (see `diffSnapshots`).
const RANK: Record<DefineStatement["kind"], number> = {
  function: 0, // db-level; defined first (tables/events may reference fn::…)
  table: 1,
  field: 2,
  index: 3,
  event: 4,
  access: 5, // db-level; defined last (SIGNUP/SIGNIN reference tables)
};
const tableOf = (s: DefineStatement) => s.table ?? s.name;

/**
 * The up-migration statement(s) for a CHANGED object:
 *   - `table` -> a clause-level `ALTER TABLE` (falls back to `DEFINE … OVERWRITE` when the delta
 *     can't be expressed via ALTER, e.g. a `TYPE` NORMAL/RELATION change or an older snapshot),
 *   - `field` -> a clause-level `ALTER FIELD` (falls back to `DEFINE … OVERWRITE` when the delta
 *     can't be expressed via ALTER, e.g. a `COMPUTED` change or an older snapshot w/o clauses),
 *   - `index` -> `REMOVE` + `DEFINE` (ALTER INDEX can't change fields/kind),
 *   - everything else (event/function/access) -> `DEFINE … OVERWRITE`.
 */
function changeUp(old: DefineStatement, next: DefineStatement): string[] {
  if (next.kind === "table") {
    const alt = alterTable(next.name, old.clauses, next.clauses);
    return [alt ?? overwriteStatement(next.ddl)];
  }
  if (next.kind === "field") {
    const alt = alterField(tableOf(next), next.name, old.clauses, next.clauses);
    return [alt ?? overwriteStatement(next.ddl)];
  }
  if (next.kind === "index") return [removeStatement(old), next.ddl];
  return [overwriteStatement(next.ddl)];
}
/** The inverse (next -> old) statement(s) for the down migration. */
function changeDown(old: DefineStatement, next: DefineStatement): string[] {
  if (next.kind === "table") {
    const alt = alterTable(old.name, next.clauses, old.clauses);
    return [alt ?? overwriteStatement(old.ddl)];
  }
  if (next.kind === "field") {
    const alt = alterField(tableOf(old), old.name, next.clauses, old.clauses);
    return [alt ?? overwriteStatement(old.ddl)];
  }
  if (next.kind === "index") return [removeStatement(next), old.ddl];
  return [overwriteStatement(old.ddl)];
}

/**
 * Diff two snapshots into `up`/`down` SurrealQL. Added/changed objects → `DEFINE` (with
 * `OVERWRITE` when changed); dropped objects → `REMOVE`. `down` is the exact inverse, so a
 * migration can be rolled back. Fields of a dropped/added table are skipped (the `TABLE`
 * statement covers them).
 */
export function diffSnapshots(prev: Snapshot, next: Snapshot): Diff {
  const prevS = prev.statements;
  const nextS = next.statements;

  // Group output by table: tables in snapshot order, each followed by its own fields/indexes.
  const tableOrder = new Map<string, number>();
  for (const s of [...Object.values(nextS), ...Object.values(prevS)]) {
    const t = tableOf(s);
    if (!tableOrder.has(t)) tableOrder.set(t, tableOrder.size);
  }
  const ord = (s: DefineStatement) => tableOrder.get(tableOf(s)) ?? 0;
  const byCreate = (a: DefineStatement, b: DefineStatement) =>
    ord(a) - ord(b) || RANK[a.kind] - RANK[b.kind];
  const byDrop = (a: DefineStatement, b: DefineStatement) =>
    ord(b) - ord(a) || RANK[b.kind] - RANK[a.kind];

  const removed = Object.keys(prevS)
    .filter((k) => !(k in nextS))
    .map((k) => prevS[k]);
  const removedTables = new Set(
    removed.filter((s) => s.kind === "table").map((s) => s.name),
  );

  // Structural change-detection: a DDL difference that normalizes away (e.g. an enum/union/record
  // reorder) is NOT a real change. Only applies when BOTH snapshots carry a Struct; older snapshots
  // (or keys absent from the struct, like folded array elements) fall back to the DDL comparison.
  const prevIdx = prev.struct ? structIndex(prev.struct) : null;
  const nextIdx = next.struct ? structIndex(next.struct) : null;
  const added: SnapshotStatement[] = [];
  const changed: { old: SnapshotStatement; next: SnapshotStatement }[] = [];
  for (const k of Object.keys(nextS)) {
    const s = nextS[k];
    if (!(k in prevS)) {
      added.push(s);
      continue;
    }
    if (prevS[k].ddl === s.ddl) continue;
    if (prevIdx && nextIdx) {
      const a = prevIdx.get(k);
      const b = nextIdx.get(k);
      if (a !== undefined && b !== undefined && deepEqual(a, b)) continue; // cosmetic-only
    }
    changed.push({ old: prevS[k], next: s });
  }
  const addedTables = new Set(
    added.filter((s) => s.kind === "table").map((s) => s.name),
  );

  // A field/index whose owning table is dropped (or added) is covered by the TABLE statement.
  const isOrphan = (s: DefineStatement, droppedTables: Set<string>) =>
    s.kind !== "table" && droppedTables.has(s.table ?? "");

  const up: string[] = [];
  for (const s of removed
    .filter((s) => !isOrphan(s, removedTables))
    .sort(byDrop)) {
    up.push(removeStatement(s));
  }
  for (const s of [...added].sort(byCreate)) up.push(s.ddl);
  for (const c of [...changed].sort((a, b) => byCreate(a.next, b.next)))
    up.push(...changeUp(c.old, c.next));

  const down: string[] = [];
  for (const s of added.filter((s) => !isOrphan(s, addedTables)).sort(byDrop)) {
    down.push(removeStatement(s));
  }
  for (const s of [...removed].sort(byCreate)) down.push(s.ddl);
  for (const c of [...changed].sort((a, b) => byCreate(a.next, b.next)))
    down.push(...changeDown(c.old, c.next));

  // Structured display items, grouped by table (table → its fields → its indexes).
  const tagged: { sort: [number, number]; item: DiffItem }[] = [];
  const at = (s: DefineStatement): [number, number] => [ord(s), RANK[s.kind]];
  for (const s of removed.filter((s) => !isOrphan(s, removedTables))) {
    tagged.push({
      sort: at(s),
      item: {
        op: "remove",
        kind: s.kind,
        key: keyOf(s),
        table: tableOf(s),
        file: s.file,
        ddl: removeStatement(s),
        old: s.ddl,
      },
    });
  }
  for (const s of added) {
    tagged.push({
      sort: at(s),
      item: {
        op: "add",
        kind: s.kind,
        key: keyOf(s),
        table: tableOf(s),
        file: s.file,
        ddl: s.ddl,
      },
    });
  }
  for (const c of changed) {
    tagged.push({
      sort: at(c.next),
      item: {
        op: "change",
        kind: c.next.kind,
        key: keyOf(c.next),
        table: tableOf(c.next),
        file: c.next.file ?? c.old.file,
        before: c.old.ddl,
        after: c.next.ddl,
      },
    });
  }
  tagged.sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1]);
  const items = tagged.map((t) => t.item);

  const full = Object.values(nextS)
    .sort(byCreate)
    .map((s) => ({ key: keyOf(s), table: tableOf(s), ddl: s.ddl }));

  return { up, down, items, full };
}

/** The table a statement targets (for grouping the migration body). */
function stmtTable(s: string): string {
  const on = /\bON (?:TABLE )?`?([^\s`;]+)`?/.exec(s);
  if (on) return on[1];
  const t = /\bTABLE (?:OVERWRITE |IF (?:NOT )?EXISTS )?`?([^\s`;]+)`?/.exec(s);
  return t ? t[1] : "";
}

/** Indent statements, with a blank line between consecutive table groups. */
const indent = (stmts: string[]): string => {
  const out: string[] = [];
  let prev: string | undefined;
  for (const s of stmts) {
    const t = stmtTable(s);
    if (prev !== undefined && t !== prev) out.push("");
    out.push(`    ${s}`);
    prev = t;
  }
  return out.join("\n");
};

/**
 * Render a migration as a single self-contained SurrealQL program. Applied with the
 * `$direction` parameter bound to `"up"` or `"down"` — verified to support `DEFINE`/`REMOVE`
 * inside `IF` blocks on SurrealDB 3.x.
 */
export function renderMigration(tag: string, diff: Diff): string {
  // A migration is REPLAYED from a fixed file regardless of the database's current state (unlike
  // `diff`/`push`, which recompute a delta each run), so its DEFINEs must be idempotent: re-marking
  // them DEFINE … OVERWRITE re-applies cleanly whether or not the object already exists — and
  // OVERWRITE preserves row data (REMOVEs already use IF EXISTS). This is what lets `schemic migrate`
  // run against a database whose objects were applied out-of-band (e.g. `schemic push`/`schemic pull`). The
  // changed-object statements are already OVERWRITE/ALTER, and `overwriteStatement` is a no-op on
  // those and on REMOVE/ALTER, so only plain DEFINEs (added objects) gain the keyword.
  const idempotent = (stmts: string[]) => stmts.map(overwriteStatement);
  return [
    `-- ${tag}`,
    "-- Generated by @schemic/core. Review before applying.",
    "",
    'IF $direction = "up" {',
    indent(idempotent(diff.up)),
    "} ELSE {",
    indent(idempotent(diff.down)),
    "};",
    "",
  ].join("\n");
}
