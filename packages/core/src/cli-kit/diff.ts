// The DIALECT-FREE diff DISPLAY + shared types. The SurrealDB statement-diff engine (buildSnapshot/
// diffSnapshots/renderMigration) lives in `./surreal-diff` and is invoked through the driver; this
// module is what the CLI shell uses to RENDER any driver's Diff (git-style file groups, word-diff,
// unified patch, kind summaries). Dialect-free: `kind` is an opaque string, not a Surreal kind union.
import type { KindRegistry } from "../kind";
import type { SecretRef } from "../secrets";
import { colorEnabled, style } from "./style";

/**
 * One object's change, for display. `kind` is the object kind, `table` its owner (a table name,
 * or the object's own name for db-level objects). `add` carries the new DDL; `remove` carries the
 * `REMOVE` statement (`ddl`) plus the dropped object's prior DDL (`old`, for the unified patch);
 * `change` pairs old↔new.
 */
export type DiffItem = {
  key: string;
  table: string;
  /** Dialect-defined object kind (e.g. "table"/"field"/"index") — opaque to the display. */
  kind: string;
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
  /**
   * Apply-time secret bindings: `$param` name -> a write-only {@link SecretRef} (e.g. `env("X")`).
   * Populated by a driver whose DDL emits secret placeholders (SurrealDB `DEFINE ACCESS … KEY $param`).
   * MODEL 1: stored in the migration so it replays without the live schema; the **value never appears
   * here** — the apply layer resolves each ref through a `SecretProvider` and binds it (`db.query(ddl,
   * resolved)`), so secrets stay out of the schema, snapshot, and migration files. Diff-excluded +
   * snapshot-omitted, so a redacted secret never reads as drift.
   */
  bindings?: Record<string, SecretRef>;
  /** Structured per-object changes for the human display (word-level diff). */
  items?: DiffItem[];
  /** Every desired statement (the `next` schema), for the `--full` context view. */
  full?: { key: string; table: string; ddl: string }[];
}

/** `true` if the two snapshots define the same objects with identical DDL. */
export function isEmptyDiff(diff: Diff): boolean {
  return diff.up.length === 0;
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

/**
 * A per-kind breakdown of a set of changes, e.g. `1 Table, 2 Fields`. Counts each item by its
 * structured `kind` and labels it from the registry's per-kind {@link KindRegistry.display} (singular
 * when the count is one), so the summary is correct for every dialect — no DDL parsing.
 */
export function summarizeKinds(
  registry: KindRegistry,
  items: readonly { kind: string }[],
): string {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const [kind, n] of counts) {
    const d = registry.display(kind);
    parts.push(`${n} ${n === 1 ? d.label : d.plural}`);
  }
  return parts.join(", ");
}
