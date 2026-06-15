import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { formatForAssert } from "@schemic/core";
import type { Surreal } from "surrealdb";
import type { ResolvedConfig } from "./config";
import { type Filter, filterStructured, parseFilter } from "./filter";
import { type LocalOnly, mergeUnits, type RenderedUnit } from "./merge";
import { existingTables, scanLocalEntities } from "./schema";
import {
  type DbStructured,
  introspectStructured,
  type StructAccess,
  type StructField,
  type StructFunction,
  type StructPerm,
  type StructPermissions,
  type StructTable,
} from "./structure";

/** The field clauses pull reverses into `s.*` chains (sourced from `INFO … STRUCTURE`). */
interface ParsedField {
  type: string;
  default?: string;
  defaultAlways?: boolean;
  value?: string;
  computed?: string;
  assert?: string;
  readonly?: boolean;
  comment?: string;
  flexible?: boolean;
  permissions?: StructPermissions;
}

/** A single permission op as a `.permissions()` argument value (`true`/`false`/a `surql` WHERE). */
function permValue(v: StructPerm | undefined): string {
  if (v === true) return "true";
  if (v === false || v === undefined) return "false";
  return `surql\`${v}\``;
}

/**
 * The `.permissions(...)` / `.$permissions(...)` argument for a structured permission set, or null
 * to omit it (when it matches the default: FULL for fields, NONE for tables). Collapses all-FULL →
 * `true`, all-NONE → `false`, and one shared `WHERE` across every op → a single `surql` expr.
 */
function renderPerms(
  perms: StructPermissions | undefined,
  ops: (keyof StructPermissions)[],
  defaultFull: boolean,
): string | null {
  if (!perms) return null;
  const vals = ops.map((op) => perms[op]);
  const allTrue = vals.every((v) => v === true);
  const allFalse = vals.every((v) => v === false || v === undefined);
  if (defaultFull ? allTrue : allFalse) return null; // matches the default
  if (allTrue) return "true";
  if (allFalse) return "false";
  if (vals.every((v) => typeof v === "string") && new Set(vals).size === 1) {
    return `surql\`${vals[0]}\``; // one WHERE shared by every op
  }
  return `{ ${ops.map((op) => `${op}: ${permValue(perms[op])}`).join(", ")} }`;
}

/**
 * The bare field path — STRUCTURE backtick-escapes reserved-word segments (`` `value` ``), so we
 * strip them; `ident()` re-quotes only what TS needs, and emit re-escapes for SurrealQL (avoids
 * double-escaping the name).
 */
function unescapeName(name: string): string {
  return name
    .split(".")
    .map((seg) => seg.replace(/^`([\s\S]*)`$/, "$1"))
    .join(".");
}

/** Map a structured field (from STRUCTURE) to the clause bag `renderField` consumes. */
function toParsed(f: StructField): ParsedField {
  return {
    type: f.kind,
    default: f.default,
    defaultAlways: f.default_always,
    value: f.value,
    computed: f.computed,
    assert: f.assert,
    readonly: f.readonly,
    comment: f.comment,
    flexible: f.flexible,
    permissions: f.permissions,
  };
}

// --- Cross-table reference resolution (imports / self-refs / relation endpoints) -------------

const pascal = (name: string) =>
  name
    .replace(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/[^A-Za-z0-9]/g, "");

/** All `record<…>` target table names in a type expression (handles option/array/union nesting). */
function recordTargets(kind: string): string[] {
  const out: string[] = [];
  const re = /record<([^>]+)>/g;
  let m: RegExpExecArray | null = re.exec(kind);
  while (m) {
    for (const t of m[1].split("|")) out.push(t.trim());
    m = re.exec(kind);
  }
  return out;
}

/** The pulled tables a table points at: `record<…>` field targets + relation endpoints. */
function tableRefs(t: StructTable, pulled: Set<string>): Set<string> {
  const out = new Set<string>();
  const add = (n: string) => {
    if (pulled.has(n)) out.add(n);
  };
  for (const f of t.fields) for (const tgt of recordTargets(f.kind)) add(tgt);
  if (t.kind.kind === "RELATION") {
    for (const n of t.kind.in ?? []) add(n);
    for (const n of t.kind.out ?? []) add(n);
  }
  return out;
}

