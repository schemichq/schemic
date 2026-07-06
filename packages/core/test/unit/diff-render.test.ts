// Multi-line DDL rendering: since drivers pretty-print display statements, every LINE of a
// statement must carry its diff indicator (a bare continuation line reads as context), unified-patch
// hunk counts must count LINES, and the inline token view collapses onto one line. Runs with color
// disabled (NO_COLOR) so the markers are assertable.
import { beforeAll, describe, expect, test } from "bun:test";

process.env.NO_COLOR = "1";

const { formatDiff, formatItems, formatPatch } = await import(
  "../../src/cli-kit/diff"
);
import type { Diff, DiffItem } from "../../src/cli-kit/diff";

const MULTI = "DEFINE FUNCTION fn::hello() {\n  RETURN 1;\n}";
const MULTI_AFTER = "DEFINE FUNCTION fn::hello() {\n  RETURN 2;\n}";

function item(op: DiffItem["op"]): DiffItem {
  const base = { key: "fn:hello", table: "hello", kind: "function", file: "fns.ts" };
  if (op === "add") return { ...base, op, ddl: MULTI };
  if (op === "remove") return { ...base, op, ddl: "REMOVE FUNCTION fn::hello", old: MULTI };
  return { ...base, op, before: MULTI, after: MULTI_AFTER };
}

describe("multi-line diff rendering", () => {
  test("add: every line carries the + indicator", () => {
    const out = formatItems([item("add")]);
    const lines = out.split("\n").slice(1); // drop the file header
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toStartWith("  + ");
  });

  test("change: every before line gets -, every after line gets +", () => {
    const out = formatItems([item("change")]);
    const lines = out.split("\n").slice(1);
    expect(lines.filter((l) => l.startsWith("  - "))).toHaveLength(3);
    expect(lines.filter((l) => l.startsWith("  + "))).toHaveLength(3);
  });

  test("inline change collapses to a single word-diff line", () => {
    const out = formatItems([item("change")], true);
    const lines = out.split("\n").slice(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[-1;-]");
    expect(lines[0]).toContain("{+2;+}");
  });

  test("patch: per-line signs and line-accurate hunk counts", () => {
    const patch = formatPatch({ up: ["x"], down: [], items: [item("change")] });
    expect(patch).toContain("@@ -1,3 +1,3 @@");
    const body = patch.split("\n");
    expect(body.filter((l) => l.startsWith("-".repeat(1)) && !l.startsWith("---"))).toHaveLength(3);
    expect(body.filter((l) => l.startsWith("+") && !l.startsWith("+++"))).toHaveLength(3);
  });

  test("patch: removal counts the dropped object's prior lines", () => {
    const patch = formatPatch({ up: ["x"], down: [], items: [item("remove")] });
    expect(patch).toContain("@@ -1,3 +0,0 @@");
  });

  test("down block indents every line of a multi-line statement", () => {
    const diff: Diff = { up: ["x"], down: [MULTI], items: [item("add")] };
    const out = formatDiff(diff, { down: true });
    const tail = out.split("rollback (down):")[1].split("\n").filter(Boolean);
    expect(tail).toHaveLength(3);
    for (const l of tail) expect(l).toStartWith("  ");
  });
});
