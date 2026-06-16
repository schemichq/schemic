import { BoundQuery, escapeIdent, toSurqlString } from "surrealdb";
import type { z } from "zod";
import {
  type AccessDef,
  type Expr,
  type FieldPermissions,
  type FunctionDef,
  objectFieldsRegistry,
  type PermOp,
  type SField,
  type Shape,
  type StandaloneDef,
  type SurrealMeta,
  surrealTypeRegistry,
  type TableDef,
  type TableEvent,
  type TablePermissions,
} from "./pure";

/** Inline a BoundQuery's bindings into a literal SurrealQL string for DDL use. Exported so the
 *  Struct-IR lowering (`fromTableDef`) renders DEFAULT/VALUE/COMPUTED/permission exprs identically. */
export function inline(query: BoundQuery): string {
  let out = query.query;
  for (const [name, value] of Object.entries(query.bindings ?? {})) {
    out = out.replaceAll(`$${name}`, toSurqlString(value));
  }
  return out.trim();
}

/**
 * The bare AND-joined `ASSERT` expression (no `ASSERT ` keyword): inline any `BoundQuery` entries
 * (custom `surql` asserts), keep strings (computed checks) as-is, dedupe while preserving order,
 * and AND-join. Each fragment is already a complete boolean expr. Returns "" when there are none.
 * Exported so the Struct-IR lowering (`fromTableDef`) can populate `StructField.assert` (the bare
 * expr) while the DDL emitter prepends the `ASSERT ` keyword via {@link renderAsserts}.
 */
export function assertExpr(asserts: SurrealMeta["asserts"]): string {
  if (!asserts?.length) return "";
  const frags: string[] = [];
  for (const a of asserts) {
    const frag = a instanceof BoundQuery ? inline(a) : a;
    if (frag && !frags.includes(frag)) frags.push(frag);
  }
  return frags.join(" AND ");
}

/** The full `ASSERT <expr>` clause for the DDL emitter (or "" when there are no fragments). */
function renderAsserts(asserts: SurrealMeta["asserts"]): string {
  const expr = assertExpr(asserts);
  return expr ? `ASSERT ${expr}` : "";
}

/** Read a Zod schema's internal def with a loose type for traversal. */
function zdef(schema: z.ZodType): { type: string; [k: string]: unknown } {
  return schema._zod.def as unknown as { type: string; [k: string]: unknown };
}

/** Format a literal value as a SurrealQL literal type (e.g. `'admin'`, `42`). */
function surqlLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return toSurqlString(value).replace(/^s"/, '"');
}

/**
 * The SurrealQL type of a field plus any nested fields it expands into:
 * object subfields (`path.key`) and array/record element fields (`path.*`).
 * Exported (with {@link inferField}) so the Struct-IR lowering walks the SAME child tree the
 * emitter does — so the two can't disagree on type strings or dotted field paths.
 */
export interface FieldInfo {
  type: string;
  flexible: boolean;
  children: { suffix: string; info: FieldInfo; surreal?: SurrealMeta }[];
}
const leaf = (type: string): FieldInfo => ({
  type,
  flexible: false,
  children: [],
});

/** Infer a field's SurrealQL type + nested structure from a Zod schema. Exported so the Struct-IR
 *  lowering (`fromTableDef`) and the emitter share one source of truth for type strings + paths. */