/** Everything reachable from `start` in the reference graph (excluding `start` itself). */
function reachable(
  graph: Map<string, Set<string>>,
  start: string,
): Set<string> {
  const seen = new Set<string>();
  const stack = [...(graph.get(start) ?? [])];
  while (stack.length) {
    const n = stack.pop();
    if (n === undefined || seen.has(n)) continue;
    seen.add(n);
    for (const m of graph.get(n) ?? []) stack.push(m);
  }
  return seen;
}

/** How a `record<target>` / endpoint reference should be expressed in the generated code. */
type RefKind = "self" | "direct" | "string";

/** Per-table render context: resolves references and accumulates the imports they need. */
interface RenderCtx {
  table: string;
  /** Imported table names (→ value imports of their `const`). */
  imports: Set<string>;
  /** Set when a `record<self>` field used the callback `self` parameter. */
  usesSelf: boolean;
  /** Whether the `self` callback is available (only `defineTable`, not `defineRelation`). */
  allowSelf: boolean;
  /** PascalCase const name for a table. */
  constOf: (name: string) => string;
  /** Resolve a reference from this table to `target`. */
  resolve: (target: string) => RefKind;
}

function makeResolver(graph: Map<string, Set<string>>, pulled: Set<string>) {
  const cache = new Map<string, Set<string>>();
  const reach = (n: string) => {
    let r = cache.get(n);
    if (!r) {
      r = reachable(graph, n);
      cache.set(n, r);
    }
    return r;
  };
  return (from: string, target: string): RefKind => {
    if (target === from) return "self";
    if (!pulled.has(target)) return "string"; // not pulled — can't import it
    return reach(target).has(from) ? "string" : "direct"; // cycle → string, else import
  };
}

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

/** Parse a SurrealQL literal token (`'a'`, `"a"`, `42`, `true`) to its JS value, else null. */
function parseLiteral(s: string): { value: string | number | boolean } | null {
  const t = s.trim();
  const q = /^'((?:\\.|[^'])*)'$/.exec(t) ?? /^"((?:\\.|[^"])*)"$/.exec(t);
  if (q) return { value: q[1] };
  if (/^-?\d+$/.test(t)) return { value: Number.parseInt(t, 10) };
  if (/^-?\d+\.\d+$/.test(t)) return { value: Number.parseFloat(t) };
  if (t === "true" || t === "false") return { value: t === "true" };
  return null;
}

/** Render a `record<…>` reference, using imports / `self` / a string fallback per `ctx`. */
function renderRecord(targetsRaw: string, ctx?: RenderCtx): string {
  const targets = targetsRaw.split("|").map((s) => s.trim());
  if (ctx && targets.length === 1) {
    const kind = ctx.resolve(targets[0]);
    if (kind === "self" && ctx.allowSelf) {
      ctx.usesSelf = true;
      return "self";
    }
    if (kind === "direct") {
      ctx.imports.add(targets[0]);
      return `${ctx.constOf(targets[0])}.record()`;
    }
  }
  const arg =
    targets.length === 1
      ? JSON.stringify(targets[0])
      : `[${targets.map((t) => JSON.stringify(t)).join(", ")}]`;
  return `s.recordId(${arg})`;
}

