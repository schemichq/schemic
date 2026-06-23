// The POSTGRES kind registry (core-v2). Core no longer hard-codes object kinds; each driver registers
// its KINDS on a per-driver KindRegistry and core orchestrates generically (lowerSchema / planKinds /
// buildKindDiff / emitKinds). See packages/core/docs/kind-registry-contract.md.
//
// Postgres registers these kinds (registration order == ordinal == emit order; reverse on drop):
//   extension   — CREATE EXTENSION IF NOT EXISTS; standalone def, FIRST (can supply types/functions).
//   enum        — CREATE TYPE … AS ENUM; standalone def, before the tables/domains that use it.
//   domain      — CREATE DOMAIN; standalone def, before the tables whose columns are typed as it.
//   sequence    — CREATE SEQUENCE; standalone def, before a column DEFAULT nextval('seq') that uses it.
//   table       — the structured kind: columns (substrate) + PK + table CHECKs; CREATE TABLE; field-
//                 level overwrite. A FK COLUMN stays a plain `text` column here; the FK CONSTRAINT is
//                 its own kind (below) so the dependency graph can break mutual-FK cycles.
//   index       — own kind, deps -> its table (no `owner`); CREATE [UNIQUE] INDEX.
//   constraint  — own kind (FK first), deps -> [its table, the referenced table]; ALTER ADD CONSTRAINT.
//   view        — CREATE VIEW; standalone def, LAST (reads tables/enums; name-only change-detection).
//   matview     — CREATE MATERIALIZED VIEW; standalone def, LAST (like view; name-only change-detection).
//
// The standalone defs (extension/enum/domain/sequence/view/matview) come in via the driver's `explode`
// (authoring `defineX`) and `introspectAll` (live read); table/index/constraint are split off a table.
//
// index/constraint DECLINE `owner` (opt-in clustering): without it the spine falls back to ordinal+name,
// so the emit order is all tables -> all indexes -> all constraints (pg's rank-grouped convention),
// not clustered per-table. Cross-table FK still emits after both tables (deps); a genuine mutual FK is
// broken because constraints depend on tables, not each other.
//
// `splitTable` turns the driver's table IR (`PgTable`, from ./lower for authoring or ./index's
// pgIntrospect for a live DB) into these kind objects. The Driver feeds it through both seams:
// `explode = splitTables(pgLower(...))` (authoring) and `introspectAll = splitTables(pgIntrospect(...))`
// (live), and core runs the generic spine (lowerSchema/buildKindDiff/emitKinds) over the result. Per
// the contract, kinds are pg's own — never cross-driver.

import {
  type KindEngine,
  KindRegistry,
  type PortableObject,
  type Ref,
} from "@schemic/core";
import type { DiffItem, PortableField } from "@schemic/core/driver";
import {
  addEnumValueSql,
  addFkSql,
  canonField,
  createDomainDdl,
  createEnumDdl,
  createExtensionDdl,
  createMatViewDdl,
  createSequenceDdl,
  createTableDdl,
  createViewDdl,
  dropDomainSql,
  dropEnumSql,
  dropExtensionSql,
  dropFkSql,
  dropMatViewSql,
  dropSequenceSql,
  dropTableSql,
  dropViewSql,
  escId,
  fieldColumnDdl,
  fkActions,
  fkName,
  normAction,
  type PgDomainAttrs,
  type PgSequenceAttrs,
  type PgTable,
  pgColumn,
  pgEmitFields,
  seqDefaults,
} from "./emit";

// --- the kinds' portable objects ----------------------------------------------------------------

/** The `table` kind's portable form: emit-ready columns (substrate) + composite PK + table CHECKs. */
export interface PgTablePortable extends PortableObject {
  kind: "table";
  name: string;
  fields: PortableField[];
  primaryKey?: string[];
  checks?: string[];
}

/** The `index` kind's portable form (a secondary/unique index over one table's columns). */
export interface PgIndexPortable extends PortableObject {
  kind: "index";
  name: string;
  table: string;
  cols: string[];
  unique: boolean;
}