export function inferField(
  schema: z.ZodType,
  seen: Set<z.ZodType> = new Set(),
): FieldInfo {
  // Surreal-native schemas (datetime, recordId) carry their type explicitly.
  const explicit = surrealTypeRegistry.get(schema);
  if (explicit) return leaf(explicit);

  const def = zdef(schema);
  switch (def.type) {
    case "string":
      return leaf("string");
    case "number": {
      // z.int/int32/uint32/float64 share def.type "number"; the format discriminates.
      const fmt = def.format as string | undefined;
      if (fmt?.includes("float")) return leaf("float");
      if (fmt?.includes("int")) return leaf("int");
      return leaf("number");
    }
    case "bigint":
      return leaf("int");
    case "boolean":
      return leaf("bool");
    case "date":
      return leaf("datetime");
    case "any":
    case "unknown":
      return leaf("any");
    case "null":
      return leaf("null");

    // No SurrealQL mapping — these exist on `s.*` only for drop-in `z.*` parity, and are
    // rejected when used as a table field. (Registered native types — datetime/uuid/record/…
    // — are caught by the `surrealTypeRegistry` check at the top, so they never reach here.)
    case "symbol":
    case "undefined":
    case "void":
    case "never":
    case "nan":
    case "function":
    case "promise":
    case "custom":
      throw new Error(
        `s.${def.type}() has no SurrealQL type and can't be used as a table field. ` +
          `Use a Surreal-native builder (e.g. s.string / s.int / s.datetime / s.uuid / ` +
          `s.recordId) instead, or keep this schema out of your table definitions.`,
      );

    case "optional":
    case "default":
    case "prefault": {
      const inner = inferField(def.innerType as z.ZodType, seen);
      // `any` already admits NONE/NULL, so `option<any>` is invalid SurrealQL — leave it as `any`.
      if (inner.type === "any") return inner;
      return { ...inner, type: `option<${inner.type}>` };
    }
    case "nullable": {
      const inner = inferField(def.innerType as z.ZodType, seen);
      if (inner.type === "any") return inner; // `any` already includes null
      // Fold null INTO an existing option<X> so .optional().nullable() matches
      // .nullish()/.nullable().optional(): option<X> | null -> option<X | null>.
      if (inner.type.startsWith("option<") && inner.type.endsWith(">")) {
        const x = inner.type.slice("option<".length, -1);
        return { ...inner, type: `option<${x} | null>` };
      }
      return { ...inner, type: `${inner.type} | null` };
    }
    case "readonly":
    case "catch": // app-side error recovery — the stored type is the inner type
      return inferField(def.innerType as z.ZodType, seen);
    case "pipe": // a codec with no explicit type — use its encoded (wire) side
      return inferField(def.in as z.ZodType, seen);

    case "lazy": {
      // Track the lazy schema itself: its getter returns a fresh instance each call,
      // but the recursive reference reuses the same lazy node.
      if (seen.has(schema)) return leaf("any");
      seen.add(schema);
      const info = inferField((def.getter as () => z.ZodType)(), seen);
      seen.delete(schema);
      return info;
    }

    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const fields = objectFieldsRegistry.get(schema); // SField shape if built via s.object
      const catchall = def.catchall as z.ZodType | undefined;
      const flexible = !!catchall && zdef(catchall).type === "unknown";
      const children = Object.entries(shape).map(([key, value]) => ({
        suffix: `.${escapeIdent(key)}`,
        info: inferField(value, seen),
        surreal: fields?.[key]?.surreal,
      }));
      return { type: "object", flexible, children };
    }

    case "intersection": {
      const left = inferField(def.left as z.ZodType, seen);
      const right = inferField(def.right as z.ZodType, seen);
      if (left.type === "object" && right.type === "object") {
        const merged = new Map(left.children.map((c) => [c.suffix, c]));
        for (const c of right.children) merged.set(c.suffix, c); // right wins on overlap
        return {
          type: "object",
          flexible: left.flexible || right.flexible,
          children: [...merged.values()],
        };
      }
      return leaf("any");
    }

    case "array":
    case "set": {
      const elem = inferField(
        (def.element ?? def.valueType) as z.ZodType,
        seen,
      );
      // Element subfields live under `path.*`, but only when the element is structured.
      const children =
        elem.children.length > 0 || elem.type === "object"
          ? [{ suffix: ".*", info: elem }]
          : [];
      // `set<T>` is distinct from `array<T>` in SurrealDB (dedup) and round-trips — preserve it.
      const kw = def.type === "set" ? "set" : "array";
      // `array<T, N>` / `set<T, N>` — N is a MAX size from a Zod `.max()` check
      // (`max_length` on arrays, `max_size` on sets). No min in the SurrealQL form.
      const checks =
        (
          def as {
            checks?: {
              _zod?: { def?: { check?: string; maximum?: number } };
            }[];
          }
        ).checks ?? [];
      const maximum = checks
        .map((c) => c._zod?.def)
        .find(
          (d) => d?.check === "max_length" || d?.check === "max_size",
        )?.maximum;
      const size = typeof maximum === "number" ? `, ${maximum}` : "";
      return { type: `${kw}<${elem.type}${size}>`, flexible: false, children };
    }

    case "record":
    case "map": {
      const value = inferField(def.valueType as z.ZodType, seen);
      return {
        type: "object",
        flexible: false,
        children: [{ suffix: ".*", info: value }],
      };
    }

    case "union": {
      const opts = (def.options ?? []) as z.ZodType[];
      // A `none`-ish member (z.undefined()/z.void()) makes the union optional: `T | none` -> `option<T>`.
      const noneish = (o: z.ZodType) => {
        const t = zdef(o).type;
        return t === "undefined" || t === "void";
      };
      const hasNone = opts.some(noneish);
      const types = [
        ...new Set(
          opts.filter((o) => !noneish(o)).map((o) => inferField(o, seen).type),
        ),
      ];
      // `any` absorbs every other member (including none) — `any | string` is invalid → `any`.
      if (types.includes("any")) return leaf("any");
      const joined = types.join(" | ") || "any";
      if (hasNone) return leaf(joined === "any" ? "any" : `option<${joined}>`);
      return leaf(joined);
    }
    case "enum": {
      const entries = (def.entries ?? {}) as Record<string, string | number>;
      // Drop TS numeric-enum reverse mappings (name->number); keep the real values.
      const values = Object.values(entries).filter(
        (v) => typeof entries[v as string] !== "number",
      );
      const types = [...new Set(values.map(surqlLiteral))];
      return leaf(types.join(" | ") || "any");
    }
    case "literal": {
      const values = (def.values ?? []) as unknown[];
      const types = [...new Set(values.map(surqlLiteral))];
      return leaf(types.join(" | ") || "any");
    }
    case "tuple": {
      if (def.rest) return leaf("array"); // variadic tuple -> generic array
      const items = (def.items ?? []) as z.ZodType[];
      return leaf(`[${items.map((i) => inferField(i, seen).type).join(", ")}]`);
    }

    default:
      return leaf("any");
  }
}

