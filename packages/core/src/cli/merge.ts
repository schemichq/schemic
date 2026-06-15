// Surgically merge freshly-pulled `s.*` definitions into existing schema files, instead of
// overwriting them. Uses magicast (recast under the hood), so untouched code — user comments,
// extra imports, unrelated consts, hand-formatted fields — survives. The live DB wins on any
// object/field it defines; the only thing at risk is LOCAL-ONLY content (a field or whole const
// that exists in your files but not in the DB), which the caller resolves via keep/drop.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generateCode, parseModule } from "magicast";
import { colorEnabled, style } from "./style";

/** One rendered object (table / function / access): its const statement + the imports it needs. */
export interface RenderedUnit {
  kind: "table" | "function" | "access";
  /** DB object name (drives the file path). */
  name: string;
  /** The exported const identifier (`User`, `math_add`, …). */
  exportName: string;
  /** The `export const … = define…(…);` statement source (no import lines). */
  code: string;
  /** The `import …` lines this unit needs. */
  imports: string[];
}

/** Local-only content a merge would drop when mirroring the DB. */
export interface LocalOnly {
  /** Per existing const: field keys present locally but absent from the DB object. */
  fields: { exportName: string; fields: string[] }[];
  /** Whole consts present locally whose object the DB no longer has. */
  objects: string[];
}

export interface MergeResult {
  content: string;
  localOnly: LocalOnly;
}

/** Options governing what happens to local-only content. */
export interface MergeOptions {
  /** Keep local-only fields (graft them back into the merged object). */
  keepLocalFields: boolean;
  /** Keep local-only consts (objects the DB no longer has). */
  keepLocalObjects: boolean;
}

/** What pulling would do to one schema file. */
export interface PullFilePlan {
  /** Path relative to the project root (for display). */
  rel: string;
  /** Absolute path on disk. */
  abs: string;
  /**
   * `create` (new file), `update` (merged edits), `unchanged` (already matches the DB), or `delete`
   * (a file that is purely local-only entities the DB doesn't have — removed when mirroring).
   */
  action: "create" | "update" | "unchanged" | "delete";
  /** Current file contents (`""` for a new file). */
  before: string;
  /** Contents after the pull (the merged result). */
  after: string;
  /** Local-only content this file would drop when mirroring the DB. */
  localOnly: LocalOnly;
}

/** A driver's introspection rendered into a per-file write plan (see a driver's `planPull`). */
export interface PullPlan {
  files: PullFilePlan[];
}

/** Apply a plan: write created/updated files, delete local-only files. Returns the paths touched. */
export function applyPull(plan: PullPlan): string[] {
  const touched: string[] = [];
  for (const f of plan.files) {
    if (f.action === "unchanged") continue;
    if (f.action === "delete") {
      rmSync(f.abs, { force: true });
    } else {
      mkdirSync(dirname(f.abs), { recursive: true });
      writeFileSync(f.abs, f.after);
    }
    touched.push(f.rel);
  }
  return touched;
}

// --- AST helpers ------------------------------------------------------------------------------
// A permissive view over the recast/babel nodes we touch — every property we read, all optional,
// so navigation needs no per-access casts.
interface AstNode {
  type: string;
  name?: string;
  callee?: AstNode;
  object?: AstNode;
  body?: AstNode;
  arguments?: AstNode[];
  properties?: AstNode[];
  declaration?: AstNode;
  declarations?: Array<{ id?: { name?: string }; init?: AstNode }>;
  key?: { name?: string; value?: string };
  comments?: Array<{ leading?: boolean }>;
}

interface MagicastModule {
  $ast: { body: AstNode[] };
  imports: {
    $add: (s: { from: string; imported: string; local: string }) => void;
  };
}

const asMod = (mod: unknown): MagicastModule =>
  mod as unknown as MagicastModule;

/** The exported const's name, or null if this statement isn't an `export const X = …`. */
function exportConstName(node: AstNode): string | null {
  if (node.type !== "ExportNamedDeclaration") return null;
  if (node.declaration?.type !== "VariableDeclaration") return null;
  return node.declaration.declarations?.[0]?.id?.name ?? null;
}

