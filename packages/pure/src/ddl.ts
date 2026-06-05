import { z } from "zod";
import { escapeIdent, toSurqlString, type BoundQuery } from "surrealdb";
import {
  objectFieldsRegistry,
  surrealTypeRegistry,
  type SField,
  type Shape,
  type SurrealMeta,
  type TableDef,
} from "./pure";

/** Inline a BoundQuery's bindings into a literal SurrealQL string for DDL use. */
function inline(query: BoundQuery): string {
  let out = query.query;
  for (const [name, value] of Object.entries(query.bindings ?? {})) {
    out = out.replaceAll(`$${name}`, toSurqlString(value));
  }
  return out.trim();
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
    case "number":
      return leaf("number");
    case "int":
      return leaf("int");
    case "boolean":
      return leaf("bool");
    case "date":
      return leaf("datetime");

    case "optional":
    case "default": {
      const inner = inferField(def.innerType as z.ZodType, seen);
      return { ...inner, type: `option<${inner.type}>` };
    }
    case "nullable":
    case "readonly":
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
      const types = [...new Set(Object.values(entries).map(surqlLiteral))];
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
  if (surreal?.assert) parts.push(`ASSERT ${inline(surreal.assert)}`);
  if (surreal?.readonly) parts.push("READONLY");
  if (surreal?.comment) parts.push(`COMMENT ${JSON.stringify(surreal.comment)}`);
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

  const lines = [`${head.join(" ")};`];
  for (const [name, field] of Object.entries(t.fields)) {
    if (implicit.has(name)) continue;
    lines.push(defineField(name, t.name, field as SField, opts));
  }
  return lines.join("\n");
}