/** DDL generation options. `exists: "overwrite"` -> OVERWRITE; "ignore" -> IF NOT EXISTS. */
export type DefineOptions = { exists?: "overwrite" | "ignore" };

function existsPrefix(opts?: DefineOptions): string {
  return opts?.exists === "overwrite"
    ? "OVERWRITE "
    : opts?.exists === "ignore"
      ? "IF NOT EXISTS "
      : "";
}

/**
 * Render a `PERMISSIONS …` clause for a table or field from a permissions spec. `ops` is
 * the canonical op set: `["select","create","update","delete"]` for tables,
 * `["select","create","update"]` for fields (fields have no `delete`).
 *
 *   - `true`  -> `PERMISSIONS FULL`
 *   - `false` -> `PERMISSIONS NONE`
 *   - a `BoundQuery` -> every op shares it: `PERMISSIONS FOR <all ops> WHERE <expr>`
 *   - an object  -> 1. resolve each present op to a concrete rule (`boolean | BoundQuery`);
 *     a `` `same as X` `` reuses X's resolved rule (errors if X is absent or on a cycle).
 *     2. merge ops whose resolved rule is identical (booleans by `===`, BoundQuery by its
 *     `inline()`-ed string) into one `FOR a, b … <rule>` clause, in canonical op order.
 *
 * Omitted ops emit nothing — and the SurrealDB defaults for an omitted op are intentionally
 * ASYMMETRIC: a TABLE defaults it to NONE (deny), a FIELD defaults it to FULL (the table is
 * the gate). So to lock a field op you must set it `false` explicitly.
 */
export function renderPermissions(
  spec: TablePermissions | FieldPermissions,
  ops: readonly PermOp[],
): string {
  if (spec === true) return "PERMISSIONS FULL";
  if (spec === false) return "PERMISSIONS NONE";
  if (spec instanceof BoundQuery)
    return `PERMISSIONS FOR ${ops.join(", ")} WHERE ${inline(spec)}`;

  const rules = spec as Partial<Record<PermOp, boolean | BoundQuery | string>>;
  const present = ops.filter((op) => rules[op] !== undefined);
  const resolved = new Map<PermOp, boolean | BoundQuery>();

  // Resolve an op's rule, following `same as X` references; `chain` detects cycles.
  const resolve = (op: PermOp, chain: PermOp[]): boolean | BoundQuery => {
    const cached = resolved.get(op);
    if (cached !== undefined) return cached;
    const rule = rules[op];
    if (rule === undefined) {
      throw new Error(
        `PERMISSIONS: "same as ${op}" references op "${op}", which is not in the spec`,
      );
    }
    if (chain.includes(op)) {
      throw new Error(
        `PERMISSIONS: "same as" reference cycle: ${[...chain, op].join(" -> ")}`,
      );
    }
    const value =
      typeof rule === "string"
        ? resolve(rule.slice("same as ".length).trim() as PermOp, [
            ...chain,
            op,
          ])
        : rule;
    resolved.set(op, value);
    return value;
  };

  // Group present ops by their resolved rule's clause body (canonical order preserved).
  const groups = new Map<string, PermOp[]>();
  for (const op of present) {
    const rule = resolve(op, []);
    const body =
      rule === true
        ? "FULL"
        : rule === false
          ? "NONE"
          : `WHERE ${inline(rule)}`;
    const group = groups.get(body);
    if (group) group.push(op);
    else groups.set(body, [op]);
  }
  const clauses = [...groups].map(
    ([body, group]) => `FOR ${group.join(", ")} ${body}`,
  );
  return clauses.length ? `PERMISSIONS ${clauses.join(" ")}` : "";
}