/** Map a SurrealQL type to an `s.*` expression (`ctx` resolves `record<…>` references). */
function szType(type: string, ctx?: RenderCtx): string {
  const t = type.trim();
  // option<X> and the `none | X` form the DB reports.
  const opt = /^option<(.+)>$/.exec(t);
  if (opt) return `${szType(opt[1], ctx)}.optional()`;
  if (/(^|\|)\s*none\s*(\||$)/.test(t)) {
    const inner = t.replace(/\s*\|?\s*none\s*\|?\s*/g, "").trim();
    return `${szType(inner || "any", ctx)}.optional()`;
  }
  const nullable = /^(.+?)\s*\|\s*null$/.exec(t);
  if (nullable) return `${szType(nullable[1], ctx)}.nullable()`;

  const arr = /^array<(.+)>$/.exec(t);
  if (arr) return `${szType(arr[1], ctx)}.array()`;
  const set = /^set<(.+)>$/.exec(t);
  if (set) return `s.set(${szType(set[1], ctx)})`;
  const rec = /^record<(.+?)>$/.exec(t);
  if (rec) return renderRecord(rec[1], ctx);

  // Literal unions: `'a' | 'b'` -> s.enum (all strings) or a union of literals; lone -> s.literal.
  const lits = splitTopUnion(t).map(parseLiteral);
  if (lits.length && lits.every((l) => l !== null)) {
    const vals = lits.map(
      (l) => (l as { value: string | number | boolean }).value,
    );
    if (vals.length === 1) return `s.literal(${JSON.stringify(vals[0])})`;
    if (vals.every((v) => typeof v === "string"))
      return `s.enum([${vals.map((v) => JSON.stringify(v)).join(", ")}])`;
    return `s.union([${vals.map((v) => `s.literal(${JSON.stringify(v)})`).join(", ")}])`;
  }

  // Native types carrying a `<kind>` parameter (e.g. `geometry<point>`).
  const geo = /^geometry(?:<(\w+)>)?$/.exec(t);
  if (geo)
    return geo[1] ? `s.geometry(${JSON.stringify(geo[1])})` : "s.geometry()";

  switch (t) {
    case "string":
      return "s.string()";
    case "file":
      return "s.file()";
    case "int":
      return "s.int()";
    case "float":
      return "s.float()";
    case "number":
      return "s.number()";
    case "bool":
      return "s.boolean()";
    case "datetime":
      return "s.datetime()";
    case "uuid":
      return "s.uuid()";
    case "decimal":
      return "s.decimal()";
    case "duration":
      return "s.duration()";
    case "bytes":
      return "s.bytes()";
    case "object":
      return "s.object({})";
    case "any":
      return "s.any()";
    default:
      return `s.any() /* ${t} */`;
  }
}

interface FieldNode {
  parsed?: ParsedField;
  children: Map<string, FieldNode>;
}

/** Build a nested tree from dotted field paths (`settings.theme`, `tags.*`). */
function fieldTree(fields: { name: string; parsed: ParsedField }[]): FieldNode {
  const root: FieldNode = { children: new Map() };
  for (const f of fields) {
    let node = root;
    for (const seg of f.name.split(".")) {
      let child = node.children.get(seg);
      if (!child) {
        child = { children: new Map() };
        node.children.set(seg, child);
      }
      node = child;
    }
    node.parsed = f.parsed;
  }
  return root;
}

/**
 * Strip optionality/nullability wrappers, reporting which were present. Handles both
 * `option<X>` and the `X | none` form SurrealDB's `INFO` reports, plus `X | null`.
 */
function unwrapType(type: string): {
  base: string;
  optional: boolean;
  nullable: boolean;
} {
  let t = type.trim();
  let optional = false;
  let nullable = false;
  const opt = /^option<(.+)>$/.exec(t);
  if (opt) {
    optional = true;
    t = opt[1].trim();
  }
  // `X | none` / `none | X` — SurrealDB's normalized form of `option<X>`.
  if (/(^|\|)\s*none\s*(\||$)/.test(t)) {
    optional = true;
    t = t.replace(/\s*\|?\s*none\s*\|?\s*/g, "").trim();
  }
  const nul = /^(.+?)\s*\|\s*null$/.exec(t);
  if (nul) {
    nullable = true;
    t = nul[1].trim();
  }
  return { base: t, optional, nullable };
}

