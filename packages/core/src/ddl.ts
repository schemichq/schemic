import { z } from "zod";
import { BoundQuery, escapeIdent, toSurqlString } from "surrealdb";
import {
  objectFieldsRegistry,
  surrealTypeRegistry,
  type FieldPermissions,
  type PermOp,
  type SField,
  type Shape,
  type SurrealMeta,
  type TableDef,
  type TablePermissions,
} from "./pure";

/** Inline a BoundQuery's bindings into a literal SurrealQL string for DDL use. */
function inline(query: BoundQuery): string {
  let out = query.query;
  for (const [name, value] of Object.entries(query.bindings ?? {})) {
    out = out.replaceAll(`$${name}`, toSurqlString(value));
  }
  return out.trim();
}

/**
 * Combine a field's `ASSERT` fragments into one clause: inline any `BoundQuery` entries
 * (custom `surql` asserts), keep strings (computed checks) as-is, dedupe while preserving
 * order, and AND-join. Each fragment is already a complete boolean expr. Returns "" when
 * there are no fragments.
 */
function renderAsserts(asserts: SurrealMeta["asserts"]): string {
  if (!asserts?.length) return "";
  const frags: string[] = [];
  for (const a of asserts) {
    const frag = a instanceof BoundQuery ? inline(a) : a;
    if (frag && !frags.includes(frag)) frags.push(frag);
  }
  return frags.length ? `ASSERT ${frags.join(" AND ")}` : "";
}

/** Read a Zod schema's internal def with a loose type for traversal. */
function zdef(schema: z.ZodType): { type: string; [k: string]: unknown } {
  return schema._zod.def as unknown as { type: string; [k: string]: unknown };
}

/** Format a literal value as a SurrealQL literal type (e.g. `'admin'`, `42`). */
function surqlLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return toSurqlString(value).replace(/^s"/, '"');
}

/**
 * The SurrealQL type of a field plus any nested fields it expands into:
 * object subfields (`path.key`) and array/record element fields (`path.*`).
 */
interface FieldInfo {
  type: string;
  flexible: boolean;
  children: { suffix: string; info: FieldInfo; surreal?: SurrealMeta }[];
}
const leaf = (type: string): FieldInfo => ({ type, flexible: false, children: [] });

/** Infer a field's SurrealQL type + nested structure from a Zod schema. */
function inferField(schema: z.ZodType, seen: Set<z.ZodType> = new Set()): FieldInfo {
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

    case "optional":
    case "default":
    case "prefault": {
      const inner = inferField(def.innerType as z.ZodType, seen);
      return { ...inner, type: `option<${inner.type}>` };
    }
    case "nullable": {
      const inner = inferField(def.innerType as z.ZodType, seen);
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
      const fields = objectFieldsRegistry.get(schema); // SField shape if built via sz.object
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
        return { type: "object", flexible: left.flexible || right.flexible, children: [...merged.values()] };
      }
      return leaf("any");
    }

    case "array":
    case "set": {
      const elem = inferField((def.element ?? def.valueType) as z.ZodType, seen);
      // Element subfields live under `path.*`, but only when the element is structured.
      const children =
        elem.children.length > 0 || elem.type === "object"
          ? [{ suffix: ".*", info: elem }]
          : [];
      return { type: `array<${elem.type}>`, flexible: false, children };
    }

    case "record":
    case "map": {
      const value = inferField(def.valueType as z.ZodType, seen);
      return { type: "object", flexible: false, children: [{ suffix: ".*", info: value }] };
    }

    case "union": {
      const opts = (def.options ?? []) as z.ZodType[];
      const types = [...new Set(opts.map((o) => inferField(o, seen).type))];
      return leaf(types.join(" | ") || "any");
    }
    case "enum": {
      const entries = (def.entries ?? {}) as Record<string, string | number>;
      // Drop TS numeric-enum reverse mappings (name->number); keep the real values.
      const values = Object.values(entries).filter((v) => typeof entries[v as string] !== "number");
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
  if (spec instanceof BoundQuery) return `PERMISSIONS FOR ${ops.join(", ")} WHERE ${inline(spec)}`;

  const rules = spec as Partial<Record<PermOp, boolean | BoundQuery | string>>;
  const present = ops.filter((op) => rules[op] !== undefined);
  const resolved = new Map<PermOp, boolean | BoundQuery>();

  // Resolve an op's rule, following `same as X` references; `chain` detects cycles.
  const resolve = (op: PermOp, chain: PermOp[]): boolean | BoundQuery => {
    const cached = resolved.get(op);
    if (cached !== undefined) return cached;
    const rule = rules[op];
    if (rule === undefined) {
      throw new Error(`PERMISSIONS: "same as ${op}" references op "${op}", which is not in the spec`);
    }
    if (chain.includes(op)) {
      throw new Error(`PERMISSIONS: "same as" reference cycle: ${[...chain, op].join(" -> ")}`);
    }
    const value =
      typeof rule === "string"
        ? resolve(rule.slice("same as ".length).trim() as PermOp, [...chain, op])
        : rule;
    resolved.set(op, value);
    return value;
  };

  // Group present ops by their resolved rule's clause body (canonical order preserved).
  const groups = new Map<string, PermOp[]>();
  for (const op of present) {
    const rule = resolve(op, []);
    const body = rule === true ? "FULL" : rule === false ? "NONE" : `WHERE ${inline(rule)}`;
    const group = groups.get(body);
    if (group) group.push(op);
    else groups.set(body, [op]);
  }
  const clauses = [...groups].map(([body, group]) => `FOR ${group.join(", ")} ${body}`);
  return clauses.length ? `PERMISSIONS ${clauses.join(" ")}` : "";
}

