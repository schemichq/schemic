import { z } from "zod";
import { escapeIdent, toSurqlString, type BoundQuery } from "surrealdb";
import { surrealTypeRegistry, type SField, type Shape, type TableDef } from "./pure";

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

/** Map a stock Zod schema to a SurrealQL type. */
function zodToSurreal(schema: z.ZodType): string {
  const explicit = surrealTypeRegistry.get(schema);
  if (explicit) return explicit;
  const def = zdef(schema);
  switch (def.type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "int":
      return "int";
    case "boolean":
      return "bool";
    case "date":
      return "datetime";
    case "array":
      return `array<${zodToSurreal(def.element as z.ZodType)}>`;
    case "pipe": // a codec — use its encoded (wire) side
      return zodToSurreal(def.in as z.ZodType);
    case "optional":
    case "nullable":
    case "default":
    case "readonly":
      return zodToSurreal(def.innerType as z.ZodType);
    case "object":
      return "object";
    default:
      return "any";
  }
}

/** Resolve a field's SurrealQL TYPE, honoring optionality and explicit metadata. */
function ddlType(field: SField): string {
  let schema: z.ZodType = field.schema;
  let optional = false;
  // Peel wrappers that affect optionality but not the underlying Surreal type.
  for (;;) {
    const def = zdef(schema);
    if (def.type === "optional" || def.type === "default" || def.type === "nullable") {
      if (def.type !== "nullable") optional = true;
      schema = def.innerType as z.ZodType;
      continue;
    }
    break;
  }
  const base = zodToSurreal(schema);
  // A DB-side DEFAULT/VALUE means the column is always populated -> not `option`.
  if (field.surreal.default || field.surreal.value) return base;
  return optional ? `option<${base}>` : base;
}

/** `DEFINE FIELD ...` for a single field. */
export function defineField(
  name: string,
  table: string,
  field: SField,
  opts?: { overwrite?: boolean },
): string {
  const parts = [
    `DEFINE FIELD ${opts?.overwrite ? "OVERWRITE " : ""}${escapeIdent(name)} ON TABLE ${escapeIdent(table)} TYPE ${ddlType(field)}`,
  ];
  const m = field.surreal;
  if (m.default) parts.push(`DEFAULT ${inline(m.default)}`);
  if (m.value) parts.push(`VALUE ${inline(m.value)}`);
  if (m.assert) parts.push(`ASSERT ${inline(m.assert)}`);
  if (m.readonly) parts.push("READONLY");
  if (m.comment) parts.push(`COMMENT ${JSON.stringify(m.comment)}`);
  return `${parts.join(" ")};`;
}

/** `DEFINE TABLE ...` plus a `DEFINE FIELD` per field. */
export function defineTable(
  t: TableDef<string, Shape>,
  opts?: { overwrite?: boolean },
): string {
  const rel = t.config.relation;
  // Surreal manages id (and in/out for relations) implicitly.
  const implicit = rel ? new Set(["id", "in", "out"]) : new Set(["id"]);
  const type = rel
    ? `RELATION FROM ${rel.from.map(escapeIdent).join(" | ")} TO ${rel.to.map(escapeIdent).join(" | ")}`
    : "NORMAL";

  const head = [
    `DEFINE TABLE ${opts?.overwrite ? "OVERWRITE " : ""}${escapeIdent(t.name)}`,
    `TYPE ${type}`,
  ];
  if (t.config.drop) head.push("DROP");
  head.push(t.config.schemafull ? "SCHEMAFULL" : "SCHEMALESS");
  if (t.config.comment) head.push(`COMMENT ${JSON.stringify(t.config.comment)}`);

  const lines = [`${head.join(" ")};`];
  for (const [name, field] of Object.entries(t.fields)) {
    if (implicit.has(name)) continue;
    lines.push(defineField(name, t.name, field as SField, { overwrite: opts?.overwrite }));
  }
  return lines.join("\n");
}