/**
 * One generated DDL statement, tied to the schema object it defines. `kind` is the object
 * kind; `name` identifies it within its scope (a table name, or a field path like
 * `settings.theme` / `tags.*`, already escaped as it appears in the DDL); `table` is the
 * owning table for fields. Used by the CLI's migration diff to add/change/remove objects
 * individually. `emitTable`/`emitField` are the string-joined views of these.
 */
export interface DefineStatement {
  kind: "table" | "field" | "index" | "event" | "function" | "access";
  name: string;
  table?: string;
  ddl: string;
  /**
   * Rendered clause fragments keyed by clause name (`TYPE`, `DEFAULT`, `ASSERT`, …) — only on
   * `field`/`table` statements. Each value is the exact fragment used in the DDL, which is also
   * the `ALTER … <set>` form, so the migration engine can compute a clause-level delta without
   * parsing SurrealQL. Absent on older snapshots (those changes fall back to `OVERWRITE`).
   */
  clauses?: Record<string, string>;
}

/** The SurrealQL type of a field schema (e.g. `string`, `option<int>`, `record<user>`). */
export function fieldType(field: SField): string {
  return inferField(field.schema).type;
}

/** Inline a single event clause (`when`/one `then`): a `BoundQuery` is inlined, a string passes
 *  through. Exported so the Struct-IR lowering renders event/permission exprs identically. */
export function eventClause(e: Expr): string {
  return e instanceof BoundQuery ? inline(e) : e;
}

/** A `{ … }` block body — wraps a bare statement list in braces; a `surql\`{ … }\`` passes through.
 *  Exported so the Struct-IR lowering renders function/access blocks to match INFO's `{ … }` form. */
export function braceBody(e: Expr): string {
  const s = eventClause(e).trim();
  return s.startsWith("{") ? s : `{ ${s} }`;
}

/** `DEFINE EVENT <name> ON TABLE <table> [WHEN <when>] THEN <then>`. Multiple `then`s run in order. */
function emitEvent(
  table: string,
  ev: TableEvent,
  opts?: DefineOptions,
): string {
  const parts = [
    `DEFINE EVENT ${existsPrefix(opts)}${escapeIdent(ev.name)} ON TABLE ${escapeIdent(table)}`,
  ];
  if (ev.when !== undefined) parts.push(`WHEN ${eventClause(ev.when)}`);
  const thens = (Array.isArray(ev.then) ? ev.then : [ev.then]).map(eventClause);
  // One `THEN` rides bare; several are parenthesized so the comma list parses unambiguously.
  parts.push(
    `THEN ${thens.length === 1 ? thens[0] : thens.map((t) => `(${t})`).join(", ")}`,
  );
  return `${parts.join(" ")};`;
}

/** `DEFINE FUNCTION fn::<name>(<args>) [-> <returns>] { <body> } [PERMISSIONS …] [COMMENT …]`. */
function emitFunction(fn: FunctionDef, opts?: DefineOptions): string {
  if (fn.config.body === undefined) {
    throw new Error(
      `function fn::${fn.name} has no body — call .body(surql\`…\`)`,
    );
  }
  const args = Object.entries(fn.args)
    .map(([n, f]) => `$${n}: ${fieldType(f)}`)
    .join(", ");
  const parts = [
    `DEFINE FUNCTION ${existsPrefix(opts)}fn::${escapeIdent(fn.name)}(${args})`,
  ];
  if (fn.config.returns) parts.push(`-> ${fieldType(fn.config.returns)}`);
  parts.push(braceBody(fn.config.body));
  const p = fn.config.permissions;
  if (p !== undefined) {
    parts.push(
      p === true
        ? "PERMISSIONS FULL"
        : p === false
          ? "PERMISSIONS NONE"
          : `PERMISSIONS ${eventClause(p)}`,
    );
  }
  if (fn.config.comment)
    parts.push(`COMMENT ${JSON.stringify(fn.config.comment)}`);
  return `${parts.join(" ")};`;
}

