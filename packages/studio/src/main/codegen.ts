import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// Generate SurrealQL DDL from a `.ts`/`.js` schema file by loading it with jiti and
// running surreal-zod's public emit functions over the exported sz.* defs. Runs in the
// main process (node) — the renderer can't execute the user's TS. (Engine bridge, Slice 2.)
//
// We duck-type the loaded objects rather than `instanceof`: the opened project has its
// OWN surreal-zod instance (resolved from its node_modules), distinct from studio's, but
// emit's structural access works across instances — same approach as the CLI's loadDefs.

/** A 1-based, Monaco-style range (inclusive start, exclusive end column). */
export interface Span {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * One source<->generated link. `clause` is the SurrealQL clause it covers — `TYPE`, `DEFAULT`,
 * `ASSERT`, … — or `FULL` for the whole statement (the fallback when the cursor isn't inside a
 * specific clause). `source` is the span of the sz chain segment(s) in the `.ts`; `gen` is the
 * span of the matching clause text in the generated DDL. Cursor sync resolves the *smallest*
 * span containing the cursor, so a `.$assert(...)` highlights exactly `ASSERT …` and back.
 */
export interface SpanLink {
  clause: string;
  kind: string;
  key: string;
  source: Span;
  gen: Span;
}

export interface CodegenResult {
  ok: boolean;
  surql?: string;
  error?: string;
  /** Per-clause span links for bidirectional cursor sync. */
  map?: SpanLink[];
}

type Stmt = {
  kind: string;
  name: string;
  table?: string;
  ddl: string;
  clauses?: Record<string, string>;
};

type AnyTable = {
  name: string;
  fields: object;
  config: { relation?: unknown };
  record: (...args: unknown[]) => unknown;
};
type AnyDef = { kind: "event" | "function" | "access"; name: string };

function isTableDef(v: unknown): v is AnyTable {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.name === "string" &&
    typeof t.fields === "object" &&
    t.fields !== null &&
    typeof t.config === "object" &&
    t.config !== null &&
    typeof t.record === "function"
  );
}

function isStandaloneDef(v: unknown): v is AnyDef {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    (d.kind === "event" || d.kind === "function" || d.kind === "access") &&
    typeof d.name === "string"
  );
}

let tmpCounter = 0;