/** The init expression of an `export const X = <init>`. */
function exportConstInit(node: AstNode): AstNode | null {
  return node.declaration?.declarations?.[0]?.init ?? null;
}

/** Walk a `define…(…).a().b()` chain down to the `define…(…)` CallExpression. */
function defineCall(init: AstNode | null): AstNode | null {
  let n: AstNode | null = init;
  while (n) {
    if (n.type === "CallExpression") {
      if (
        n.callee?.type === "Identifier" &&
        /^define/.test(n.callee.name ?? "")
      )
        return n;
      n =
        n.callee?.type === "MemberExpression"
          ? (n.callee.object ?? null)
          : (n.callee ?? null);
    } else if (n.type === "MemberExpression") {
      n = n.object ?? null;
    } else break;
  }
  return null;
}

/** The fields ObjectExpression of a `defineTable`/`defineRelation` call (handles the `self` arrow form). */
function fieldsObject(init: AstNode | null): AstNode | null {
  const call = defineCall(init);
  if (!call) return null;
  let obj = call.arguments?.[1] ?? null;
  if (obj?.type === "ArrowFunctionExpression") obj = obj.body ?? null;
  return obj?.type === "ObjectExpression" ? obj : null;
}

/** Property key as a string (`name` / `"weird-key"`). */
function propKey(p: AstNode): string | undefined {
  return p.key?.name ?? p.key?.value;
}

/** Whether a node carries a leading comment (so we don't clobber/duplicate it). */
function hasLeadingComment(node: AstNode): boolean {
  return Boolean(node.comments?.some((c) => c.leading));
}

/** Parse `import { a, b } from "x"` lines into `{from, names}` (our generated imports use no aliases). */
function parseImportLine(
  line: string,
): { from: string; names: string[] } | null {
  const m = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/.exec(line);
  if (!m) return null;
  return {
    from: m[2],
    names: m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/**
 * Merge `units` into `existingSrc`. Each unit replaces the matching `export const` in place (DB wins),
 * preserving everything else in the file. New units are appended; needed imports are unioned in.
 * Local-only fields/objects are reported, and kept or dropped per `opts`.
 */
export function mergeUnits(
  existingSrc: string,
  units: RenderedUnit[],
  opts: MergeOptions,
): MergeResult {
  const mod = parseModule(existingSrc);
  const body = asMod(mod).$ast.body;

  // Index existing exported consts by name.
  const existing = new Map<string, AstNode>();
  for (const node of body) {
    const name = exportConstName(node);
    if (name) existing.set(name, node);
  }

  const localOnly: LocalOnly = { fields: [], objects: [] };
  const desiredNames = new Set(units.map((u) => u.exportName));

  for (const unit of units) {
    // Parse the freshly-rendered unit to lift its statement node.
    const unitBody = asMod(parseModule(unit.code)).$ast.body;
    const desiredNode = unitBody.find(
      (n) => exportConstName(n) === unit.exportName,
    );
    if (!desiredNode) continue; // shouldn't happen — the renderer always emits the const

    const prior = existing.get(unit.exportName);
    if (prior) {
      // Table/relation: reconcile fields. Functions/access are atomic (whole-const replace).
      if (unit.kind === "table") {
        const priorObj = fieldsObject(exportConstInit(prior));
        const desiredObj = fieldsObject(exportConstInit(desiredNode));
        if (priorObj?.properties && desiredObj?.properties) {
          const desiredKeys = new Set(desiredObj.properties.map(propKey));
          const localFields = priorObj.properties.filter(
            (p) => !desiredKeys.has(propKey(p)),
          );
          if (localFields.length) {
            localOnly.fields.push({
              exportName: unit.exportName,
              fields: localFields.map((p) => propKey(p) ?? "?"),
            });
            // Graft the local-only field nodes (with their comments) onto the merged object.
            if (opts.keepLocalFields)
              for (const p of localFields) desiredObj.properties.push(p);
          }
        }
      }
      // Preserve a user's leading comment above the const (the renderer emits none for tables;
      // for access the renderer's own NOTE already lives on desiredNode, so don't double it).
      if (!hasLeadingComment(desiredNode))
        desiredNode.comments = prior.comments;
      body[body.indexOf(prior)] = desiredNode;
    } else {
      body.push(desiredNode);
    }
    addImports(mod, unit.imports);
  }

  // Existing consts the DB no longer has → local-only objects.
  for (const [name, node] of existing) {
    if (desiredNames.has(name)) continue;
    localOnly.objects.push(name);
    if (!opts.keepLocalObjects) body.splice(body.indexOf(node), 1);
  }

  return { content: ensureTrailingNewline(generateCode(mod).code), localOnly };
}

/** Union the named imports from `lines` into the module (magicast dedupes against existing). */
function addImports(mod: unknown, lines: string[]): void {
  const imports = asMod(mod).imports;
  for (const line of lines) {
    const parsed = parseImportLine(line);
    if (!parsed) continue;
    for (const name of parsed.names)
      imports.$add({ from: parsed.from, imported: name, local: name });
  }
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}

// --- Line diff (colored preview + git-style patch) -------------------------------------------

type LineOp = { tag: " " | "-" | "+"; line: string };

const splitLines = (s: string): string[] =>
  s === "" ? [] : s.replace(/\n$/, "").split("\n");

/** LCS line-level ops between two texts (a trailing newline is ignored). */
function lineOps(before: string, after: string): LineOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ tag: " ", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ tag: "-", line: a[i++] });
    } else {
      ops.push({ tag: "+", line: b[j++] });
    }
  }
  while (i < m) ops.push({ tag: "-", line: a[i++] });
  while (j < n) ops.push({ tag: "+", line: b[j++] });
  return ops;
}