/** `DEFINE ACCESS <name> ON <DATABASE|NAMESPACE> TYPE <RECORD|JWT|BEARER> … [DURATION …]`. */
function emitAccess(a: AccessDef, opts?: DefineOptions): string {
  const on = a.config.on === "namespace" ? "NAMESPACE" : "DATABASE";
  const k = a.config.kind;
  let typeClause: string;
  if (k.type === "bearer") {
    typeClause = `TYPE BEARER FOR ${k.subject === "user" ? "USER" : "RECORD"}`;
  } else if (k.type === "jwt") {
    typeClause = k.url
      ? `TYPE JWT URL ${JSON.stringify(k.url)}`
      : `TYPE JWT ALGORITHM ${k.alg ?? "HS512"} KEY ${JSON.stringify(k.key ?? "")}`;
  } else {
    typeClause = "TYPE RECORD";
  }
  const parts = [
    `DEFINE ACCESS ${existsPrefix(opts)}${escapeIdent(a.name)} ON ${on} ${typeClause}`,
  ];
  // SIGNUP/SIGNIN/AUTHENTICATE only apply to RECORD access.
  if (k.type === "record") {
    if (a.config.signup) parts.push(`SIGNUP ${braceBody(a.config.signup)}`);
    if (a.config.signin) parts.push(`SIGNIN ${braceBody(a.config.signin)}`);
    if (a.config.authenticate)
      parts.push(`AUTHENTICATE ${braceBody(a.config.authenticate)}`);
  }
  const d = a.config.duration;
  if (d?.grant || d?.token || d?.session) {
    const fors: string[] = [];
    if (d.grant) fors.push(`FOR GRANT ${d.grant}`);
    if (d.token) fors.push(`FOR TOKEN ${d.token}`);
    if (d.session) fors.push(`FOR SESSION ${d.session}`);
    parts.push(`DURATION ${fors.join(", ")}`);
  }
  return `${parts.join(" ")};`;
}

/** The `DefineStatement` for a standalone def — `defineEvent`/`defineFunction`/`defineAccess`. */
export function emitDefStatement(
  def: StandaloneDef,
  opts?: DefineOptions,
): DefineStatement {
  if (def.kind === "event") {
    return {
      kind: "event",
      name: def.name,
      table: def.table,
      ddl: emitEvent(def.table, def, opts),
    };
  }
  if (def.kind === "access") {
    return { kind: "access", name: def.name, ddl: emitAccess(def, opts) };
  }
  return { kind: "function", name: def.name, ddl: emitFunction(def, opts) };
}

/** Emit `DEFINE FIELD path ...` for a node, then recurse into its children. */
/** A trivial array element is the plain auto-created form — no FLEXIBLE and no `$`-clauses. */
function isTrivialElement(info: FieldInfo, surreal?: SurrealMeta): boolean {
  if (info.flexible) return false;
  if (!surreal) return true;
  return (
    !surreal.permissions &&
    !surreal.readonly &&
    !surreal.default &&
    !surreal.value &&
    !surreal.asserts?.length &&
    !surreal.comment &&
    !surreal.internal &&
    !surreal.index
  );
}