/** Render an `s.*` expression for a field node, recursing into nested objects/array elements. */
function renderField(node: FieldNode, indent: string, ctx?: RenderCtx): string {
  const p = node.parsed;
  const objChildren = [...node.children].filter(([k]) => k !== "*");
  const star = node.children.get("*");
  const wrap = p ? unwrapType(p.type) : null;
  // A `string` field whose ASSERT is exactly a baked `string::is_<fmt>($value)` round-trips back to
  // the format builder (`s.email()`, …) — the assert is the only signal, and it's dropped below
  // since the builder re-bakes it. Combined/extra asserts don't match, so they stay `string` + assert.
  const fmt = p?.assert !== undefined ? formatForAssert(p.assert) : undefined;
  let expr: string;
  if (p && wrap?.base === "object") {
    // Rebuild s.object from dotted children (empty if none) — even when wrapped in
    // option<…>/| null, so optional/nullable/flexible nested objects keep their shape.
    const inner = objChildren.length
      ? `{\n${objChildren
          .map(
            ([k, c]) =>
              `${indent}  ${ident(k)}: ${renderField(c, `${indent}  `, ctx)},`,
          )
          .join("\n")}\n${indent}}`
      : "{}";
    expr = `s.object(${inner})`;
    if (p.flexible) expr += ".loose()"; // FLEXIBLE — accepts arbitrary keys
    if (wrap.nullable) expr += ".nullable()";
    if (wrap.optional) expr += ".optional()";
  } else if (p && star && /^(array|set)\b/.test(wrap?.base ?? "")) {
    // Any array/set: the element's full structure (incl. nested sub-fields) lives in the `*`
    // child — fold it into `<elem>.array()` / `s.set(<elem>)`. This beats parsing the element
    // type from the parent kind, which would lose the element's sub-fields.
    const elem = renderField(star, indent, ctx);
    expr = /^set\b/.test(wrap?.base ?? "")
      ? `s.set(${elem})`
      : `${elem}.array()`;
    if (wrap?.nullable) expr += ".nullable()";
    if (wrap?.optional) expr += ".optional()";
  } else if (p && wrap?.base === "string" && fmt) {
    expr = `s.${fmt}()`;
    if (wrap.nullable) expr += ".nullable()";
    if (wrap.optional) expr += ".optional()";
  } else if (!p) {
    expr = "s.any()";
  } else {
    expr = szType(p.type, ctx);
  }

  if (p) {
    if (p.default !== undefined) {
      // A bare literal (false/42/"x") round-trips as a plain JS value the `s` API accepts directly;
      // only non-literal expressions (time::now(), …) need the `surql` tag. Wrapping literals in
      // `surql` would churn hand-authored `.$default(false)` into `.$default(surql\`false\`)`.
      const method = p.defaultAlways ? "$defaultAlways" : "$default";
      const lit = parseLiteral(p.default);
      expr += `.${method}(${lit ? JSON.stringify(lit.value) : `surql\`${p.default}\``})`;
    }
    if (p.value !== undefined) expr += `.$value(surql\`${p.value}\`)`;
    if (p.computed !== undefined) expr += `.$computed(surql\`${p.computed}\`)`;
    // The format builder re-bakes its `string::is_<fmt>` assert, so drop it when we reversed one.
    if (p.assert !== undefined && !fmt)
      expr += `.$assert(surql\`${p.assert}\`)`;
    if (p.readonly) expr += ".$readonly()";
    if (p.comment) expr += `.$comment(${JSON.stringify(p.comment)})`;
    const perm = renderPerms(
      p.permissions,
      ["select", "create", "update"],
      true,
    );
    if (perm) expr += `.$permissions(${perm})`;
  }
  return expr;
}

