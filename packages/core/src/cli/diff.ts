import { relative } from "node:path";
import type { DefineStatement, StandaloneDef } from "surreal-zod";
import {
  alterField,
  alterTable,
  emitDefStatement,
  emitStatements,
  overwriteStatement,
  removeStatement,
} from "surreal-zod";
import { schemaStruct } from "./lower";
import type { Snapshot, SnapshotStatement } from "./meta";
import type { AnyTable } from "./schema";
import { deepEqual } from "./struct";
import type { DbStructured } from "./structure";
import { colorEnabled, plural, style } from "./style";

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
    for (const s of emitStatements(t))
      statements[keyOf(s)] = file ? { ...s, file } : s;
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

/**
 * One object's change, for display. `kind` is the object kind, `table` its owner (a table name,
 * or the object's own name for db-level objects). `add` carries the new DDL; `remove` carries the
 * `REMOVE` statement (`ddl`) plus the dropped object's prior DDL (`old`, for the unified patch);
 * `change` pairs old↔new.
 */
export type DiffItem = {
  key: string;
  table: string;
  kind: DefineStatement["kind"];
  /** The source file this object lives in (or lived in, for a removal). Absent if unknown. */
  file?: string;
} & (
  | { op: "add"; ddl: string }
  | { op: "remove"; ddl: string; old: string }
  | { op: "change"; before: string; after: string }
);

export interface Diff {
  up: string[];
  down: string[];
  /** Structured per-object changes for the human display (word-level diff). */
  items?: DiffItem[];
  /** Every desired statement (the `next` schema), for the `--full` context view. */
  full?: { key: string; table: string; ddl: string }[];
}

/** `true` if the two snapshots define the same objects with identical DDL. */
export function isEmptyDiff(diff: Diff): boolean {
  return diff.up.length === 0;
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
  return [
    `-- ${tag}`,
    "-- Generated by surreal-zod. Review before applying.",
    "",
    'IF $direction = "up" {',
    indent(diff.up),
    "} ELSE {",
    indent(diff.down),
    "};",
    "",
  ].join("\n");
}

/**
 * Inline word-level diff of two statements: shared tokens dim, removed tokens red, added tokens
 * green (LCS over space-separated tokens). So a changed field shows the whole statement with only
 * the changed words highlighted.
 */
export function tokenDiff(before: string, after: string): string {
  const a = before.split(" ");
  const b = after.split(" ");
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // With color: red/green/dim. Without (pipe / CI / NO_COLOR): git `--word-diff=plain` markers
  // `[-removed-]`/`{+added+}` so removed-vs-added is unambiguous and assertable.
  const colored = colorEnabled();
  const del = (t: string) => (colored ? style.red(t) : `[-${t}-]`);
  const ins = (t: string) => (colored ? style.green(t) : `{+${t}+}`);
  const eq = (t: string) => (colored ? style.dim(t) : t);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push(eq(a[i]));
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(del(a[i++]));
    } else {
      out.push(ins(b[j++]));
    }
  }
  while (i < m) out.push(del(a[i++]));
  while (j < n) out.push(ins(b[j++]));
  return out.join(" ");
}

/**
 * Render one display item: `+`/`-` line for add/remove. A change renders as separate red `-` /
 * green `+` lines by default, or as a single inline word-diff when `inline` is set (the A/B toggle).
 */
function renderItem(it: DiffItem, inline = false): string {
  if (it.op === "add") return style.green(`  + ${it.ddl}`);
  if (it.op === "remove") return style.red(`  - ${it.ddl}`);
  if (inline) return `    ${tokenDiff(it.before, it.after)}`;
  return `${style.red(`  - ${it.before}`)}\n${style.green(`  + ${it.after}`)}`;
}

/**
 * Group diff items by their source file (git-style), so the display reads like a file diff. Items
 * with no file (an older snapshot, or the live DB) fall back to a per-object group headed by the
 * object's bare name. Returns groups in first-seen order, each with its header.
 */
function groupByFile(
  items: DiffItem[],
): { header: string; items: DiffItem[] }[] {
  const order: string[] = [];
  const byKey = new Map<string, DiffItem[]>();
  for (const it of items) {
    const key = it.file ?? `\0${it.table}`; // \0 can't collide with a real path
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
      order.push(key);
    }
    group.push(it);
  }
  return order.map((key) => {
    const group = byKey.get(key) ?? [];
    return {
      header: group.find((i) => i.file)?.file ?? group[0].table,
      items: group,
    };
  });
}

