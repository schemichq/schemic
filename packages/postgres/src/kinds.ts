// The POSTGRES kind registry (core-v2). Core no longer hard-codes object kinds; each driver registers
// its KINDS on a per-driver KindRegistry and core orchestrates generically (lowerSchema / planKinds /
// buildKindDiff / emitKinds). See packages/core/docs/kind-registry-contract.md.
//
// Postgres registers THREE kinds (coarse-to-fine, registration order == ordinal):
//   table       — the structured kind: columns (substrate) + PK + table CHECKs; CREATE TABLE; field-
//                 level overwrite. A FK COLUMN stays a plain `text` column here; the FK CONSTRAINT is
//                 its own kind (below) so the dependency graph can break mutual-FK cycles.
//   index       — own kind, deps -> its table (no `owner`); CREATE [UNIQUE] INDEX.
//   constraint  — own kind (FK first), deps -> [its table, the referenced table]; ALTER ADD CONSTRAINT.
//
// index/constraint DECLINE `owner` (opt-in clustering): without it the spine falls back to ordinal+name,
// so the emit order is all tables -> all indexes -> all constraints (pg's rank-grouped convention),
// not clustered per-table. Cross-table FK is then byte-identical to the fixed-slot pgEmit; a mixed
// FK+index multi-table emit differs only in the fk-vs-index sub-order (same SET, deps-correct) — which
// is why the live Driver stays fixed-slot until the coordinated Option-A flip (no double golden churn).
//
// `decompose` splits a normalized PortableDb into these kind objects — the Option-B facade adapter
// (see ./index.ts): Driver.emit = emitKinds(registry, decompose(db)); Driver.diff = buildKindDiff(
// registry, decompose(prev), decompose(next)). The CLI + PortableDb snapshot stay UNCHANGED; only this
// thin PortableDb <-> PortableObject[] seam is temporary, deleted at the coordinated Option-A flip.
// The KindEngines themselves are permanent. Per the contract, kinds are pg's own — never cross-driver.

import {
  type KindEngine,
  KindRegistry,
  type PortableObject,
  type Ref,
} from "@schemic/core";
import type { PortableDb, PortableField } from "@schemic/core/driver";
import {
  addFkSql,
  canonField,
  createTableDdl,
  dropFkSql,
  dropTableSql,
  escId,
  fieldColumnDdl,
  fkActions,
  fkName,
  normAction,
  pgColumn,
  pgEmitFields,
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

const tableEngine: KindEngine<PgTablePortable, PgTablePortable> = {
  // In the facade, objects arrive already portable (from `decompose`); `lower` is the identity. At the
  // Option-A flip it becomes the authoring -> portable map (the explode feeds lowerSchema).
  lower: (t) => t,

  // CREATE TABLE (columns + PK + table CHECKs) followed by any column COMMENTs. Same createTableDdl the
  // fixed-slot emitTable uses -> the CREATE statement is byte-identical by construction.
  emit: (t) => [
    createTableDdl({
      name: t.name,
      kind: { kind: "NORMAL" },
      schemafull: true,
      fields: t.fields,
      indexes: [],
      events: [],
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
      kind: { kind: "NORMAL" },
      schemafull: true,
      fields: t.fields.map((f) => canonField(f, t.name)),
      indexes: [],
      events: [],
      ...(t.primaryKey ? { primaryKey: t.primaryKey } : {}),
    }),

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

// --- the registry -------------------------------------------------------------------------------

export const registry = new KindRegistry();
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

// --- decompose: PortableDb -> the kinds' portable objects (the facade adapter) -------------------

/**
 * Split a (normalized) PortableDb into the registry's portable objects, exploding each table's inline
 * indexes + FKs into their own `index`/`constraint` objects. The table object keeps the FK columns as
 * plain `text` columns (the constraint object carries the FK itself). This is the inverse seam of the
 * fixed-slot emit, so emitKinds(registry, decompose(db)) reproduces the same DDL set as pgEmit(db).
 */
export function decompose(db: PortableDb): PortableObject[] {
  const out: PortableObject[] = [];
  for (const t of db.tables) {
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
        unique: ix.spec === "UNIQUE",
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
  }
  return out;
}