/** The `constraint` kind's portable form (FK only for now; deps -> table + referenced table). */
export interface PgConstraintPortable extends PortableObject {
  kind: "constraint";
  name: string;
  table: string;
  ctype: "fk";
  column: string;
  refTable: string;
  onDelete?: string;
  onUpdate?: string;
}

const tableRef = (name: string): Ref => ({ kind: "table", name });

// --- table kind ---------------------------------------------------------------------------------

/** Column-level `COMMENT ON COLUMN` lines for a table's commented fields (emit-only; not introspected). */
function commentLines(t: PgTablePortable): string[] {
  return t.fields
    .filter((f) => f.comment !== undefined)
    .map(
      (f) =>
        `COMMENT ON COLUMN ${escId(t.name)}.${escId(f.name)} IS '${(f.comment ?? "").replace(/'/g, "''")}';`,
    );
}

/** Clauses pg cannot ALTER in place (need a drop+recreate): identity, generated, field CHECK. */
const hasHardClause = (f: PortableField) =>
  f.identity !== undefined || f.computed !== undefined || f.check !== undefined;

const sameArr = (a?: string[], b?: string[]) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Structural equality of two emit-ready fields (the table kind's change unit). */
const sameField = (a: PortableField, b: PortableField) =>
  JSON.stringify(a) === JSON.stringify(b);

const fieldKey = (table: string, name: string) => `field:${table}:${name}`;
const createInput = (t: PgTablePortable) => ({
  name: t.name,
  fields: t.fields,
  ...(t.primaryKey ? { primaryKey: t.primaryKey } : {}),
  ...(t.checks ? { checks: t.checks } : {}),
});

/**
 * Per-FIELD display items for a table change (Manuel's per-field decision): each carries its owner
 * `table` so the CLI groups them under it. `(prev,next)` diffs columns -> add/change/remove; an added
 * table `(undefined,next)` lists every column as an add (the `--full` projection); a dropped table
 * `(prev,undefined)` lists every column as a remove. A change with no column delta (a PK / table-CHECK
 * only change) falls back to a single whole-table item so it's never silently empty. DISPLAY ONLY.
 */
function fieldDisplayItems(
  prev: PgTablePortable | undefined,
  next: PgTablePortable | undefined,
): DiffItem[] {
  const table = (next ?? prev)?.name ?? "";
  const before = new Map((prev?.fields ?? []).map((f) => [f.name, f]));
  const after = new Map((next?.fields ?? []).map((f) => [f.name, f]));
  const items: DiffItem[] = [];
  for (const f of next?.fields ?? [])
    if (!before.has(f.name))
      items.push({
        op: "add",
        key: fieldKey(table, f.name),
        kind: "field",
        table,
        ddl: fieldColumnDdl(f),
      });
  for (const f of next?.fields ?? []) {
    const b = before.get(f.name);
    if (!b) continue;
    if (fieldColumnDdl(b) !== fieldColumnDdl(f) || b.comment !== f.comment)
      items.push({
        op: "change",
        key: fieldKey(table, f.name),
        kind: "field",
        table,
        before: fieldColumnDdl(b),
        after: fieldColumnDdl(f),
      });
  }
  for (const f of prev?.fields ?? [])
    if (!after.has(f.name))
      items.push({
        op: "remove",
        key: fieldKey(table, f.name),
        kind: "field",
        table,
        ddl: `ALTER TABLE ${escId(table)} DROP COLUMN IF EXISTS ${escId(f.name)};`,
        old: fieldColumnDdl(f),
      });
  if (items.length === 0 && prev && next)
    items.push({
      op: "change",
      key: `table:${table}:${table}`,
      kind: "table",
      table,
      before: createTableDdl(createInput(prev)),
      after: createTableDdl(createInput(next)),
    });
  return items;
}

const tableEngine: KindEngine<PgTablePortable, PgTablePortable> = {
  // Objects arrive already in this kind's portable shape (from `explode`/`introspectAll` via splitTable
  // / lowerSchema). `lower` is the identity — the split already produced the normalized portable object.
  lower: (t) => t,

  // CREATE TABLE (columns + PK + table CHECKs) followed by any column COMMENTs.
  emit: (t) => [
    createTableDdl({
      name: t.name,
      fields: t.fields,
      ...(t.primaryKey ? { primaryKey: t.primaryKey } : {}),
      ...(t.checks ? { checks: t.checks } : {}),
    }),
    ...commentLines(t),
  ],

  // Change-detection key (NOT the emitted DDL): the equality-relevant shape only — canonField keeps
  // type/nullability/identity/FK-actions and DROPS the rewrite-prone/non-introspected clauses
  // (DEFAULT/CHECK/GENERATED/COMMENT), and table-level CHECKs are omitted too. So those clauses stay
  // faithful in `emit` (fresh apply) but never count as a change -> no phantom-diff of a freshly
  // applied schema vs introspect (PG rewrites exprs on read; comments aren't introspected). This is
  // the fixed-slot driver's emit/equal asymmetry, restored at the kind seam.
  canonical: (t) =>
    createTableDdl({
      name: t.name,
      fields: t.fields.map((f) => canonField(f, t.name)),
      ...(t.primaryKey ? { primaryKey: t.primaryKey } : {}),
    }),

  // Per-FIELD display items (Manuel's decision: field-level changes grouped under their table). Each
  // carries `table` so the CLI groups them hierarchically. DISPLAY ONLY — never affects up/down DDL.
  // (prev,next): diff the columns; (undefined,next): list all columns as adds (the --full projection).
  displayItems: (prev, next) => fieldDisplayItems(prev, next),

  remove: (t) => [dropTableSql(t.name)],

  // In-place column ALTERs (add/drop/type/nullability/default/comment). A structural change pg can't
  // ALTER (PK, table CHECK, or a column's identity/generated/field-CHECK) falls back to drop+recreate.
  overwrite: (prev, next) => {
    const before = new Map(prev.fields.map((f) => [f.name, f]));
    const after = new Map(next.fields.map((f) => [f.name, f]));

    // Hard structural deltas -> recreate (coarse, destructive — but correct; pg has no in-place form).
    const changedHard = next.fields.some((f) => {
      const b = before.get(f.name);
      return b && (hasHardClause(f) || hasHardClause(b)) && !sameField(b, f);
    });
    const addedHard = next.fields.some(
      (f) => !before.has(f.name) && hasHardClause(f),
    );
    const removedHard = prev.fields.some(
      (f) => !after.has(f.name) && hasHardClause(f),
    );
    if (
      !sameArr(prev.primaryKey, next.primaryKey) ||
      !sameArr(prev.checks, next.checks) ||
      changedHard ||
      addedHard ||
      removedHard
    ) {
      return [...tableEngine.remove(prev), ...tableEngine.emit(next)];
    }

    const out: string[] = [];
    const t = next.name;
    // added columns (full column DDL — plain columns match the fixed-slot ADD COLUMN byte-for-byte)
    for (const f of next.fields)
      if (!before.has(f.name))
        out.push(`ALTER TABLE ${escId(t)} ADD COLUMN ${fieldColumnDdl(f)};`);
    // changed columns: type, nullability, default, comment
    for (const f of next.fields) {
      const b = before.get(f.name);
      if (!b) continue;
      const ca = pgColumn(f.type);
      const cb = pgColumn(b.type);
      if (ca.sql !== cb.sql)
        out.push(
          `ALTER TABLE ${escId(t)} ALTER COLUMN ${escId(f.name)} TYPE ${ca.sql};`,
        );
      if (ca.nullable !== cb.nullable)
        out.push(
          `ALTER TABLE ${escId(t)} ALTER COLUMN ${escId(f.name)} ${ca.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`,
        );
      if (f.default !== b.default)
        out.push(
          f.default === undefined
            ? `ALTER TABLE ${escId(t)} ALTER COLUMN ${escId(f.name)} DROP DEFAULT;`
            : `ALTER TABLE ${escId(t)} ALTER COLUMN ${escId(f.name)} SET DEFAULT ${f.default};`,
        );
      if (f.comment !== b.comment)
        out.push(
          f.comment === undefined
            ? `COMMENT ON COLUMN ${escId(t)}.${escId(f.name)} IS NULL;`
            : `COMMENT ON COLUMN ${escId(t)}.${escId(f.name)} IS '${f.comment.replace(/'/g, "''")}';`,
        );
    }
    // dropped columns
    for (const f of prev.fields)
      if (!after.has(f.name))
        out.push(
          `ALTER TABLE ${escId(t)} DROP COLUMN IF EXISTS ${escId(f.name)};`,
        );
    return out;
  },
};

// --- index kind ---------------------------------------------------------------------------------

const indexEngine: KindEngine<PgIndexPortable, PgIndexPortable> = {
  lower: (i) => i,
  emit: (i) => [
    `CREATE ${i.unique ? "UNIQUE " : ""}INDEX ${escId(i.name)} ON ${escId(i.table)} (${i.cols.map(escId).join(", ")});`,
  ],
  remove: (i) => [`DROP INDEX IF EXISTS ${escId(i.name)};`],
  // An index emits AFTER its table (deps), but NO `owner` -> no clustering: the spine then falls back
  // to ordinal+name, so all indexes emit as a rank group after all tables (pg's emit convention),
  // rather than clustered next to each table. owner is opt-in readability we deliberately decline.
  deps: (i) => [tableRef(i.table)],
  // no overwrite: an index change is a drop+recreate (the spine's default).
};

// --- constraint kind (FK) -----------------------------------------------------------------------

const constraintEngine: KindEngine<PgConstraintPortable, PgConstraintPortable> =
  {
    lower: (c) => c,
    emit: (c) => [
      addFkSql(
        c.table,
        c.column,
        c.refTable,
        fkActions({ on_delete: c.onDelete, on_update: c.onUpdate }),
      ),
    ],
    remove: (c) => [dropFkSql(c.table, c.column)],
    // A FK emits AFTER both its own table and the referenced table — this is what breaks mutual-FK
    // cycles (tables have no deps, so they create first, then the constraints between them). NO
    // `owner`: like the index kind, constraints emit as a rank group after all tables (pg convention).
    deps: (c) =>
      c.refTable === c.table
        ? [tableRef(c.table)]
        : [tableRef(c.table), tableRef(c.refTable)],
    // no overwrite: a FK change is drop+recreate (the spine's default).
  };

// --- enum kind (CREATE TYPE … AS ENUM) ----------------------------------------------------------

/** The `enum` kind's portable form: a native pg enum type and its ordered labels. */
export interface PgEnumPortable extends PortableObject {
  kind: "enum";
  name: string;
  values: string[];
}

/** Whether `next.values` only APPENDS to `prev.values` (same order, prev is a prefix) — ADD VALUE works. */
const isAppendOnly = (prev: string[], next: string[]) =>
  next.length >= prev.length && prev.every((v, i) => next[i] === v);

const enumEngine: KindEngine<PgEnumPortable, PgEnumPortable> = {
  lower: (e) => e,
  // CREATE TYPE … AS ENUM (...). emit IS canonical here — pg stores the labels verbatim (no rewrite),
  // so introspect round-trips exactly; no separate `canonical` needed (default = emit).
  emit: (e) => [createEnumDdl(e.name, e.values)],
  remove: (e) => [dropEnumSql(e.name)],
  // Appended labels -> ALTER TYPE ADD VALUE (non-destructive). Any other change (remove/reorder) has
  // no in-place form and would need a drop+recreate that fails while a column uses the type, so fall
  // back to the spine default (remove+emit) and document it as coarse.
  overwrite: (prev, next) =>
    isAppendOnly(prev.values, next.values)
      ? next.values
          .slice(prev.values.length)
          .map((v) => addEnumValueSql(next.name, v))
      : [...enumEngine.remove(prev), ...enumEngine.emit(next)],
  // No deps: a type depends on nothing. Registered FIRST (ordinal 0) so every CREATE TYPE emits
  // before the CREATE TABLEs whose columns reference it (and drops last on the reverse).
};

// --- view kind (CREATE VIEW … AS <select>) ------------------------------------------------------

/** The `view` kind's portable form: a view name + its SELECT body (verbatim authored / introspected). */
export interface PgViewPortable extends PortableObject {
  kind: "view";
  name: string;
  sql: string;
}

const viewEngine: KindEngine<PgViewPortable, PgViewPortable> = {
  lower: (v) => v,
  emit: (v) => [createViewDdl(v.name, v.sql)],
  remove: (v) => [dropViewSql(v.name)],
  // Change-detection by NAME only: Postgres rewrites a view's stored definition (expands `SELECT *`,
  // strips qualifiers, reformats), so the body can't byte-match the authored SQL. Excluding the body
  // from `canonical` means a clean apply round-trips with no phantom (presence matches); the tradeoff
  // is that a view-BODY edit isn't auto-detected (documented — drop+recreate or re-gen). A future pass
  // can normalize via the shadow engine (apply both, compare introspected definitions).
  canonical: (v) => `view:${v.name}`,
  // No overwrite: with the body excluded from diff, a detected view change is add/remove (presence).
  // No deps: registered LAST (highest ordinal) so views emit after the tables/enums they read.
};

// --- materialized view kind (CREATE MATERIALIZED VIEW … AS <select>) ----------------------------

/** The `matview` kind's portable form: a name + its SELECT body (verbatim authored / introspected). */
export interface PgMatViewPortable extends PortableObject {
  kind: "matview";
  name: string;
  sql: string;
}

const matViewEngine: KindEngine<PgMatViewPortable, PgMatViewPortable> = {
  lower: (v) => v,
  emit: (v) => [createMatViewDdl(v.name, v.sql)],
  remove: (v) => [dropMatViewSql(v.name)],
  // Name-only change-detection (same rationale as the view kind: pg rewrites the stored definition).
  canonical: (v) => `matview:${v.name}`,
  // No deps: registered LAST (after plain views) so a matview emits after the tables/views it reads.
};

// --- sequence kind (CREATE SEQUENCE) ------------------------------------------------------------

/** The `sequence` kind's portable form: a name + its explicit attributes (omitted -> pg defaults). */
export interface PgSequencePortable extends PortableObject, PgSequenceAttrs {
  kind: "sequence";
  name: string;
}

/** Effective attributes (author's value or pg's default) — so authoring-without-opts matches introspect. */
const seqEffective = (s: PgSequencePortable) => ({
  start: s.start ?? seqDefaults.start,
  increment: s.increment ?? seqDefaults.increment,
  min: s.min ?? seqDefaults.min,
  max: s.max ?? seqDefaults.max,
  cache: s.cache ?? seqDefaults.cache,
  cycle: s.cycle ?? seqDefaults.cycle,
});

const sequenceEngine: KindEngine<PgSequencePortable, PgSequencePortable> = {
  lower: (s) => s,
  emit: (s) => [createSequenceDdl(s.name, s)],
  remove: (s) => [dropSequenceSql(s.name)],
  // Canonical over the EFFECTIVE attributes (defaults filled), so `CREATE SEQUENCE s;` (no opts) and the
  // fully-defaulted introspected sequence compare equal — no phantom — while a real attribute change
  // (start/increment/min/max/cache/cycle) is still detected. No in-place ALTER: a change drop+recreates.
  canonical: (s) => `sequence:${s.name}:${JSON.stringify(seqEffective(s))}`,
  // No deps: registered before tables so a column DEFAULT nextval('seq') resolves.
};

// --- domain kind (CREATE DOMAIN) ----------------------------------------------------------------

/** The `domain` kind's portable form: name + base type + the optional NOT NULL / DEFAULT / CHECK clauses. */
export interface PgDomainPortable extends PortableObject, PgDomainAttrs {
  kind: "domain";
  name: string;
}

/**
 * Normalize a domain's base type to a single spelling so the authored token (`varchar(50)`) and the
 * introspected `information_schema` form (`character varying(50)`) compare equal in `canonical`.
 */
const canonDomainBase = (t: string): string =>
  t
    .toLowerCase()
    .replace("character varying", "varchar")
    .replace(/\bcharacter\b/, "char")
    .replace("timestamp with time zone", "timestamptz")
    .replace("timestamp without time zone", "timestamp")
    .replace("time with time zone", "timetz")
    .replace("time without time zone", "time")
    .replace(/\s+/g, " ")
    .trim();

const domainEngine: KindEngine<PgDomainPortable, PgDomainPortable> = {
  lower: (d) => d,
  emit: (d) => [createDomainDdl(d.name, d)],
  remove: (d) => [dropDomainSql(d.name)],
  // Canonical = name + base type + NOT NULL (all reliably introspected). DEFAULT/CHECK are emit-faithful
  // but EXCLUDED — pg rewrites their expressions on read (`a > 0` -> `(VALUE > 0)`), same line the table
  // kind draws for column default/check. So a clean apply round-trips; a default/check edit isn't
  // auto-diffed (drop+recreate / re-gen).
  canonical: (d) =>
    `domain:${d.name}:${canonDomainBase(d.baseType)}:${d.notNull ? "nn" : ""}`,
  // No deps: registered before tables so a column typed as the domain resolves.
};

// --- extension kind (CREATE EXTENSION) ----------------------------------------------------------

/** The `extension` kind's portable form: the extension name (+ optional schema/version, emit-only). */
export interface PgExtensionPortable extends PortableObject {
  kind: "extension";
  name: string;
  schema?: string;
  version?: string;
}

const extensionEngine: KindEngine<PgExtensionPortable, PgExtensionPortable> = {
  lower: (e) => e,
  emit: (e) => [
    createExtensionDdl(e.name, {
      ...(e.schema !== undefined ? { schema: e.schema } : {}),
      ...(e.version !== undefined ? { version: e.version } : {}),
    }),
  ],
  remove: (e) => [dropExtensionSql(e.name)],
  // Name-only: SCHEMA/VERSION are install-time choices that pg materializes (a fresh CREATE picks the
  // default version), so presence is the reliable round-trip unit. Registered FIRST — an extension can
  // supply types/functions everything else uses.
  canonical: (e) => `extension:${e.name}`,
};

// --- the registry -------------------------------------------------------------------------------

export const registry = new KindRegistry();
// Registration order == ordinal == emit order. The "pre-table" kinds first (a table's columns/defaults
// can reference them), then table -> index -> constraint, then the read-only views LAST (after the
// tables/enums they read). Reverse order applies on drop (down migrations).
// extension FIRST: it can supply types/functions everything else uses.
registry.define({
  name: "extension",
  build: (e: PgExtensionPortable) => e,
  ...extensionEngine,
});
// enum: a CREATE TYPE must emit before the tables/domains that use it.
registry.define({
  name: "enum",
  build: (e: PgEnumPortable) => e,
  ...enumEngine,
});
// domain: a CREATE DOMAIN must emit before the tables whose columns are typed as it.
registry.define({
  name: "domain",
  build: (d: PgDomainPortable) => d,
  ...domainEngine,
});
// sequence: must emit before a column DEFAULT nextval('seq') that references it.
registry.define({
  name: "sequence",
  build: (s: PgSequencePortable) => s,
  ...sequenceEngine,
});
registry.define({
  name: "table",
  build: (t: PgTablePortable) => t,
  ...tableEngine,
});
registry.define({
  name: "index",
  build: (i: PgIndexPortable) => i,
  ...indexEngine,
});
registry.define({
  name: "constraint",
  build: (c: PgConstraintPortable) => c,
  ...constraintEngine,
});
// view then matview LAST (highest ordinals): they read tables/enums, so they emit after them.
registry.define({
  name: "view",
  build: (v: PgViewPortable) => v,
  ...viewEngine,
});
registry.define({
  name: "matview",
  build: (v: PgMatViewPortable) => v,
  ...matViewEngine,
});

// --- splitTable: the driver's table IR -> the registry's kind objects ----------------------------

/**
 * Split one `PgTable` (from `lowerTable` for authoring, or `pgIntrospect` for a live DB) into the
 * registry's portable objects: the `table` (columns substrate + PK + table CHECKs, with FK columns kept
 * as plain `text` columns) plus its `index` and `constraint` (FK) objects. The single seam both
 * `explode` (authoring) and `introspectAll` (live) go through, so a clean apply round-trips to a zero
 * diff. Replaces the old PortableDb<->objects facade adapter.
 */
export function splitTable(t: PgTable): PortableObject[] {
  const out: PortableObject[] = [];
  const fields = pgEmitFields(t);
  const table: PgTablePortable = {
    kind: "table",
    name: t.name,
    fields,
    ...(t.primaryKey && t.primaryKey.length > 0
      ? { primaryKey: t.primaryKey }
      : {}),
    ...(t.checks && t.checks.length > 0 ? { checks: t.checks } : {}),
  };
  out.push(table);

  for (const ix of t.indexes) {
    const index: PgIndexPortable = {
      kind: "index",
      name: ix.name,
      table: t.name,
      cols: ix.cols,
      unique: ix.unique,
    };
    out.push(index);
  }

  for (const f of fields) {
    const ref = pgColumn(f.type).references;
    if (!ref) continue;
    const onDelete = normAction(f.reference?.on_delete);
    const onUpdate = normAction(f.reference?.on_update);
    const fk: PgConstraintPortable = {
      kind: "constraint",
      name: fkName(t.name, f.name),
      table: t.name,
      ctype: "fk",
      column: f.name,
      refTable: ref,
      ...(onDelete ? { onDelete } : {}),
      ...(onUpdate ? { onUpdate } : {}),
    };
    out.push(fk);
  }
  return out;
}

/** Split many `PgTable`s into the flat kind-object list (the `explode`/`introspectAll` shape). */
export const splitTables = (tables: PgTable[]): PortableObject[] =>
  tables.flatMap(splitTable);

/** A native enum (authoring `PgEnumDef` or introspected) -> its `enum` kind object. */
export const enumPortable = (
  name: string,
  values: readonly string[],
): PgEnumPortable => ({ kind: "enum", name, values: [...values] });

/** A view (authoring `PgViewDef` or introspected) -> its `view` kind object. */
export const viewPortable = (name: string, sql: string): PgViewPortable => ({
  kind: "view",
  name,
  sql,
});

/** A materialized view (authoring `PgMatViewDef` or introspected) -> its `matview` kind object. */
export const matViewPortable = (
  name: string,
  sql: string,
): PgMatViewPortable => ({
  kind: "matview",
  name,
  sql,
});

/** A sequence (authoring `PgSequenceDef` or introspected) -> its `sequence` kind object. */
export const sequencePortable = (
  name: string,
  attrs: PgSequenceAttrs = {},
): PgSequencePortable => ({ kind: "sequence", name, ...attrs });

/** A domain (authoring `PgDomainDef` or introspected) -> its `domain` kind object. */
export const domainPortable = (
  name: string,
  attrs: PgDomainAttrs,
): PgDomainPortable => ({ kind: "domain", name, ...attrs });

/** An extension (authoring `PgExtensionDef` or introspected) -> its `extension` kind object. */
export const extensionPortable = (
  name: string,
  attrs: { schema?: string; version?: string } = {},
): PgExtensionPortable => ({ kind: "extension", name, ...attrs });
