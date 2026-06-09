import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Surreal } from "surrealdb";
import type { ResolvedConfig } from "./config";
import { type Filter, filterStructured, parseFilter } from "./filter";
import { existingTables } from "./schema";
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

/** The field clauses pull reverses into `sz.*` chains (sourced from `INFO … STRUCTURE`). */
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
  return `sz.recordId(${arg})`;
}

/** Map a SurrealQL type to an `sz.*` expression (`ctx` resolves `record<…>` references). */
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
  if (set) return `sz.set(${szType(set[1], ctx)})`;
  const rec = /^record<(.+?)>$/.exec(t);
  if (rec) return renderRecord(rec[1], ctx);

  // Literal unions: `'a' | 'b'` -> sz.enum (all strings) or a union of literals; lone -> sz.literal.
  const lits = splitTopUnion(t).map(parseLiteral);
  if (lits.length && lits.every((l) => l !== null)) {
    const vals = lits.map(
      (l) => (l as { value: string | number | boolean }).value,
    );
    if (vals.length === 1) return `sz.literal(${JSON.stringify(vals[0])})`;
    if (vals.every((v) => typeof v === "string"))
      return `sz.enum([${vals.map((v) => JSON.stringify(v)).join(", ")}])`;
    return `sz.union([${vals.map((v) => `sz.literal(${JSON.stringify(v)})`).join(", ")}])`;
  }

  switch (t) {
    case "string":
      return "sz.string()";
    case "int":
      return "sz.int()";
    case "float":
      return "sz.float()";
    case "number":
      return "sz.number()";
    case "bool":
      return "sz.boolean()";
    case "datetime":
      return "sz.datetime()";
    case "uuid":
      return "sz.uuid()";
    case "decimal":
      return "sz.decimal()";
    case "duration":
      return "sz.duration()";
    case "bytes":
      return "sz.bytes()";
    case "object":
      return "sz.object({})";
    case "any":
      return "sz.any()";
    default:
      return `sz.any() /* ${t} */`;
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

/** Render an `sz.*` expression for a field node, recursing into nested objects/array elements. */
function renderField(node: FieldNode, indent: string, ctx?: RenderCtx): string {
  const p = node.parsed;
  const objChildren = [...node.children].filter(([k]) => k !== "*");
  const star = node.children.get("*");
  const wrap = p ? unwrapType(p.type) : null;
  let expr: string;
  if (p && wrap?.base === "object") {
    // Rebuild sz.object from dotted children (empty if none) — even when wrapped in
    // option<…>/| null, so optional/nullable/flexible nested objects keep their shape.
    const inner = objChildren.length
      ? `{\n${objChildren
          .map(
            ([k, c]) =>
              `${indent}  ${ident(k)}: ${renderField(c, `${indent}  `, ctx)},`,
          )
          .join("\n")}\n${indent}}`
      : "{}";
    expr = `sz.object(${inner})`;
    if (p.flexible) expr += ".loose()"; // FLEXIBLE — accepts arbitrary keys
    if (wrap.nullable) expr += ".nullable()";
    if (wrap.optional) expr += ".optional()";
  } else if (p && star && /^(array|set)\b/.test(wrap?.base ?? "")) {
    // Any array/set: the element's full structure (incl. nested sub-fields) lives in the `*`
    // child — fold it into `<elem>.array()` / `sz.set(<elem>)`. This beats parsing the element
    // type from the parent kind, which would lose the element's sub-fields.
    const elem = renderField(star, indent, ctx);
    expr = /^set\b/.test(wrap?.base ?? "")
      ? `sz.set(${elem})`
      : `${elem}.array()`;
    if (wrap?.nullable) expr += ".nullable()";
    if (wrap?.optional) expr += ".optional()";
  } else if (!p) {
    expr = "sz.any()";
  } else {
    expr = szType(p.type, ctx);
  }

  if (p) {
    if (p.default !== undefined) {
      expr += `.${p.defaultAlways ? "$defaultAlways" : "$default"}(surql\`${p.default}\`)`;
    }
    if (p.value !== undefined) expr += `.$value(surql\`${p.value}\`)`;
    if (p.computed !== undefined) expr += `.$computed(surql\`${p.computed}\`)`;
    if (p.assert !== undefined) expr += `.$assert(surql\`${p.assert}\`)`;
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
  if (!isRelation) body.push(`  id: sz.string(),`);
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

/** A full single-table module — cross-file imports + the const — for the directory layout. */
function renderTableModule(t: StructTable, ctx: RenderCtx): string {
  const { code, factory } = renderTableConst(t, ctx);
  const names = ["sz", ...(code.includes("surql`") ? ["surql"] : []), factory];
  const imports = [`import { ${names.join(", ")} } from "surreal-zod";`];
  // Cross-table value imports (one per referenced table, sorted, self excluded).
  for (const dep of [...ctx.imports].filter((d) => d !== t.name).sort()) {
    imports.push(`import { ${ctx.constOf(dep)} } from "./${dep}";`);
  }
  return `${imports.join("\n")}\n\n${code}\n`;
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

export interface PullResult {
  files: string[];
  skipped: string[];
}

/**
 * Introspect the live database (via `INFO … STRUCTURE`) and regenerate the `sz.*` schema. Writes
 * one combined module when `config.schema` is a file, or one `<table>.ts` per table when it's a
 * directory. Refuses (without `--force`) to overwrite existing files or duplicate definitions.
 */
export async function pull(
  db: Surreal,
  config: ResolvedConfig,
  opts: { force?: boolean; filter?: Filter } = {},
): Promise<PullResult> {
  const introspected = await introspectStructured(
    db,
    new Set([config.migrationsTable, `${config.migrationsTable}_lock`]),
  );
  const { tables, functions, accesses } = filterStructured(
    introspected,
    opts.filter ?? parseFilter({}),
  );

  // Reference graph (record<…> targets + relation endpoints) → cycle-aware imports / ordering.
  const pulled = new Set(tables.map((t) => t.name));
  const graph = new Map(tables.map((t) => [t.name, tableRefs(t, pulled)]));
  const resolve = makeResolver(graph, pulled);
  const constOf = (n: string) => pascal(n) || n;
  const makeCtx = (t: StructTable): RenderCtx => ({
    table: t.name,
    imports: new Set(),
    usesSelf: false,
    allowSelf: t.kind.kind !== "RELATION", // only defineTable takes the `self` callback
    constOf,
    resolve: (target) => resolve(t.name, target),
  });

  return config.schemaIsFile
    ? pullToFile({ tables, functions, accesses }, config, opts, makeCtx)
    : pullToDir({ tables, functions, accesses }, config, opts, makeCtx);
}

/** Directory layout: one `<table>.ts` per table, refusing to duplicate tables defined elsewhere. */
async function pullToDir(
  { tables, functions, accesses }: DbStructured,
  config: ResolvedConfig,
  opts: { force?: boolean },
  makeCtx: (t: StructTable) => RenderCtx,
): Promise<PullResult> {
  const dir = config.schemaPath;
  // A table already defined in some OTHER file (e.g. a multi-table `schema.ts`) would become a
  // duplicate once we also write `<table>.ts` — refuse rather than create a silent "last wins".
  const existing = await existingTables(dir);
  const conflicts = tables
    .map((t) => ({ name: t.name, file: existing.get(t.name) }))
    .filter((c) => c.file && c.file !== join(dir, `${c.name}.ts`));
  if (conflicts.length && !opts.force) {
    // Group the offending tables by the file they're already defined in, so the message reads
    // "schema.ts → a, b, c" once instead of repeating "(in schema.ts)" per table.
    const byFile = new Map<string, string[]>();
    for (const c of conflicts) {
      const file = relative(dir, c.file as string);
      const names = byFile.get(file);
      if (names) names.push(c.name);
      else byFile.set(file, [c.name]);
    }
    const lines = [...byFile]
      .map(([file, names]) => `    ${file} → ${names.sort().join(", ")}`)
      .join("\n");
    const single = byFile.size === 1 ? [...byFile.keys()][0] : null;
    const remedies = [
      single
        ? `    • point \`schema\` at ${single} (single-file layout) in surreal-zod.config.ts`
        : "    • point `schema` at a single file (single-file layout) in surreal-zod.config.ts",
      "    • clear those files and re-run pull into an empty directory",
      "    • re-run with --force to overwrite",
    ].join("\n");
    throw new Error(
      `pull would duplicate tables already defined elsewhere:\n${lines}\n\n` +
        `  Directory mode writes one file per table. To resolve, either:\n${remedies}`,
    );
  }

  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const skipped: string[] = [];
  for (const t of tables) {
    const file = join(dir, `${t.name}.ts`);
    if (existsSync(file) && !opts.force) {
      skipped.push(`${t.name}.ts`);
      continue;
    }
    writeFileSync(file, renderTableModule(t, makeCtx(t)));
    files.push(`${t.name}.ts`);
  }
  // Db-level objects live in their own module (they have no owning table).
  const writeModule = (name: string, content: string) => {
    const file = join(dir, name);
    if (existsSync(file) && !opts.force) skipped.push(name);
    else {
      writeFileSync(file, content);
      files.push(name);
    }
  };
  if (functions.length)
    writeModule("functions.ts", renderFunctionsModule(functions));
  if (accesses.length) writeModule("access.ts", renderAccessModule(accesses));
  return { files, skipped };
}

/** The `functions.ts` module for the directory layout (all db-level functions + their imports). */
function renderFunctionsModule(functions: StructFunction[]): string {
  const body = functions.map(renderFunctionConst).join("\n\n");
  return `import { defineFunction, sz, surql } from "surreal-zod";\n\n${body}\n`;
}

/** The `access.ts` module for the directory layout (all db-level access defs). */
function renderAccessModule(accesses: StructAccess[]): string {
  const body = accesses.map(renderAccessConst).join("\n\n");
  return `import { defineAccess, surql } from "surreal-zod";\n\n${body}\n`;
}

/** Single-file layout: one combined module (tables ordered so same-file refs resolve). */
async function pullToFile(
  { tables, functions, accesses }: DbStructured,
  config: ResolvedConfig,
  opts: { force?: boolean },
  makeCtx: (t: StructTable) => RenderCtx,
): Promise<PullResult> {
  const target = config.schemaPath;
  if (existsSync(target) && !opts.force) {
    throw new Error(
      `${relative(config.root, target)} already exists — use --force to overwrite it.`,
    );
  }
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
  const names = ["sz", ...(usesSurql ? ["surql"] : []), ...factories];
  const imports = [`import { ${names.join(", ")} } from "surreal-zod";`];
  const body = [...ordered.map((r) => r.code), ...fnCode, ...accessCode].join(
    "\n\n",
  );
  const out = `${imports.join("\n")}\n\n${body}\n`;

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, out);
  return { files: [relative(config.root, target)], skipped: [] };
}