/** Emit `DEFINE FIELD path ...` for a node, then recurse into its children. */
function emit(
  path: string,
  table: string,
  info: FieldInfo,
  surreal: SurrealMeta | undefined,
  opts: DefineOptions | undefined,
  lines: string[],
): void {
  let type = info.type;
  // A DB-side DEFAULT/VALUE means the column is always populated -> drop a leading option<>.
  if ((surreal?.default || surreal?.value) && type.startsWith("option<")) {
    type = type.slice("option<".length, -1);
  }
  const parts = [
    `DEFINE FIELD ${existsPrefix(opts)}${path} ON TABLE ${escapeIdent(table)} TYPE ${type}`,
  ];
  if (info.flexible) parts.push("FLEXIBLE");
  if (surreal?.default) {
    parts.push(`DEFAULT ${surreal.defaultAlways ? "ALWAYS " : ""}${inline(surreal.default)}`);
  }
  if (surreal?.value) parts.push(`VALUE ${inline(surreal.value)}`);
  const assertClause = renderAsserts(surreal?.asserts);
  if (assertClause) parts.push(assertClause);
  if (surreal?.readonly) parts.push("READONLY");
  if (surreal?.comment) parts.push(`COMMENT ${JSON.stringify(surreal.comment)}`);
  // Internal fields still exist on the table (so SCHEMAFULL writes succeed) but grant
  // no record-user access — internal wins over any `$permissions` on the same field.
  if (surreal?.internal) {
    parts.push("PERMISSIONS NONE");
  } else if (surreal?.permissions !== undefined) {
    const clause = renderPermissions(surreal.permissions, ["select", "create", "update"]);
    if (clause) parts.push(clause);
  }
  lines.push(`${parts.join(" ")};`);

  for (const child of info.children) {
    emit(`${path}${child.suffix}`, table, child.info, child.surreal, opts, lines);
  }
}

/** `DEFINE FIELD ...` for a field (and any nested object/array/record subfields). */
export function defineField(
  name: string,
  table: string,
  field: SField,
  opts?: DefineOptions,
): string {
  const lines: string[] = [];
  emit(escapeIdent(name), table, inferField(field.schema), field.surreal, opts, lines);
  return lines.join("\n");
}

/** `DEFINE TABLE ...` plus a `DEFINE FIELD` per field. */
export function defineTable(t: TableDef<string, Shape>, opts?: DefineOptions): string {
  const rel = t.config.relation;
  // Surreal manages id (and in/out for relations) implicitly.
  const implicit = rel ? new Set(["id", "in", "out"]) : new Set(["id"]);
  const type = rel
    ? `RELATION FROM ${rel.from.map(escapeIdent).join(" | ")} TO ${rel.to.map(escapeIdent).join(" | ")}`
    : "NORMAL";

  const head = [`DEFINE TABLE ${existsPrefix(opts)}${escapeIdent(t.name)}`, `TYPE ${type}`];
  if (t.config.drop) head.push("DROP");
  head.push(t.config.schemafull ? "SCHEMAFULL" : "SCHEMALESS");
  if (t.config.comment) head.push(`COMMENT ${JSON.stringify(t.config.comment)}`);
  // Fold permissions into the single DEFINE TABLE head (no separate OVERWRITE … PERMISSIONS).
  if (t.config.permissions !== undefined) {
    const clause = renderPermissions(t.config.permissions, ["select", "create", "update", "delete"]);
    if (clause) head.push(clause);
  }

  const lines = [`${head.join(" ")};`];
  for (const [name, field] of Object.entries(t.fields)) {
    if (implicit.has(name)) continue;
    lines.push(defineField(name, t.name, field as SField, opts));
  }
  return lines.join("\n");
}