/** A safe object-key: a bare identifier, or a quoted string. */
function ident(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Resolve a relation endpoint set to `.from`/`.to` args (imported consts) — or null if any can't be. */
function wireEndpoints(names: string[], ctx: RenderCtx): string | null {
  if (!names.length) return null;
  const resolved = names.map((n) => {
    const kind = ctx.resolve(n);
    if (kind === "direct") {
      ctx.imports.add(n);
      return ctx.constOf(n);
    }
    if (kind === "self") return ctx.constOf(ctx.table);
    return null; // not pulled / cyclic → can't pass a string to .from/.to
  });
  if (resolved.some((r) => r === null)) return null;
  return resolved.length === 1
    ? (resolved[0] as string)
    : `[${resolved.join(", ")}]`;
}

/** Render just the `export const … = define…(…);` for one table (no import lines). */
function renderTableConst(
  t: StructTable,
  ctx: RenderCtx,
): { code: string; factory: string } {
  const isRelation = t.kind.kind === "RELATION";
  const fields = t.fields.map((f) => ({
    name: unescapeName(f.name),
    parsed: toParsed(f),
  }));
  const tree = fieldTree(fields);
  const fieldLines = [...tree.children]
    .filter(([k]) => k !== "id" && k !== "in" && k !== "out")
    .map(([k, node]) => `  ${ident(k)}: ${renderField(node, "  ", ctx)},`)
    .join("\n");

  const name = ctx.constOf(t.name);
  const factory = isRelation ? "defineRelation" : "defineTable";
  // A `record<self>` field needs the callback shape so `self` is in scope.
  const head = ctx.usesSelf
    ? `export const ${name} = ${factory}(${JSON.stringify(t.name)}, (self) => ({`
    : `export const ${name} = ${factory}(${JSON.stringify(t.name)}, {`;
  const open = ctx.usesSelf ? "}))" : "})";

  const body: string[] = [head];
  if (!isRelation) body.push(`  id: s.string(),`);
  body.push(fieldLines);

  let close = open;
  if (isRelation) {
    const from = wireEndpoints(t.kind.in ?? [], ctx);
    const to = wireEndpoints(t.kind.out ?? [], ctx);
    if (from) close += `\n  .from(${from})`;
    if (to) close += `\n  .to(${to})`;
  } else if (t.kind.kind === "ANY") {
    close += `\n  .typeAny()`;
  }
  // Common table config (applies to tables and relations alike).
  if (!t.schemafull) close += `\n  .schemaless()`;
  if (t.comment) close += `\n  .comment(${JSON.stringify(t.comment)})`;
  const tperm = renderPerms(
    t.permissions,
    ["select", "create", "update", "delete"],
    false,
  );
  if (tperm) close += `\n  .permissions(${tperm})`;
  if (t.changefeed) {
    const incl = t.changefeed.original ? ", { includeOriginal: true }" : "";
    close += `\n  .changefeed(${JSON.stringify(t.changefeed.expiry)}${incl})`;
  }
  for (const idx of t.indexes) {
    const cols = idx.cols.map((c) => JSON.stringify(c)).join(", ");
    const opts =
      idx.index === "UNIQUE"
        ? ", { unique: true }"
        : idx.index === "COUNT"
          ? ", { count: true }"
          : "";
    close += `\n  .index(${JSON.stringify(idx.name)}, [${cols}]${opts})`;
  }
  for (const ev of t.events) {
    // Drop a `WHEN true` (SurrealDB's stored form of an omitted WHEN). Author bodies as `surql\`…\``.
    const when =
      ev.when !== undefined && ev.when !== "true"
        ? `when: surql\`${ev.when}\`, `
        : "";
    const then =
      ev.then.length === 1
        ? `surql\`${ev.then[0]}\``
        : `[${ev.then.map((e) => `surql\`${e}\``).join(", ")}]`;
    close += `\n  .event(${JSON.stringify(ev.name)}, { ${when}then: ${then} })`;
  }
  body.push(`${close};`);

  return { code: body.join("\n"), factory };
}

/** Assemble a single-object module (imports + the const) for the directory layout. */
function unitModule(u: RenderedUnit): string {
  return `${u.imports.join("\n")}\n\n${u.code}\n`;
}

/** The rendered unit (const statement + the imports it needs) for one table/relation. */
function tableUnit(t: StructTable, ctx: RenderCtx): RenderedUnit {
  const { code, factory } = renderTableConst(t, ctx);
  const imports = [`import { s, ${factory} } from "@schemic/core";`];
  // Cross-table value imports (one per referenced table, sorted, self excluded).
  for (const dep of [...ctx.imports].filter((d) => d !== t.name).sort()) {
    imports.push(`import { ${ctx.constOf(dep)} } from "./${dep}";`);
  }
  // `surql` lives in surrealdb (where hand-authored files import it from) — a separate line, never
  // folded into the @schemic/core import (which would reprint/reorder that import on every pull).
  if (code.includes("surql`"))
    imports.push(`import { surql } from "surrealdb";`);
  return {
    kind: "table",
    name: t.name,
    exportName: ctx.constOf(t.name),
    code,
    imports,
  };
}

/** A const name for a function — `fn.name` sanitized to an identifier (`math::add` → `math_add`). */
function fnConst(name: string): string {
  const id = name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[A-Za-z]/.test(id) ? id : `fn_${id}`;
}

/** Reverse a `StructFunction` into a `defineFunction(name, args).returns(…).body(…)…` const. */
function renderFunctionConst(fn: StructFunction): string {
  const args = fn.args.map(([n, t]) => `${ident(n)}: ${szType(t)}`).join(", ");
  let code = `export const ${fnConst(fn.name)} = defineFunction(${JSON.stringify(fn.name)}, { ${args} })`;
  if (fn.returns !== undefined) code += `\n  .returns(${szType(fn.returns)})`;
  code += `\n  .body(surql\`${fn.block}\`)`;
  if (fn.permissions === false) code += `\n  .permissions(false)`;
  else if (typeof fn.permissions === "string")
    code += `\n  .permissions(surql\`${fn.permissions}\`)`;
  if (fn.comment !== undefined)
    code += `\n  .comment(${JSON.stringify(fn.comment)})`;
  return `${code};`;
}