function emit(
  path: string,
  table: string,
  info: FieldInfo,
  surreal: SurrealMeta | undefined,
  opts: DefineOptions | undefined,
  out: DefineStatement[],
  forceOverwrite = false,
): void {
  let type = info.type;
  // A DB-side DEFAULT/VALUE/COMPUTED means the column is always populated -> drop a leading option<>.
  if (
    (surreal?.default || surreal?.value || surreal?.computed) &&
    type.startsWith("option<")
  ) {
    type = type.slice("option<".length, -1);
  }
  // An array element is auto-created by SurrealDB, so a (kept) element DEFINE must OVERWRITE it.
  const prefix = forceOverwrite ? "OVERWRITE " : existsPrefix(opts);
  // Clause fragments keyed by clause name (insertion order == DDL order). Each fragment is also
  // the `ALTER FIELD … <set>` form, so the migration engine diffs clauses without parsing.
  const clauses: Record<string, string> = { TYPE: `TYPE ${type}` };
  if (info.flexible) clauses.FLEXIBLE = "FLEXIBLE";
  if (surreal?.reference) {
    let ref = "REFERENCE";
    const onDelete =
      surreal.reference === true ? undefined : surreal.reference.onDelete;
    if (onDelete !== undefined) {
      ref +=
        onDelete instanceof BoundQuery
          ? ` ON DELETE THEN ${inline(onDelete)}`
          : ` ON DELETE ${onDelete.toUpperCase()}`;
    }
    clauses.REFERENCE = ref;
  }
  if (surreal?.default) {
    clauses.DEFAULT = `DEFAULT ${surreal.defaultAlways ? "ALWAYS " : ""}${inline(surreal.default)}`;
  }
  if (surreal?.value) clauses.VALUE = `VALUE ${inline(surreal.value)}`;
  if (surreal?.computed)
    clauses.COMPUTED = `COMPUTED ${inline(surreal.computed)}`;
  const assertClause = renderAsserts(surreal?.asserts);
  if (assertClause) clauses.ASSERT = assertClause;
  if (surreal?.readonly) clauses.READONLY = "READONLY";
  if (surreal?.comment)
    clauses.COMMENT = `COMMENT ${JSON.stringify(surreal.comment)}`;
  // Internal fields still exist on the table (so SCHEMAFULL writes succeed) but grant
  // no record-user access — internal wins over any `$permissions` on the same field.
  if (surreal?.internal) {
    clauses.PERMISSIONS = "PERMISSIONS NONE";
  } else if (surreal?.permissions !== undefined) {
    const clause = renderPermissions(surreal.permissions, [
      "select",
      "create",
      "update",
    ]);
    if (clause) clauses.PERMISSIONS = clause;
  }
  const ddl = `DEFINE FIELD ${prefix}${path} ON TABLE ${escapeIdent(table)} ${Object.values(clauses).join(" ")};`;
  out.push({ kind: "field", name: path, table, ddl, clauses });

  // A single-field index defined via `.index()` / `.unique()`.
  if (surreal?.index) {
    const idxName = `${table}_${path.replace(/[`]/g, "").replace(/[^a-zA-Z0-9]+/g, "_")}_idx`;
    const unique = surreal.index.unique ? " UNIQUE" : "";
    out.push({
      kind: "index",
      name: idxName,
      table,
      ddl: `DEFINE INDEX ${existsPrefix(opts)}${escapeIdent(idxName)} ON TABLE ${escapeIdent(table)} FIELDS ${path}${unique};`,
    });
  }

  // SurrealDB auto-creates an array's `.*` element from the `array<…>` type. A TRIVIAL element is
  // that exact form, so we skip its DEFINE (a plain one errors "already exists") and emit only its
  // sub-fields. A CUSTOMIZED element (FLEXIBLE / permissions / …) is emitted with OVERWRITE. Other
  // parents (an `object` map's `.*` value) are emitted normally.
  const isArray = /^(?:array|set)\b/.test(info.type);
  for (const child of info.children) {
    const childPath = `${path}${child.suffix}`;
    if (isArray && child.suffix === ".*") {
      if (isTrivialElement(child.info, child.surreal)) {
        for (const sub of child.info.children) {
          emit(
            `${childPath}${sub.suffix}`,
            table,
            sub.info,
            sub.surreal,
            opts,
            out,
          );
        }
      } else {
        emit(childPath, table, child.info, child.surreal, opts, out, true);
      }
    } else {
      emit(childPath, table, child.info, child.surreal, opts, out);
    }
  }
}

/** Structured `DEFINE FIELD` statements for a field (and its nested subfields). */
export function emitFieldStatements(
  name: string,
  table: string,
  field: SField,
  opts?: DefineOptions,
): DefineStatement[] {
  const out: DefineStatement[] = [];
  let info: FieldInfo;
  try {
    info = inferField(field.schema);
  } catch (e) {
    // inferField only sees the schema; pin the failure to the field + table for the user.
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${msg} (field "${name}" on table "${table}")`);
  }
  emit(escapeIdent(name), table, info, field.surreal, opts, out);
  return out;
}

/** `DEFINE FIELD ...` for a field (and any nested object/array/record subfields). */
export function emitField(
  name: string,
  table: string,
  field: SField,
  opts?: DefineOptions,
): string {
  return emitFieldStatements(name, table, field, opts)
    .map((s) => s.ddl)
    .join("\n");
}

