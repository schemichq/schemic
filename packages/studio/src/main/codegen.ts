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

/** One source<->generated link: a table/field's line in the .ts and in the generated SQL. */
export interface SourceMapEntry {
  kind: string;
  name: string;
  sourceLine: number;
  genLine: number;
}

export interface CodegenResult {
  ok: boolean;
  surql?: string;
  error?: string;
  /** Per-statement line links (1-based) for cursor sync. */
  map?: SourceMapEntry[];
}

type Stmt = { kind: string; name: string; table?: string; ddl: string };

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

const unquote = (s: string) => s.replace(/^`|`$/g, "");

/**
 * Parse the schema source for the 1-based declaration line of each table + top-level field,
 * keyed `table:<name>` / `field:<table>.<name>` — for cursor sync. Uses the TS compiler API
 * (already a dep for the LSP); nested fields aren't mapped (they fall back to no sync).
 */
async function sourceLines(
  file: string,
  text: string,
): Promise<Map<string, number>> {
  const ts = await import("typescript");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const map = new Map<string, number>();
  const lineOf = (n: import("typescript").Node) =>
    sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: import("typescript").Node) => {
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
        map.set(`table:${table}`, lineOf(node));
        const arg1 = node.arguments[1];
        if (arg1 && ts.isObjectLiteralExpression(arg1)) {
          for (const prop of arg1.properties) {
            const key = prop.name;
            if (key && (ts.isIdentifier(key) || ts.isStringLiteralLike(key))) {
              map.set(`field:${table}.${key.text}`, lineOf(prop));
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

    const src = await sourceLines(
      file,
      content ?? (await readFile(file, "utf8")),
    );
    const blocks: string[] = [];
    const map: SourceMapEntry[] = [];
    let cursor = 1; // 1-based line of the next block in the assembled output

    const trackBlock = (stmts: Stmt[], tableName: string) => {
      let line = cursor;
      for (const s of stmts) {
        const key =
          s.kind === "table"
            ? `table:${tableName}`
            : `field:${s.table ?? tableName}.${unquote(s.name)}`;
        const sourceLine = src.get(key);
        if (sourceLine !== undefined)
          map.push({ kind: s.kind, name: s.name, genLine: line, sourceLine });
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