/** Reverse a `StructAccess` into a `defineAccess(name).<type>(…)…` const. Signing keys are NOT recovered. */
function renderAccessConst(a: StructAccess): string {
  const k = a.kind;
  const v = k.jwt?.verify;
  // A signing key is present (and redacted) for everything except JWT-via-JWKS-URL.
  const hasRedactedKey = !(k.kind === "JWT" && v?.url);
  const lines: string[] = [];
  if (hasRedactedKey)
    lines.push(
      "// NOTE: signing key not pulled (SurrealDB redacts it) — re-applying rotates it.",
    );
  let head = `export const ${fnConst(a.name)} = defineAccess(${JSON.stringify(a.name)})`;
  if (k.kind === "BEARER") {
    head += `\n  .bearer({ for: ${JSON.stringify((k.subject ?? "record").toLowerCase())} })`;
  } else if (k.kind === "JWT") {
    head += v?.url
      ? `\n  .jwt({ url: ${JSON.stringify(v.url)} })`
      : `\n  .jwt({ alg: ${JSON.stringify(v?.alg ?? "HS512")} /* key not pulled */ })`;
  } else {
    head += `\n  .record()`;
  }
  lines.push(head);
  if (k.kind === "RECORD") {
    if (k.signup) lines.push(`  .signup(surql\`${k.signup}\`)`);
    if (k.signin) lines.push(`  .signin(surql\`${k.signin}\`)`);
    if (k.authenticate)
      lines.push(`  .authenticate(surql\`${k.authenticate}\`)`);
  }
  const d = a.duration;
  if (d?.grant || d?.token || d?.session) {
    const obj = [
      d.grant && `grant: ${JSON.stringify(d.grant)}`,
      d.token && `token: ${JSON.stringify(d.token)}`,
      d.session && `session: ${JSON.stringify(d.session)}`,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`  .duration({ ${obj} })`);
  }
  return `${lines.join("\n")};`;
}