/** Structured statements for a table: its `DEFINE TABLE` head, then one per (nested) field. */
export function emitStatements(
  t: TableDef<string, Shape>,
  opts?: DefineOptions,
): DefineStatement[] {
  const rel = t.config.relation;
  // Surreal manages id (and in/out for relations) implicitly.
  const implicit = rel ? new Set(["id", "in", "out"]) : new Set(["id"]);
  let type: string;
  if (rel) {
    // Endpoints are optional: omit FROM/TO when unrestricted (`TYPE RELATION`).
    type = "RELATION";
    if (rel.from.length)
      type += ` FROM ${rel.from.map(escapeIdent).join(" | ")}`;
    if (rel.to.length) type += ` TO ${rel.to.map(escapeIdent).join(" | ")}`;
    if (rel.enforced) type += " ENFORCED";
  } else {
    type = t.config.type === "any" ? "ANY" : "NORMAL";
  }

  // Build clauses keyed by name (insertion order == DDL order) so the migration engine can diff
  // table-level changes into the `ALTER TABLE … <set>` form without parsing SurrealQL — the
  // stored fragment IS the ALTER set form, exactly as for fields.
  const clauses: Record<string, string> = { TYPE: `TYPE ${type}` };
  if (t.config.drop) clauses.DROP = "DROP";
  clauses.SCHEMA = t.config.schemafull ? "SCHEMAFULL" : "SCHEMALESS";
  if (t.config.changefeed) {
    clauses.CHANGEFEED = `CHANGEFEED ${t.config.changefeed.expiry}${
      t.config.changefeed.includeOriginal ? " INCLUDE ORIGINAL" : ""
    }`;
  }
  if (t.config.comment)
    clauses.COMMENT = `COMMENT ${JSON.stringify(t.config.comment)}`;
  // Fold permissions into the single DEFINE TABLE head (no separate OVERWRITE … PERMISSIONS).
  if (t.config.permissions !== undefined) {
    const clause = renderPermissions(t.config.permissions, [
      "select",
      "create",
      "update",
      "delete",
    ]);
    if (clause) clauses.PERMISSIONS = clause;
  }

  const out: DefineStatement[] = [
    {
      kind: "table",
      name: t.name,
      ddl: `DEFINE TABLE ${existsPrefix(opts)}${escapeIdent(t.name)} ${Object.values(clauses).join(" ")};`,
      clauses,
    },
  ];
  for (const [name, field] of Object.entries(t.fields)) {
    if (implicit.has(name)) continue;
    out.push(...emitFieldStatements(name, t.name, field as SField, opts));
  }
  // Composite indexes declared via `.index(name, fields, …)`. A `count` index has no FIELDS.
  for (const idx of t.config.indexes ?? []) {
    const spec = idx.count
      ? "COUNT"
      : `FIELDS ${idx.fields.map(escapeIdent).join(", ")}${idx.unique ? " UNIQUE" : ""}`;
    out.push({
      kind: "index",
      name: idx.name,
      table: t.name,
      ddl: `DEFINE INDEX ${existsPrefix(opts)}${escapeIdent(idx.name)} ON TABLE ${escapeIdent(t.name)} ${spec};`,
    });
  }
  // Row-change events declared via `.event(name, { when?, then })`.
  for (const ev of t.config.events ?? []) {
    out.push({
      kind: "event",
      name: ev.name,
      table: t.name,
      ddl: emitEvent(t.name, ev, opts),
    });
  }
  return out;
}

/** `DEFINE TABLE ...` plus a `DEFINE FIELD` per field. */
export function emitTable(
  t: TableDef<string, Shape>,
  opts?: DefineOptions,
): string {
  return emitStatements(t, opts)
    .map((s) => s.ddl)
    .join("\n");
}

/** The `REMOVE ...` statement that drops the object a `DefineStatement` defines. */
export function removeStatement(
  s: Pick<DefineStatement, "kind" | "name" | "table">,
): string {
  if (s.kind === "table")
    return `REMOVE TABLE IF EXISTS ${escapeIdent(s.name)};`;
  if (s.kind === "index") {
    return `REMOVE INDEX IF EXISTS ${escapeIdent(s.name)} ON TABLE ${escapeIdent(s.table ?? "")};`;
  }
  if (s.kind === "event") {
    return `REMOVE EVENT IF EXISTS ${escapeIdent(s.name)} ON TABLE ${escapeIdent(s.table ?? "")};`;
  }
  if (s.kind === "function") {
    return `REMOVE FUNCTION IF EXISTS fn::${escapeIdent(s.name)};`;
  }
  if (s.kind === "access") {
    return `REMOVE ACCESS IF EXISTS ${escapeIdent(s.name)} ON DATABASE;`;
  }
  return `REMOVE FIELD IF EXISTS ${s.name} ON TABLE ${escapeIdent(s.table ?? "")};`;
}

/** Inject `OVERWRITE` into a plain `DEFINE <kind> …` statement (idempotent re-definition). */
export function overwriteStatement(ddl: string): string {
  return ddl.replace(
    /^DEFINE (TABLE|FIELD|INDEX|EVENT|ANALYZER|ACCESS|PARAM|FUNCTION) (?!OVERWRITE\b)/,
    "DEFINE $1 OVERWRITE ",
  );
}