/**
 * A compact colored line diff for previews. A new file renders as all-green additions; an edit
 * renders removed (red `-`) / added (green `+`) lines with a little surrounding context (long
 * unchanged runs collapse to `…`).
 */
export function lineDiff(before: string, after: string): string {
  const ops = lineOps(before, after);
  // Keep changed lines plus up to 2 lines of context around each; collapse long unchanged runs.
  const CONTEXT = 2;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.tag === " ") return;
    for (
      let k = Math.max(0, idx - CONTEXT);
      k <= Math.min(ops.length - 1, idx + CONTEXT);
      k++
    )
      keep[k] = true;
  });
  const out: string[] = [];
  let gap = false;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (!gap) out.push(style.dim("  …"));
      gap = true;
      return;
    }
    gap = false;
    if (op.tag === " ") out.push(style.dim(`  ${op.line}`));
    else if (op.tag === "-") out.push(style.red(`- ${op.line}`));
    else out.push(style.green(`+ ${op.line}`));
  });
  return out.join("\n");
}

/**
 * A git-style unified diff between two texts, headed by `label` as the file path — for piping to a
 * diff viewer (delta / git's pager). Returns "" when there's no change.
 */
export function unifiedDiff(
  before: string,
  after: string,
  label: string,
): string {
  const ops = lineOps(before, after);
  if (!ops.some((o) => o.tag !== " ")) return "";
  const oldLen = ops.filter((o) => o.tag !== "+").length;
  const newLen = ops.filter((o) => o.tag !== "-").length;
  const body = ops.map((o) =>
    o.tag === " " ? ` ${o.line}` : `${o.tag}${o.line}`,
  );
  return `${[
    `diff --git a/${label} b/${label}`,
    `--- a/${label}`,
    `+++ b/${label}`,
    `@@ -1,${oldLen} +1,${newLen} @@`,
    ...body,
  ].join("\n")}\n`;
}

/** Colored verb for a pull action (`new` / `update` / `delete` / `unchanged`). */
export function actionLabel(
  action: "create" | "update" | "unchanged" | "delete",
): string {
  if (action === "create") return colorEnabled() ? style.green("new") : "new";
  if (action === "update")
    return colorEnabled() ? style.yellow("update") : "update";
  if (action === "delete")
    return colorEnabled() ? style.red("delete") : "delete";
  return style.dim("unchanged");
}