/** Topologically sort so a table comes after every same-file table it references (deps first). */
function topoSort<T extends { name: string; deps: string[] }>(items: T[]): T[] {
  const byName = new Map(items.map((it) => [it.name, it]));
  const out: T[] = [];
  const done = new Set<string>();
  const onStack = new Set<string>();
  const visit = (it: T) => {
    if (done.has(it.name) || onStack.has(it.name)) return;
    onStack.add(it.name);
    for (const dep of it.deps) {
      const d = byName.get(dep);
      if (d) visit(d);
    }
    onStack.delete(it.name);
    done.add(it.name);
    out.push(it);
  };
  for (const it of items) visit(it);
  return out;
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

export interface PullPlan {
  files: PullFilePlan[];
}

const EMPTY_LOCAL: LocalOnly = { fields: [], objects: [] };

/**
 * Build the per-file pull plan: introspect the live DB (via `INFO … STRUCTURE`) and compute what
 * each schema file would become. Nothing is written — {@link applyPull} does that. Existing files
 * are *merged* (the DB wins per object/field, but unrelated code, comments, and local-only content
 * survive); new files are created. `keepLocal` keeps local-only fields/objects instead of mirroring.
 */
export async function planPull(
  db: Surreal,
  config: ResolvedConfig,
  opts: { filter?: Filter; keepLocal?: boolean } = {},
): Promise<PullPlan> {
  const introspected = await introspectStructured(
    db,
    new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
  );
  const { tables, functions, accesses } = filterStructured(
    introspected,
    opts.filter ?? parseFilter({}),
  );

  const makeCtx = ctxFactory(tables);
  const keepLocal = opts.keepLocal ?? false;

  // Single-file layout: one combined module.
  if (config.schemaIsFile) {
    const units = [
      ...tables.map((t) => tableUnit(t, makeCtx(t))),
      ...functions.map(functionUnit),
      ...accesses.map(accessUnit),
    ];
    return {
      files: [
        planFile(config.schemaPath, units, keepLocal, config, () =>
          assembleCombined({ tables, functions, accesses }, makeCtx),
        ),
      ],
    };
  }

  // Directory layout: one file per object, merged into wherever the object already lives (falling
  // back to its kind folder). A table the user keeps in some other file is updated there, in place.
  const dir = config.schemaPath;
  const tableLoc = await existingTables(dir);
  const groups = new Map<string, RenderedUnit[]>();
  const add = (abs: string, u: RenderedUnit) => {
    const arr = groups.get(abs);
    if (arr) arr.push(u);
    else groups.set(abs, [u]);
  };
  for (const t of tables)
    add(
      tableLoc.get(t.name) ?? join(dir, "tables", `${t.name}.ts`),
      tableUnit(t, makeCtx(t)),
    );
  for (const fn of functions)
    add(join(dir, "functions", `${fn.name}.ts`), functionUnit(fn));
  for (const a of accesses)
    add(join(dir, "access", `${a.name}.ts`), accessUnit(a));

  const files = [...groups].map(([abs, units]) =>
    planFile(abs, units, keepLocal, config, () =>
      units.length === 1
        ? unitModule(units[0])
        : mergeUnits("", units, {
            keepLocalFields: true,
            keepLocalObjects: true,
          }).content,
    ),
  );

  // Whole-entity local-only: locally-defined tables/functions/accesses the live DB doesn't have. A
  // file that ALSO holds a DB object is already reconciled above (mergeUnits keeps/drops the
  // local-only entity per `keepLocal`); only files whose entities are ALL local-only are invisible
  // to the DB-driven plan, so surface them here. A file that is PURELY those entities is deletable
  // when mirroring (not --merge); one that mixes them with other code is surfaced but left in place.
  const dbNames = new Set<string>([
    ...tables.map((t) => t.name),
    ...functions.map((f) => f.name),
    ...accesses.map((a) => a.name),
  ]);
  const planned = new Set(files.map((f) => f.abs));
  for (const [file, info] of await scanLocalEntities(dir)) {
    if (planned.has(file)) continue;
    const localOnly = info.entities.filter((e) => !dbNames.has(e.name));
    if (!localOnly.length) continue;
    const before = readFileSync(file, "utf8");
    const deletable =
      !keepLocal &&
      info.pureSchema &&
      localOnly.length === info.entities.length;
    files.push({
      rel: relative(config.root, file),
      abs: file,
      action: deletable ? "delete" : "unchanged",
      before,
      after: deletable ? "" : before,
      localOnly: { fields: [], objects: localOnly.map((e) => e.exportName) },
    });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files };
}

/** Plan one file: create it from `fresh()` if absent, else merge the units into it. */
function planFile(
  abs: string,
  units: RenderedUnit[],
  keepLocal: boolean,
  config: ResolvedConfig,
  fresh: () => string,
): PullFilePlan {
  const rel = relative(config.root, abs);
  if (!existsSync(abs)) {
    const after = fresh();
    return {
      rel,
      abs,
      action: "create",
      before: "",
      after: after.endsWith("\n") ? after : `${after}\n`,
      localOnly: EMPTY_LOCAL,
    };
  }
  const before = readFileSync(abs, "utf8");
  const { content, localOnly } = mergeUnits(before, units, {
    keepLocalFields: keepLocal,
    keepLocalObjects: keepLocal,
  });
  return {
    rel,
    abs,
    action: content === before ? "unchanged" : "update",
    before,
    after: content,
    localOnly,
  };
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

/** The rendered unit for one db-level function. */
function functionUnit(fn: StructFunction): RenderedUnit {
  const code = renderFunctionConst(fn);
  const names = ["defineFunction", ...(code.includes("s.") ? ["s"] : [])];
  const imports = [`import { ${names.join(", ")} } from "@schemic/core";`];
  // `surql` from surrealdb on its own line (see tableUnit) — a function body is always a surql expr.
  if (code.includes("surql`"))
    imports.push(`import { surql } from "surrealdb";`);
  return {
    kind: "function",
    name: fn.name,
    exportName: fnConst(fn.name),
    code,
    imports,
  };
}

/** The rendered unit for one db-level access def. */
function accessUnit(a: StructAccess): RenderedUnit {
  const code = renderAccessConst(a);
  const imports = [`import { defineAccess } from "@schemic/core";`];
  if (code.includes("surql`"))
    imports.push(`import { surql } from "surrealdb";`);
  return {
    kind: "access",
    name: a.name,
    exportName: fnConst(a.name),
    code,
    imports,
  };
}

/** Build the per-table {@link RenderCtx} factory: cycle-aware ref resolution + import accumulation. */
function ctxFactory(tables: StructTable[]): (t: StructTable) => RenderCtx {
  // Reference graph (record<…> targets + relation endpoints) → cycle-aware imports / ordering.
  const pulled = new Set(tables.map((t) => t.name));
  const graph = new Map(tables.map((t) => [t.name, tableRefs(t, pulled)]));
  const resolve = makeResolver(graph, pulled);
  const constOf = (n: string) => pascal(n) || n;
  return (t) => ({
    table: t.name,
    imports: new Set(),
    usesSelf: false,
    allowSelf: t.kind.kind !== "RELATION", // only defineTable takes the `self` callback
    constOf,
    resolve: (target) => resolve(t.name, target),
  });
}

/** Render a whole structured schema to one canonical TypeScript module (the source of `diff --ts`). */
export function renderSchemaToTS(db: DbStructured): string {
  return assembleCombined(db, ctxFactory(db.tables));
}

/** Merge several units' import lines into a deduped block (union of specifiers per source). */
function mergeImports(units: RenderedUnit[]): string[] {
  const bySource = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const u of units)
    for (const line of u.imports) {
      const m = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/.exec(line);
      if (!m) continue;
      let set = bySource.get(m[2]);
      if (!set) {
        set = new Set();
        bySource.set(m[2], set);
        order.push(m[2]);
      }
      for (const s of m[1]
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean))
        set.add(s);
    }
  // @schemic/core first, then the relative cross-file imports (sorted).
  order.sort((a, b) =>
    a === "@schemic/core" ? -1 : b === "@schemic/core" ? 1 : a.localeCompare(b),
  );
  return order.map(
    (src) =>
      `import { ${[...(bySource.get(src) ?? [])].join(", ")} } from "${src}";`,
  );
}