/** Canonical clause order for a deterministic `ALTER FIELD` body (matches the DDL order). */
const FIELD_CLAUSE_ORDER = [
  "TYPE",
  "FLEXIBLE",
  "REFERENCE",
  "DEFAULT",
  "VALUE",
  "COMPUTED",
  "ASSERT",
  "READONLY",
  "COMMENT",
  "PERMISSIONS",
] as const;
/** Clauses `ALTER FIELD` can `DROP` (remove). `PERMISSIONS` has no DROP (reset to FULL);
 *  `COMPUTED` has no ALTER form at all (forces an OVERWRITE fallback). */
const FIELD_DROPPABLE = new Set([
  "FLEXIBLE",
  "READONLY",
  "VALUE",
  "ASSERT",
  "DEFAULT",
  "COMMENT",
  "REFERENCE",
]);

/**
 * Emit an `ALTER FIELD` that turns the `prev` clause set into `next` — re-set changed/added
 * clauses, `DROP` removed ones (a true delta). Returns `null` (the caller should fall back to
 * `DEFINE … OVERWRITE`) when the delta touches a clause `ALTER FIELD` can't express (`COMPUTED`),
 * or when clause data is unavailable (e.g. an older snapshot without `clauses`).
 */
export function alterField(
  table: string,
  path: string,
  prev: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): string | null {
  if (!prev || !next) return null;
  const sets: string[] = [];
  for (const k of FIELD_CLAUSE_ORDER) {
    const before = prev[k];
    const after = next[k];
    if (before === after) continue;
    if (k === "COMPUTED") return null; // no `ALTER FIELD … COMPUTED` form
    if (after !== undefined) {
      sets.push(after); // added or changed -> re-set (the fragment IS the ALTER set form)
    } else if (k === "PERMISSIONS") {
      sets.push("PERMISSIONS FULL"); // no `DROP PERMISSIONS`; reset to the field default
    } else if (k === "TYPE") {
      return null; // a field always has a TYPE; "removing" it is meaningless -> OVERWRITE
    } else if (FIELD_DROPPABLE.has(k)) {
      sets.push(`DROP ${k}`);
    } else {
      return null;
    }
  }
  if (!sets.length) return null;
  return `ALTER FIELD ${path} ON TABLE ${escapeIdent(table)} ${sets.join(" ")};`;
}

/** Canonical clause order for a deterministic `ALTER TABLE` body (matches the DDL order). */
const TABLE_CLAUSE_ORDER = [
  "TYPE",
  "DROP",
  "SCHEMA",
  "CHANGEFEED",
  "COMMENT",
  "PERMISSIONS",
] as const;
/** Clauses `ALTER TABLE` can express. `TYPE`/`DROP` have no ALTER form (force an OVERWRITE
 *  fallback); `SCHEMA` is always SCHEMAFULL|SCHEMALESS (re-set, never dropped); `CHANGEFEED`
 *  and `COMMENT` have `DROP` forms; `PERMISSIONS` resets to the table default (NONE). */
const TABLE_ALTERABLE = new Set([
  "SCHEMA",
  "CHANGEFEED",
  "COMMENT",
  "PERMISSIONS",
]);
const TABLE_DROPPABLE = new Set(["CHANGEFEED", "COMMENT"]);

/**
 * Emit an `ALTER TABLE` that turns the `prev` clause set into `next`. Returns `null` (caller falls
 * back to `DEFINE … OVERWRITE`) when the delta touches a clause `ALTER TABLE` can't express
 * (`TYPE` NORMAL/RELATION/ANY, or the `DROP` flag), or when clause data is unavailable.
 */
export function alterTable(
  name: string,
  prev: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): string | null {
  if (!prev || !next) return null;
  const sets: string[] = [];
  for (const k of TABLE_CLAUSE_ORDER) {
    const before = prev[k];
    const after = next[k];
    if (before === after) continue;
    if (!TABLE_ALTERABLE.has(k)) return null; // TYPE / DROP changed -> OVERWRITE
    if (after !== undefined) {
      sets.push(after); // added or changed -> re-set
    } else if (k === "PERMISSIONS") {
      sets.push("PERMISSIONS NONE"); // no `DROP PERMISSIONS`; reset to the table default
    } else if (TABLE_DROPPABLE.has(k)) {
      sets.push(`DROP ${k}`);
    } else {
      return null; // SCHEMA is never absent; anything else unexpected -> OVERWRITE
    }
  }
  if (!sets.length) return null;
  return `ALTER TABLE ${escapeIdent(name)} ${sets.join(" ")};`;
}