// Strip backticks anywhere — emit escapes reserved-word path segments (`address.`order``);
// our AST keys are raw, so drop ticks on both sides to match (field names never contain `).
const unquote = (s: string) => s.replace(/`/g, "");

/** A clause's source span, plus the inner `surql\`...\`` expression span when it wraps one. */
interface ClauseSpan {
  span: Span;
  expr?: { span: Span; text: string };
}

/** Source spans for one table/field: the whole declaration plus a span per clause it sets. */
interface FieldSpans {
  full: Span;
  clauses: Map<string, ClauseSpan>;
}

/**
 * Which generated clause an sz chain method contributes to. Several methods fold into one
 * clause (every comparison/length/regex/assert helper -> `ASSERT`; the base type + every type
 * modifier -> `TYPE`), matching how core's emit merges them — so the source spans for those
 * methods all point at the single generated clause. Unknown methods are treated as type
 * construction (the base call `sz.string()`, custom helpers) and fold into `TYPE`.
 */
function clauseOf(method: string): string {
  switch (method) {
    case "$default":
    case "$defaultAlways":
      return "DEFAULT";
    case "$value":
      return "VALUE";
    case "$computed":
      return "COMPUTED";
    case "$assert":
    case "$min":
    case "$max":
    case "$length":
    case "$regex":
    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte":
      return "ASSERT";
    case "$readonly":
      return "READONLY";
    case "$comment":
      return "COMMENT";
    case "$permissions":
    case "$internal":
      return "PERMISSIONS";
    case "flexible":
      return "FLEXIBLE";
    default:
      return "TYPE";
  }
}

/**
 * Parse the schema source for the span of each table + top-level field and, within a field, the
 * span of each clause-setting chain segment — keyed `table:<name>` / `field:<table>.<name>`, for
 * clause-precise cursor sync. Recurses into nested object/array/record fields (dotted paths that
 * mirror emit). Uses the TS compiler API (already a dep for the LSP).
 */
async function sourceSpans(
  file: string,
  text: string,
): Promise<Map<string, FieldSpans>> {
  const ts = await import("typescript");
  type Node = import("typescript").Node;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const map = new Map<string, FieldSpans>();

  const spanFromPos = (start: number, end: number): Span => {
    const a = sf.getLineAndCharacterOfPosition(start);
    const b = sf.getLineAndCharacterOfPosition(end);
    return {
      startLine: a.line + 1,
      startCol: a.character + 1,
      endLine: b.line + 1,
      endCol: b.character + 1,
    };
  };
  const spanOf = (n: Node): Span => spanFromPos(n.getStart(sf), n.getEnd());
  const propName = (n: Node): string | null =>
    ts.isIdentifier(n) || ts.isStringLiteralLike(n) ? n.text : null;

  // The body span + cooked text of a `surql\`...\`` template arg (no interpolations), else null.
  const surqlTemplate = (node: Node): { span: Span; text: string } | null => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "surql" &&
      ts.isNoSubstitutionTemplateLiteral(node.template)
    ) {
      const tpl = node.template;
      return {
        // +1 / -1 trims the backticks so the span covers just the SurrealQL body.
        span: spanFromPos(tpl.getStart(sf) + 1, tpl.getEnd() - 1),
        text: tpl.text,
      };
    }
    return null;
  };

  // Walk a field's chain expression, collecting the source span(s) per clause. The base type
  // call includes its `sz.`/`z.` namespace; `.method(...)` segments cover the method + args. When
  // a clause-setting call wraps a single `surql\`...\`` template, its body is recorded for drill-in.
  const walkChain = (value: Node): Map<string, ClauseSpan> => {
    const segs = new Map<string, { start: number; end: number }[]>();
    const exprs = new Map<string, { span: Span; text: string }[]>();
    let cur: Node = value;
    while (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression)
    ) {
      const pa = cur.expression;
      const clause = clauseOf(pa.name.text);
      const start = ts.isIdentifier(pa.expression)
        ? pa.expression.getStart(sf)
        : pa.name.getStart(sf);
      (segs.get(clause) ?? segs.set(clause, []).get(clause))?.push({
        start,
        end: cur.getEnd(),
      });
      for (const a of cur.arguments) {
        const t = surqlTemplate(a);
        if (t)
          (exprs.get(clause) ?? exprs.set(clause, []).get(clause))?.push(t);
      }
      cur = pa.expression;
    }
    const out = new Map<string, ClauseSpan>();
    for (const [clause, list] of segs) {
      const ex = exprs.get(clause);
      out.set(clause, {
        span: spanFromPos(
          Math.min(...list.map((s) => s.start)),
          Math.max(...list.map((s) => s.end)),
        ),
        // Drill-in only when the clause has exactly one template (unambiguous mapping).
        expr: ex && ex.length === 1 ? ex[0] : undefined,
      });
    }
    return out;
  };

  // Record nested fields. Their generated paths mirror core's emit: object child -> `.<key>`,
  // array/set element -> `.*`, record value -> `.*`. We set spans for each; emit decides which
  // statements actually exist (e.g. trivial array elements skip `.*`), and unmatched keys are
  // simply never read.
  const recurseNested = (table: string, path: string, value: Node): void => {
    let cur: Node = value;
    while (
      ts.isCallExpression(cur) &&
      ts.isPropertyAccessExpression(cur.expression)
    ) {
      const method = cur.expression.name.text;
      const args = cur.arguments;
      if (
        method === "object" &&
        args[0] &&
        ts.isObjectLiteralExpression(args[0])
      ) {
        for (const p of args[0].properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const nm = propName(p.name);
          if (!nm) continue;
          const childPath = `${path}.${nm}`;
          map.set(`field:${table}.${childPath}`, {
            full: spanOf(p),
            clauses: walkChain(p.initializer),
          });
          recurseNested(table, childPath, p.initializer);
        }
      } else if ((method === "array" || method === "set") && args[0]) {
        const childPath = `${path}.*`;
        map.set(`field:${table}.${childPath}`, {
          full: spanOf(args[0]),
          clauses: walkChain(args[0]),
        });
        recurseNested(table, childPath, args[0]);
      } else if (method === "record" && (args[1] ?? args[0])) {
        const v = (args[1] ?? args[0]) as Node;
        const childPath = `${path}.*`;
        map.set(`field:${table}.${childPath}`, {
          full: spanOf(v),
          clauses: walkChain(v),
        });
        recurseNested(table, childPath, v);
      }
      cur = cur.expression.expression;
    }
  };

  const visit = (node: Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const fn = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      const arg0 = node.arguments[0];
      if (
        (fn === "defineTable" || fn === "defineRelation") &&
        arg0 &&
        ts.isStringLiteralLike(arg0)
      ) {
        const table = arg0.text;
        // Table head: bound the span to `defineTable("name"` so reveal lands on its line.
        map.set(`table:${table}`, {
          full: spanFromPos(node.getStart(sf), arg0.getEnd()),
          clauses: new Map(),
        });
        const arg1 = node.arguments[1];
        if (arg1 && ts.isObjectLiteralExpression(arg1)) {
          for (const prop of arg1.properties) {
            const key = prop.name;
            if (
              key &&
              (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) &&
              ts.isPropertyAssignment(prop)
            ) {
              map.set(`field:${table}.${key.text}`, {
                full: spanOf(prop),
                clauses: walkChain(prop.initializer),
              });
              recurseNested(table, key.text, prop.initializer);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return map;
}

/** Locate `value` inside `ddl` (starting at `from`) and return its span in the assembled output. */
function spanInDdl(
  ddl: string,
  baseLine: number,
  value: string,
  from: number,
): { span: Span; start: number; next: number } | null {
  const idx = ddl.indexOf(value, from);
  if (idx < 0) return null;
  const before = ddl.slice(0, idx).split("\n");
  const startLine = baseLine + before.length - 1;
  const startCol = before[before.length - 1].length + 1;
  // Clause fragments are single-line, so the end stays on the same line.
  return {
    span: {
      startLine,
      startCol,
      endLine: startLine,
      endCol: startCol + value.length,
    },
    start: idx,
    next: idx + value.length,
  };
}

/**
 * Generate SurrealQL for a schema file. When `content` is given (the unsaved editor
 * buffer), it's written to a sibling temp file and loaded from there — so live edits are
 * reflected AND sibling/`surreal-zod` imports still resolve from the project. Otherwise the
 * on-disk file is read. (jiti.evalModule on the buffer resolves a SECOND surreal-zod
 * instance — false sz.custom — so we go through a real file either way.)
 *
 * Also returns a source map (each table/field's source line <-> generated line) so the
 * editor and the preview can sync cursors precisely.
 */
export async function generateSurql(
  file: string,
  content?: string,
): Promise<CodegenResult> {
  let tmp: string | null = null;
  try {
    const { createJiti } = await import("jiti");
    let target = file;
    if (content !== undefined) {
      // Hidden sibling so relative imports resolve and the tree filter hides it.
      tmpCounter += 1;
      tmp = join(
        dirname(file),
        `.${basename(file)}.${tmpCounter}.reverie-tmp.ts`,
      );
      await writeFile(tmp, content, "utf8");
      target = tmp;
    }
    // Base jiti at the target file so `surreal-zod` + sibling imports resolve from the
    // opened project. moduleCache ON so, within THIS call, surreal-zod is evaluated once
    // and shared between the emit import below and the schema's own `import "surreal-zod"`
    // — one codec registry, so native fields aren't misread as sz.custom().
    const jiti = createJiti(pathToFileURL(target).href, {
      interopDefault: true,
      fsCache: false,
      moduleCache: true,
    });
    const sz = (await jiti.import("surreal-zod")) as {
      emitStatements: (t: unknown) => Stmt[];
      emitDefStatement: (d: unknown) => Stmt;
    };
    const mod = (await jiti.import(target)) as Record<string, unknown>;

    const tables: AnyTable[] = [];
    const defs: AnyDef[] = [];
    for (const value of Object.values(mod)) {
      if (isTableDef(value)) tables.push(value);
      else if (isStandaloneDef(value)) defs.push(value);
    }
    // Stable order: normal tables before relations, then by name (matches `sz pull`).
    const rank = (t: AnyTable) => (t.config.relation ? 1 : 0);
    tables.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    if (tables.length === 0 && defs.length === 0) {
      return { ok: true, surql: "", map: [] };
    }

    const spans = await sourceSpans(
      file,
      content ?? (await readFile(file, "utf8")),
    );
    const blocks: string[] = [];
    const map: SpanLink[] = [];
    let cursor = 1; // 1-based line of the next block in the assembled output

    const trackBlock = (stmts: Stmt[], tableName: string) => {
      let line = cursor;
      for (const s of stmts) {
        const key =
          s.kind === "table"
            ? `table:${tableName}`
            : `field:${s.table ?? tableName}.${unquote(s.name)}`;
        const fs = spans.get(key);
        if (fs) {
          const ddlLines = s.ddl.split("\n");
          const last = ddlLines[ddlLines.length - 1];
          // Whole-statement fallback: source declaration <-> the entire DDL statement.
          map.push({
            clause: "FULL",
            kind: s.kind,
            key,
            source: fs.full,
            gen: {
              startLine: line,
              startCol: 1,
              endLine: line + ddlLines.length - 1,
              endCol: last.length + 1,
            },
          });
          // Per-clause links: clauses render in `ddl` in object order, so scan left to right.
          let from = 0;
          for (const [clauseName, value] of Object.entries(s.clauses ?? {})) {
            const found = spanInDdl(s.ddl, line, value, from);
            if (!found) continue;
            from = found.next;
            const cs = fs.clauses.get(clauseName);
            if (!cs) continue;
            map.push({
              clause: clauseName,
              kind: s.kind,
              key,
              source: cs.span,
              gen: found.span,
            });
            // Drill-in: the `surql\`...\`` body <-> the inlined expression inside this clause.
            if (cs.expr) {
              const inner = spanInDdl(s.ddl, line, cs.expr.text, found.start);
              if (inner)
                map.push({
                  clause: `${clauseName}:expr`,
                  kind: s.kind,
                  key,
                  source: cs.expr.span,
                  gen: inner.span,
                });
            }
          }
        }
        line += s.ddl.split("\n").length;
      }
      const block = stmts.map((s) => s.ddl).join("\n");
      blocks.push(block);
      cursor += block.split("\n").length + 1; // +1 for the "\n\n" separator
    };

    for (const t of tables) trackBlock(sz.emitStatements(t), t.name);
    for (const d of defs) {
      const s = sz.emitDefStatement(d);
      blocks.push(s.ddl);
      cursor += s.ddl.split("\n").length + 1;
    }
    return { ok: true, surql: blocks.join("\n\n"), map };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (tmp) await unlink(tmp).catch(() => {});
  }
}