/**
 * Render a structured schema to per-file TypeScript modules keyed by file path — exactly the
 * layout `pull` writes (one file per object, with cross-file imports). `fileFor` maps an object to
 * its file. Used by `diff --ts` so its output matches the user's actual files.
 */
export function renderPerFile(
  db: DbStructured,
  fileFor: (kind: RenderedUnit["kind"], name: string) => string,
): Map<string, string> {
  const makeCtx = ctxFactory(db.tables);
  const byFile = new Map<string, RenderedUnit[]>();
  const add = (file: string, u: RenderedUnit) => {
    const arr = byFile.get(file);
    if (arr) arr.push(u);
    else byFile.set(file, [u]);
  };
  for (const t of db.tables)
    add(fileFor("table", t.name), tableUnit(t, makeCtx(t)));
  for (const fn of db.functions)
    add(fileFor("function", fn.name), functionUnit(fn));
  for (const a of db.accesses) add(fileFor("access", a.name), accessUnit(a));

  const out = new Map<string, string>();
  for (const [file, units] of byFile)
    out.set(
      file,
      units.length === 1
        ? unitModule(units[0])
        : `${mergeImports(units).join("\n")}\n\n${units.map((u) => u.code).join("\n\n")}\n`,
    );
  return out;
}

/** Assemble the single-file combined module (tables ordered so same-file refs resolve). */
function assembleCombined(
  { tables, functions, accesses }: DbStructured,
  makeCtx: (t: StructTable) => RenderCtx,
): string {
  // Render each const (collecting its same-file direct deps via ctx.imports), then order so deps
  // come first — same-file `Target.record()` refs need `Target` defined above them.
  const rendered = tables.map((t) => {
    const ctx = makeCtx(t);
    const { code, factory } = renderTableConst(t, ctx);
    return {
      name: t.name,
      code,
      factory,
      usesSurql: code.includes("surql`"),
      deps: [...ctx.imports].filter((d) => d !== t.name),
    };
  });
  const ordered = topoSort(rendered);
  const fnCode = functions.map(renderFunctionConst);
  const accessCode = accesses.map(renderAccessConst);
  const factories = [...new Set(ordered.map((r) => r.factory))];
  if (functions.length) factories.push("defineFunction");
  if (accesses.length) factories.push("defineAccess");
  factories.sort();
  const usesSurql =
    functions.length > 0 ||
    accesses.length > 0 ||
    ordered.some((r) => r.usesSurql);
  const names = ["s", ...factories];
  const imports = [`import { ${names.join(", ")} } from "@schemic/core";`];
  // `surql` from surrealdb on its own line (see tableUnit), kept out of the @schemic/core import.
  if (usesSurql) imports.push(`import { surql } from "surrealdb";`);
  const body = [...ordered.map((r) => r.code), ...fnCode, ...accessCode].join(
    "\n\n",
  );
  return `${imports.join("\n")}\n\n${body}\n`;
}
