/**
 * The SurrealQL FORMATTER for generated code — `sc pull` receives bodies from INFO collapsed to a
 * single line; this pretty-prints them (statement-per-line, indented nested blocks, wide object
 * literals one-entry-per-line) so pulled schema files read like hand-written ones. Purely
 * whitespace: `normalize` canonicalizes formatting on both sides of every compare, so formatted
 * output can never phantom-diff. Exported from `@schemic/surrealdb/driver` (display panes,
 * tooling) as {@link formatSurql}.
 */

/** Statement openers — a brace region starting with one (or containing a top-level `;`) is a
 *  STATEMENT BLOCK (multi-line); anything else in braces is an object literal. */
const STMT_KW =
  /^(?:LET|IF|FOR|RETURN|THROW|SELECT|CREATE|UPDATE|UPSERT|DELETE|RELATE|INSERT|DEFINE|REMOVE|BREAK|CONTINUE|SLEEP|BEGIN|COMMIT|CANCEL)\b/i;

interface Opts {
  /** One indentation step (default two spaces). */
  indent?: string;
  /** Wrap object/array literals longer than this rendered width (default 72). */
  width?: number;
}

/** Scan past a string literal starting at `i` (quote char at `text[i]`); returns the index AFTER
 *  the closing quote. */
function skipString(text: string, i: number): number {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === quote) return j + 1;
  }
  return text.length;
}

/** The index of the bracket matching `text[open]` (quote-aware), or -1. */
function matchBracket(text: string, open: number): number {
  const pairs: Record<string, string> = { "{": "}", "[": "]", "(": ")" };
  const close = pairs[text[open] as string] as string;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === (text[open] as string)) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return -1;
}

/** Split on a top-level separator (outside strings/brackets). */
function topSplit(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'") i = skipString(text, i) - 1;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Collapse whitespace runs outside strings (the formatter's canonical input form). */
function collapse(text: string): string {
  let out = "";
  let pending = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (c === '"' || c === "'") {
      const j = skipString(text, i);
      if (pending && out.length) out += " ";
      pending = false;
      out += text.slice(i, j);
      i = j - 1;
      continue;
    }
    if (/\s/.test(c)) {
      pending = out.length > 0;
      continue;
    }
    if (pending) out += " ";
    pending = false;
    out += c;
  }
  return out;
}

/** Is this brace-INTERIOR a statement block (vs an object literal)? */
function isBlockBody(inner: string): boolean {
  const t = inner.trim();
  if (t === "") return false;
  if (STMT_KW.test(t)) return true;
  return topSplit(t, ";").length > 1 || /;\s*$/.test(t) || t.includes(";");
}

/** Render one STATEMENT: nested statement blocks always expand (brace on the same line, body
 *  indented); when the line is too wide, the LAST top-level CALL's arguments break one per line
 *  (prettier-style, trailing comma), and wide object/array literals wrap one entry per line.
 *  Recursion applies the same rules inside broken arguments. */
function fmtStatement(
  stmt: string,
  level: number,
  indent: string,
  width: number,
): string {
  const fits = indent.repeat(level).length + stmt.length <= width;
  // The break target: the LAST top-level call group with 2+ args, chosen only when too wide.
  // A `DEFINE …` head never breaks — its parens are a SIGNATURE (`fn::f($a: string, $b: int)`),
  // not a call; the body block inside still formats via the block recursion.
  let breakAt = -1;
  if (!fits && !/^DEFINE\b/i.test(stmt.trim())) {
    for (let i = 0; i < stmt.length; i++) {
      const c = stmt[i] as string;
      if (c === '"' || c === "'") {
        i = skipString(stmt, i) - 1;
        continue;
      }
      if (c === "(" && /[A-Za-z0-9_:]/.test(stmt[i - 1] ?? "")) {
        const end = matchBracket(stmt, i);
        if (end === -1) continue;
        if (topSplit(stmt.slice(i + 1, end), ",").length >= 2) breakAt = i;
        i = end;
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        const end = matchBracket(stmt, i);
        if (end !== -1) i = end;
      }
    }
  }
  let out = "";
  for (let i = 0; i < stmt.length; i++) {
    const c = stmt[i] as string;
    if (c === '"' || c === "'") {
      const j = skipString(stmt, i);
      out += stmt.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === "(" && i === breakAt) {
      const end = matchBracket(stmt, i);
      const args = topSplit(stmt.slice(i + 1, end), ",");
      const pad = indent.repeat(level + 1);
      out += `(\n${args
        .map((a) => `${pad}${fmtStatement(a, level + 1, indent, width)},`)
        .join("\n")}\n${indent.repeat(level)})`;
      i = end;
      continue;
    }
    if (c === "{") {
      const end = matchBracket(stmt, i);
      if (end === -1) {
        out += c;
        continue;
      }
      const inner = stmt.slice(i + 1, end).trim();
      if (isBlockBody(inner)) {
        out += `{\n${fmtStatements(inner, level + 1, indent, width)}\n${indent.repeat(level)}}`;
      } else {
        out += fmtData(stmt.slice(i, end + 1), level, indent, width);
      }
      i = end;
      continue;
    }
    out += c;
  }
  return out;
}

/** Render an object/array literal: inline when it fits, one entry per line when wide. */
function fmtData(
  text: string,
  level: number,
  indent: string,
  width: number,
): string {
  const open = text[0] as string;
  const close = text[text.length - 1] as string;
  const inner = text.slice(1, -1).trim();
  if (inner === "") return text;
  const entries = topSplit(inner, ",").map((e) =>
    // entry VALUES may nest further data/blocks
    fmtStatement(e, level + 1, indent, width),
  );
  const spaced = open === "{" ? `{ ${entries.join(", ")} }` : `[${entries.join(", ")}]`;
  if (
    indent.repeat(level).length + spaced.length <= width &&
    !spaced.includes("\n")
  )
    return spaced;
  const pad = indent.repeat(level + 1);
  // Prettier-style trailing comma — normalize strips trailing commas on compare.
  return `${open}\n${entries.map((e) => `${pad}${e},`).join("\n")}\n${indent.repeat(level)}${close}`;
}

/** Render a `;`-separated statement list, one per line at `level`. */
function fmtStatements(
  body: string,
  level: number,
  indent: string,
  width: number,
): string {
  const pad = indent.repeat(level);
  return topSplit(body, ";")
    .map((s) => `${pad}${fmtStatement(s, level, indent, width)};`)
    .join("\n");
}

/**
 * Pretty-print SurrealQL: a `{ … }` block or `;`-separated statement list becomes
 * statement-per-line with indented nested blocks; wide object/array literals wrap. Single short
 * expressions come back unchanged (safe to apply everywhere). Idempotent — the input is
 * whitespace-collapsed first, so `formatSurql(formatSurql(x)) === formatSurql(x)`.
 */
export function formatSurql(text: string, opts: Opts = {}): string {
  const indent = opts.indent ?? "  ";
  const width = opts.width ?? 72;
  const t = collapse(text.trim());
  if (t.startsWith("{") && matchBracket(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1).trim();
    if (isBlockBody(inner))
      return `{\n${fmtStatements(inner, 1, indent, width)}\n}`;
    return fmtData(t, 0, indent, width);
  }
  if (topSplit(t, ";").length > 1)
    return fmtStatements(t, 0, indent, width).replace(/^\s+/, "");
  return fmtStatement(t, 0, indent, width);
}
