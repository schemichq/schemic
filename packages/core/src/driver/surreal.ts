// The SURREAL driver — driver #1 (see docs/MULTI-DB-SPIKE.md).
//
// A thin adapter over the existing Surreal-specific functions: each op delegates to them and lifts/
// lowers between the SurrealQL string-kind IR (`DbStructured`) and the dialect-independent pivot
// (`PortableDb`) at its boundaries. So no current behavior changes, and the driver speaks the same
// portable IR the diff core and every other driver speak. In the eventual package split this file
// becomes `@surreal-zod/surreal`; for now it lives in core, clearly marked.

import type { Surreal } from "surrealdb";
import type {
  ConnectionOverrides as CfgOverrides,
  ResolvedConfig,
} from "../cli/config";
import { connect as surrealConnect } from "../cli/config";
import { type Diff, diffSnapshots } from "../cli/diff";
import { applyStatements, shadowStructured } from "../cli/introspect";
import { schemaStruct } from "../cli/lower";
import type { Snapshot } from "../cli/meta";
import { deepEqual, normalizeDb } from "../cli/struct";
import { introspectStructured, structuredSnapshot } from "../cli/structure";
import {
  type DefineStatement,
  overwriteStatement,
  removeStatement,
} from "../ddl";
import type { Shape, StandaloneDef, TableDef } from "../pure";
import type {
  ApplyOptions,
  ConnectionOverrides,
  Driver,
  EmitOptions,
  ShadowCapability,
  Statement,
} from "./driver";
import { registerDriver } from "./driver";
import { keyOf } from "./portable-diff";
import { liftDb, lowerDb, type PortableDb } from "./portable-ir";

/**
 * Re-derive the legacy (string-DDL) {@link Snapshot} from the portable IR, so the existing clause-
 * level `diffSnapshots` engine can run unchanged. `statements` come from `emit` (now clause-bearing),
 * `struct` from the lowered IR (drives cosmetic-change detection). Both sides are normalized first.
 */
function toLegacySnapshot(db: PortableDb): Snapshot {
  const norm = liftDb(normalizeDb(lowerDb(db)));
  const statements: Record<string, DefineStatement> = {};
  const snap = structuredSnapshot(lowerDb(norm));
  for (const s of Object.values(snap.statements)) statements[keyOf(s)] = s;
  return { version: 1, statements, struct: lowerDb(norm) };
}

// Apply/emit order: db-level functions first (tables/events may call fn::…), then tables, fields,
// indexes, events, and finally access (SIGNUP/SIGNIN reference tables). Mirrors introspect.ts's RANK.
const RANK: Record<DefineStatement["kind"], number> = {
  function: 0,
  table: 1,
  field: 2,
  index: 3,
  event: 4,
  access: 5,
};

const shadow: ShadowCapability<Surreal> = {
  // Apply DDL to a throwaway database, read it back via INFO STRUCTURE, drop it — the live-side
  // canonicalizer. Delegates to `shadowStructured`, then lifts to the portable IR.
  roundTrip: async (conn, config, ddl) =>
    liftDb(normalizeDb(await shadowStructured(conn, config, ddl))),
  // `ephemeral` (full isolated instance for `sz check` replay) is intentionally not wired here —
  // `check` still uses its existing path. A later milestone routes it through this capability.
};

export const surrealDriver: Driver<Surreal> = {
  name: "surreal",

  // --- IR pipeline ---------------------------------------------------------------------------

  lower(tables: TableDef<string, Shape>[], defs: StandaloneDef[]): PortableDb {
    // `schemaStruct` returns the NORMALIZED string-kind IR; lift its field kinds to PortableType.
    return liftDb(schemaStruct(tables, defs));
  },

  emit(db: PortableDb, opts?: EmitOptions): Statement[] {
    // Portable IR -> DDL: lower the portable types back to SurrealQL kinds, then rebuild canonical
    // DEFINE statements, ordered for apply. `overwrite` rewrites each as `… OVERWRITE …`.
    const snap = structuredSnapshot(lowerDb(db));
    const stmts = Object.values(snap.statements).sort(
      (a, b) => RANK[a.kind] - RANK[b.kind],
    );
    if (opts?.overwrite) {
      return stmts.map((s) => ({ ...s, ddl: overwriteStatement(s.ddl) }));
    }
    return stmts;
  },

  // SurrealQL replaces in place (DEFINE … OVERWRITE) and removes with REMOVE … IF EXISTS — both
  // non-destructive, so a changed field doesn't drop column data.
  remove: (s) => removeStatement(s),
  overwrite: (s) => overwriteStatement(s.ddl),

  async introspect(conn: Surreal, exclude?: Set<string>): Promise<PortableDb> {
    return liftDb(await introspectStructured(conn, exclude));
  },

  normalize(db: PortableDb): PortableDb {
    // Reuse the canonicalizer that operates on string kinds: lower -> normalize -> lift.
    return liftDb(normalizeDb(lowerDb(db)));
  },

  equal(a: PortableDb, b: PortableDb): boolean {
    return deepEqual(this.normalize(a), this.normalize(b));
  },

  diff(prev: PortableDb, next: PortableDb): Diff {
    // Bridge to the clause-level Surreal diff engine via re-derived legacy snapshots — preserving
    // ALTER FIELD/ALTER TABLE and the cosmetic-change detection (no portable-IR feature is lost).
    return diffSnapshots(toLegacySnapshot(prev), toLegacySnapshot(next));
  },

  // --- execution -----------------------------------------------------------------------------

  connect(
    config: ResolvedConfig,
    over?: ConnectionOverrides,
  ): Promise<Surreal> {
    // The driver's portable `ConnectionOverrides` is a structural superset of the SDK's; the only
    // soft field is `authLevel` (a string here vs. the SDK's `AuthLevel` union) — pass it through.
    return surrealConnect(config, (over ?? {}) as CfgOverrides);
  },

  async apply(
    conn: Surreal,
    statements: string[],
    opts?: ApplyOptions,
  ): Promise<void> {
    if (!statements.length) return;
    if (opts?.transactional === false) {
      for (const s of statements) await conn.query(s);
      return;
    }
    // SurrealDB is natively transactional — one BEGIN/COMMIT around the batch (matches applyStatements).
    await applyStatements(conn, statements);
  },

  shadow,
};

registerDriver(surrealDriver as Driver<unknown>);