/** Render display items as a git-style file diff: each group headed by its source file path. */
export function formatItems(items: DiffItem[], inline = false): string {
  return groupByFile(items)
    .map((g) =>
      [
        style.bold(g.header),
        ...g.items.map((it) => renderItem(it, inline)),
      ].join("\n"),
    )
    .join("\n\n");
}

/**
 * A standard **unified diff** of the change, grouped one section per source file (git-style) — for
 * piping through a diff viewer (git's pager / delta). Objects with no file fall back to a section
 * headed by the object's bare name. Each object is a single-line DDL statement, so hunks are
 * line-for-line.
 */
export function formatPatch(diff: Diff): string {
  const items = diff.items ?? [];
  if (!items.length) return "";
  const out: string[] = [];
  for (const { header, items: group } of groupByFile(items)) {
    const lines: string[] = [];
    let dels = 0;
    let adds = 0;
    for (const it of group) {
      if (it.op === "add") {
        lines.push(`+${it.ddl}`);
        adds++;
      } else if (it.op === "remove") {
        lines.push(`-${it.old}`);
        dels++;
      } else {
        lines.push(`-${it.before}`, `+${it.after}`);
        dels++;
        adds++;
      }
    }
    out.push(
      `diff --git a/${header} b/${header}`,
      `--- a/${header}`,
      `+++ b/${header}`,
      `@@ -${dels ? 1 : 0},${dels} +${adds ? 1 : 0},${adds} @@`,
      ...lines,
    );
  }
  return `${out.join("\n")}\n`;
}

/** `--full`: the whole desired schema — unchanged dim, additions green, changes word-diffed. */
function formatFull(diff: Diff, inline = false): string {
  const byKey = new Map((diff.items ?? []).map((it) => [it.key, it]));
  const out: string[] = [];
  let prev: string | undefined;
  for (const f of diff.full ?? []) {
    if (prev !== undefined && f.table !== prev) out.push("");
    const it = byKey.get(f.key);
    if (it?.op === "change") out.push(renderItem(it, inline));
    else if (it?.op === "add") out.push(style.green(`  + ${f.ddl}`));
    else out.push(style.dim(`    ${f.ddl}`));
    prev = f.table;
  }
  const removed = (diff.items ?? []).filter((it) => it.op === "remove");
  if (removed.length) {
    out.push("");
    for (const it of removed) out.push(renderItem(it, inline));
  }
  return out.join("\n");
}

/** A human-readable view of a diff's forward (and optionally reverse) changes. */
export function formatDiff(
  diff: Diff,
  opts: { down?: boolean; full?: boolean; inline?: boolean } = {},
): string {
  if (!diff.up.length) return "No changes.";
  let out = opts.full
    ? formatFull(diff, opts.inline)
    : formatItems(diff.items ?? [], opts.inline);
  if (opts.down) {
    out += `\n\n${style.dim("  rollback (down):")}\n${diff.down.map((s) => style.dim(`  ${s}`)).join("\n")}`;
  }
  return out;
}

/** The kind of object a statement targets, for count summaries. */
type CountKind =
  | "table"
  | "field"
  | "index"
  | "event"
  | "function"
  | "access"
  | "other";
function kindOf(stmt: string): CountKind {
  const m =
    /^(?:DEFINE|REMOVE|ALTER)\s+(TABLE|FIELD|INDEX|EVENT|FUNCTION|ACCESS)\b/.exec(
      stmt,
    );
  return m ? (m[1].toLowerCase() as CountKind) : "other";
}

/** A per-kind breakdown of a set of statements, e.g. `1 table, 2 fields`. */
export function summarizeKinds(stmts: string[]): string {
  const counts = {
    table: 0,
    field: 0,
    index: 0,
    event: 0,
    function: 0,
    access: 0,
    other: 0,
  };
  for (const s of stmts) counts[kindOf(s)]++;
  const parts: string[] = [];
  if (counts.table) parts.push(plural(counts.table, "table"));
  if (counts.field) parts.push(plural(counts.field, "field"));
  if (counts.index)
    parts.push(plural(counts.index, "index").replace("indexs", "indexes"));
  if (counts.event) parts.push(plural(counts.event, "event"));
  if (counts.function) parts.push(plural(counts.function, "function"));
  if (counts.access)
    parts.push(plural(counts.access, "access").replace("accesss", "accesses"));
  if (counts.other) parts.push(plural(counts.other, "object"));
  return parts.join(", ");
}
