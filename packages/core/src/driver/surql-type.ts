// The SurrealQL type-expression <-> PortableType bridge (Milestone 2). This is the Surreal driver's
// `parseType`/`emitType`: it lifts the Struct-IR's `kind` STRING (e.g. `option<int>`,
// `array<record<user>, 3>`, `'a' | 'b'`) into the dialect-independent PortableType, and renders it
// back to the canonical SurrealQL spelling (the form `normalizeType` produces). Round-tripping
// proves the portable model is LOSSLESS for the Surreal dialect — the precondition for flipping diff
// equality to a structured deep-compare (see docs/MULTI-DB-SPIKE.md, Part 6).

import {
  array,
  literal,
  nullable,
  option,
  type PortableType,
  record,
  type ScalarName,
  scalar,
  union,
} from "./portable";

const SCALARS = new Set<string>([
  "any",
  "bool",
  "string",
  "int",
  "float",
  "decimal",
  "number",
  "datetime",
  "duration",
  "uuid",
  "bytes",
  "null",
]);

const GEOMETRY_KINDS = new Set([
  "feature",
  "point",
  "line",
  "polygon",
  "multipoint",
  "multiline",
  "multipolygon",
  "collection",
]);

/** Split a type expression on its top-level `|` (ignoring `|` inside `<…>`). */
function splitTopUnion(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of expr) {
    if (c === "<") depth++;
    else if (c === ">") depth--;
    if (c === "|" && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts;
}

/** Split `s` once on the first top-level `sep` (outside `<…>`), or null if absent. */
function topLevelSplitOnce(s: string, sep: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "<") depth++;
    else if (c === ">") depth--;
    else if (c === sep && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return null;
}

/** Parse a (single/double) quoted string literal token, or null if it isn't one. */
function parseStringLiteral(t: string): string | null {
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t.at(-1) === t[0]) {
    const body = t.slice(1, -1);
    return body.replace(/\\(['"\\])/g, "$1");
  }
  return null;
}

/**
 * Parse a SurrealQL type expression into a {@link PortableType}. Mirrors the grammar `normalizeType`
 * canonicalizes: `option<…>`, top-level unions (a `none` member ⇒ `option`, a `null` member ⇒
 * `nullable`), `array`/`set`/`record`/`references` constructors, literals, and scalars.
 */
export function parseSurqlType(kind: string): PortableType {
  const t = kind.trim();

  // option<X>
  const opt = /^option<([\s\S]+)>$/.exec(t);
  if (opt) return option(parseSurqlType(opt[1]));

  // Top-level union: peel `none` (absence) and `null` (null) markers, recurse on the rest.
  const parts = splitTopUnion(t);
  if (parts.length > 1) {
    const hasNone = parts.includes("none");
    const hasNull = parts.includes("null");
    const rest = parts.filter((p) => p !== "none" && p !== "null");
    let inner: PortableType =
      rest.length === 0 ? { t: "never" } : union(rest.map(parseSurqlType));
    if (hasNull) inner = nullable(inner);
    if (hasNone) inner = option(inner);
    return inner;
  }

  // Constructor term `ctor<inner>`. `references<…>` (rare) is kept as a Surreal-native escape hatch
  // so it round-trips losslessly rather than collapsing into `record<…>`.
  const ctor = /^(array|set|record)<([\s\S]+)>$/.exec(t);
  if (ctor) {
    const [, name, innerRaw] = ctor;
    if (name === "array" || name === "set") {
      const comma = topLevelSplitOnce(innerRaw, ",");
      const elem = parseSurqlType(comma ? comma[0] : innerRaw);
      const size = comma ? Number(comma[1].trim()) : undefined;
      return name === "array"
        ? array(elem, Number.isFinite(size) ? size : undefined)
        : { t: "set", elem, ...(Number.isFinite(size) ? { size } : {}) };
    }
    // record<…>: a `|`-list of target tables.
    const tables = innerRaw
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    return record(tables);
  }

  // geometry<point> etc.
  const geo = /^geometry<([a-z]+)>$/.exec(t);
  if (geo && GEOMETRY_KINDS.has(geo[1])) {
    return { t: "geometry", kind: geo[1] as never };
  }

  // Literals: quoted string, number, boolean.
  const str = parseStringLiteral(t);
  if (str !== null) return literal(str);
  if (/^-?\d+(\.\d+)?$/.test(t)) return literal(Number(t));
  if (t === "true" || t === "false") return literal(t === "true");

  // Scalars (incl. `null` as a unit type). `none` standalone ⇒ option<never>. `object` ⇒ empty object.
  if (t === "none") return option({ t: "never" });
  if (t === "object") return { t: "object", fields: {} };
  if (SCALARS.has(t)) return scalar(t as ScalarName);

  // Unknown: keep it as a Surreal-native escape hatch rather than losing information.
  return { t: "native", db: "surreal", name: t };
}

/** Render a {@link PortableType} back to its canonical SurrealQL spelling (matches `normalizeType`). */
export function emitSurqlType(p: PortableType): string {
  switch (p.t) {
    case "scalar":
      return p.name;
    case "literal":
      return typeof p.value === "string"
        ? `'${p.value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`
        : String(p.value);
    case "option":
      return `option<${emitSurqlType(p.inner)}>`;
    case "nullable": {
      // Canonical: a sorted top-level union with `null` (matches normalizeType, which sorts members
      // and does not special-case null). `null` sorts before any scalar/ctor name.
      const inner = emitSurqlType(p.inner);
      return [inner, "null"].sort().join(" | ");
    }
    case "array":
      return p.size !== undefined
        ? `array<${emitSurqlType(p.elem)}, ${p.size}>`
        : `array<${emitSurqlType(p.elem)}>`;
    case "set":
      return p.size !== undefined
        ? `set<${emitSurqlType(p.elem)}, ${p.size}>`
        : `set<${emitSurqlType(p.elem)}>`;
    case "union":
      return [...p.members.map(emitSurqlType)].sort().join(" | ");
    case "object":
      return "object";
    case "record":
      return `record<${[...p.tables].sort().join(" | ")}>`;
    case "geometry":
      return `geometry<${p.kind}>`;
    case "never":
      return "none";
    case "native":
      return p.name;
  }
}
