// lower: the pg `s.*` authoring objects (./authoring.ts) -> the driver's table IR (`PgTable`). The
// driver's `explode` then splits each PgTable into kind objects (table/index/constraint); `emit` turns
// those into pg DDL and `introspectAll` reads DDL back into the same kind objects, so author -> lower
// -> explode -> emit -> introspect -> diff round-trips. Field TYPE comes from the Zod schema's
// structural wrappers (optional/nullable/array) combined with the PgMeta pg-type token; DDL clauses
// (default/check/generated/identity/comment/reference) ride PgMeta into the field's clause slots.

import type {
  PortableField,
  PortableType,
  ScalarName,
} from "@schemic/core/driver";
import type { PgField, PgMeta, PgTableDef } from "./authoring";
import type { PgIndexInfo, PgTable } from "./emit";

/** Minimal view of a Zod schema's internal def (zod v4) — enough to peel structural wrappers. */
interface ZodDef {
  type: string;
  innerType?: { _zod: { def: ZodDef } };
  element?: { _zod: { def: ZodDef } };
}
const defOf = (schema: { _zod: { def: ZodDef } }): ZodDef => schema._zod.def;

/** Canonical pg types that map to a PORTABLE scalar (so they port cross-dialect). Others -> native. */
const CANON: Record<string, ScalarName> = {
  text: "string",
  integer: "int",
  "double precision": "float",
  numeric: "decimal",
  boolean: "bool",
  timestamptz: "datetime",
  uuid: "uuid",
  bytea: "bytes",
  interval: "duration",
};

/** A pg type token (+ params) -> portable leaf type: canonical -> scalar, parameterized/other -> native. */
function tokenToPortable(
  type: string,
  params?: (string | number)[],
): PortableType {
  if (type === "jsonb") return { t: "object", fields: {} };
  if (params && params.length > 0)
    return { t: "native", db: "postgres", name: type, params };
  const scalar = CANON[type];
  return scalar
    ? { t: "scalar", name: scalar }
    : { t: "native", db: "postgres", name: type };
}

/** Peel the Zod structural wrappers (optional/nullable/array; default/prefault/catch/readonly are transparent). */
function structure(schema: PgField["schema"]): {
  wrappers: ("option" | "nullable" | "array")[];
  leaf: { _zod: { def: ZodDef } };
} {
  const wrappers: ("option" | "nullable" | "array")[] = [];
  let cur: { _zod: { def: ZodDef } } = schema;
  for (;;) {
    const def = defOf(cur);
    if (def.type === "optional" && def.innerType) {
      wrappers.push("option");
      cur = def.innerType;
    } else if (def.type === "nullable" && def.innerType) {
      wrappers.push("nullable");
      cur = def.innerType;
    } else if (def.type === "array" && def.element) {
      wrappers.push("array");
      cur = def.element;
    } else if (
      (def.type === "default" ||
        def.type === "prefault" ||
        def.type === "catch" ||
        def.type === "readonly") &&
      def.innerType
    ) {
      cur = def.innerType; // App-land wrappers, transparent to the column type
    } else {
      break;
    }
  }
  return { wrappers, leaf: cur };
}

/** The leaf portable type from the field's pg metadata (FK -> record; else the pg-type token). */
function leafPortable(meta: PgMeta): PortableType {
  if (meta.references) return { t: "record", tables: [meta.references.table] };
  if (!meta.pg) return { t: "scalar", name: "string" };
  return tokenToPortable(meta.pg.type, meta.pg.params);
}

/** Combine the structural wrappers (outermost-first) around the leaf type. */
function portableType(
  meta: PgMeta,
  wrappers: ("option" | "nullable" | "array")[],
): PortableType {
  let type = leafPortable(meta);
  for (let i = wrappers.length - 1; i >= 0; i--) {
    const w = wrappers[i];
    type =
      w === "array"
        ? { t: "array", elem: type }
        : w === "option"
          ? { t: "option", inner: type }
          : { t: "nullable", inner: type };
  }
  return type;
}

/** One pg field -> a portable field, carrying its DDL clauses into the IR's clause slots. */
function lowerField(
  name: string,
  table: string,
  field: PgField,
): PortableField {
  const meta = field.native;
  const { wrappers } = structure(field.schema);
  const pf: PortableField = {
    name,
    table,
    type: portableType(meta, wrappers),
  };
  if (meta.default !== undefined) pf.default = meta.default;
  if (meta.check !== undefined) pf.check = meta.check;
  if (meta.generated !== undefined) pf.computed = meta.generated;
  if (meta.identity !== undefined) pf.identity = meta.identity;
  if (meta.comment !== undefined) pf.comment = meta.comment;
  if (meta.references) {
    const ref: { on_delete?: string; on_update?: string } = {};
    if (meta.references.onDelete) ref.on_delete = meta.references.onDelete;
    if (meta.references.onUpdate) ref.on_update = meta.references.onUpdate;
    if (ref.on_delete !== undefined || ref.on_update !== undefined)
      pf.reference = ref;
  }
  return pf;
}

/** One pg table definition -> the driver's table IR (fields + composite PK + table CHECKs + indexes). */
export function lowerTable(def: PgTableDef): PgTable {
  const fields: PortableField[] = [];
  const indexes: PgIndexInfo[] = [];
  const pkCols: string[] = [...(def.config.primaryKey ?? [])];

  for (const [name, field] of Object.entries(def.fields)) {
    fields.push(lowerField(name, def.name, field));
    if (field.native.unique)
      indexes.push({
        name: `${def.name}_${name}_key`,
        cols: [name],
        unique: true,
      });
    if (field.native.primaryKey && !pkCols.includes(name)) pkCols.push(name);
  }
  for (const ix of def.config.indexes ?? []) {
    indexes.push({
      name: ix.name ?? `${def.name}_${ix.cols.join("_")}_idx`,
      cols: ix.cols,
      unique: !!ix.unique,
    });
  }

  const table: PgTable = { name: def.name, fields, indexes };
  if (pkCols.length > 0) table.primaryKey = pkCols;
  if (def.config.checks && def.config.checks.length > 0)
    table.checks = def.config.checks;
  return table;
}

/** Lower the authored pg tables (+ standalone defs — none in the pg surface yet) to the table IR. */
export function pgLower(tables: PgTableDef[]): PgTable[] {
  return tables.map(lowerTable);
}
