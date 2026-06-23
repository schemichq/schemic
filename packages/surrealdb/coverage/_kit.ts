/**
 * Kit for the @schemic/surrealdb SYNTAX-COVERAGE suite.
 *
 * Same file-based pattern as the `examples/` cookbook, but EXHAUSTIVE: one real, tsc-checked `.ts` file
 * per permutation of a SurrealQL `DEFINE …` statement, so every documented clause + option is exercised
 * and pinned to the exact DDL it emits. Each item is `cover(import.meta.url, { title, note?, ddl, def,
 * options? })`; `def` is the real authoring expression (tsc-checked), `options` carries emit flags like
 * `{ exists: "overwrite" }` (→ `OVERWRITE`). `test/coverage/*` asserts `emitTable(def, options) === ddl`.
 *
 * Unlike `examples/` (a curated public gallery → the manifest), `coverage/` is an internal completeness
 * net — it is NOT vendored to the website.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DefineOptions } from "../src/ddl";
import type { TableDef } from "../src/pure";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous coverage tables — the Shape varies.
export type AnyTable = TableDef<string, any>;

/** One coverage permutation: the authoring `def` (+ optional emit `options`) and the exact DDL it emits. */
export interface CoverageItem {
  title: string;
  note?: string;
  /** The verbatim `def` snippet, extracted from the file's source. */
  code: string;
  ddl: string;
  def: AnyTable;
  /** Emit flags — e.g. `{ exists: "overwrite" }` for `DEFINE TABLE OVERWRITE …`. */
  options?: DefineOptions;
}

/** One statement's coverage — every permutation of e.g. `DEFINE TABLE`. */
export interface CoverageGroup {
  /** The statement this group covers, e.g. `"DEFINE TABLE"`. */
  syntax: string;
  items: CoverageItem[];
}

/** Advance `i` past a string/template literal starting at `src[i]` (the opening quote). */
function skipString(src: string, i: number, quote: string): number {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
      i += 2;
      let d = 1;
      while (i < src.length && d > 0) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") d--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

/** Extract the verbatim `def:` snippet from a `cover(import.meta.url, { … def: <expr> })` file (authored
 *  LAST) — a balanced-delimiter scan to its terminating `,`/closer at depth 0 (strings/templates skipped). */
function extractDefSource(src: string): string {
  const m = /\bdef:\s*/.exec(src);
  if (!m) throw new Error("coverage file has no `def:` property");
  const start = m.index + m[0].length;
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i, c);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) break;
    i++;
  }
  return src
    .slice(start, i)
    .replace(/^[ \t]*\/\/ biome-ignore.*\r?\n/gm, "")
    .trim();
}

/** Build a coverage item from a real, tsc-checked file — pass `import.meta.url` for `code` extraction. */
export function cover(
  metaUrl: string,
  e: {
    title: string;
    note?: string;
    ddl: string;
    def: AnyTable;
    options?: DefineOptions;
  },
): CoverageItem {
  return {
    title: e.title,
    note: e.note,
    code: extractDefSource(readFileSync(fileURLToPath(metaUrl), "utf8")),
    ddl: e.ddl,
    def: e.def,
    options: e.options,
  };
}

/** Assemble a statement's coverage group from its per-file permutations. */
export function coverage(syntax: string, items: CoverageItem[]): CoverageGroup {
  return { syntax, items };
}
