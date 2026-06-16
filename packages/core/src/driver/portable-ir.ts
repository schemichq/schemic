// The PORTABLE Struct-IR: the dialect-INDEPENDENT pivot every driver translates through. A field's
// type is a structured {@link PortableType}; the structural objects a table owns (indexes, the table
// kind, CRUD permissions) have neutral shapes here, and the genuinely dialect-specific objects
// (events, functions, accesses) are carried as a neutral identity + an OPAQUE `native` payload the
// owning driver round-trips. So core embeds NO SurrealQL `Struct*` type — the Surreal driver maps to
// and from this in `liftDb`/`lowerDb` (src/driver/surreal-ir.ts); Postgres produces/consumes it
// natively. See docs/MULTI-DB-SPIKE.md.
//
// Field/permission CLAUSES (default/value/assert/index spec/…) are still carried verbatim as dialect
// expression strings: they don't port across dialects, so a foreign driver honors the ones it can and
// surfaces the rest as a documented capability gap. Only the keystone (the TYPE) is fully portable.

import type { PortableType } from "./portable";

/** CRUD permissions — each a boolean (FULL/NONE) or a dialect WHERE-expression string (carried verbatim). */
export interface PortablePermissions {
  select?: boolean | string;
  create?: boolean | string;
  update?: boolean | string;
  delete?: boolean | string;
}

/** An index on a table: neutral identity + columns; `spec` is the dialect index-type string (UNIQUE/SEARCH/…). */
export interface PortableIndex {
  name: string;
  cols: string[];
  /** Dialect index-type spec: `"UNIQUE"`, `""` (plain), or `SEARCH …`/`MTREE …`/`HNSW …`. Carried verbatim. */
  spec: string;
}

/** The kind/shape of a table. `kind` is dialect-defined (`"NORMAL"`/`"RELATION"`/…); `in`/`out` describe graph edges. */
export interface PortableTableKind {
  kind: string;
  in?: string[];
  out?: string[];
  enforced?: boolean;
}

/**
 * A row-change event/trigger. Neutral identity (`name` + owning `table`); the condition/body is
 * dialect-specific, carried in `native` (the owning driver's own representation).
 */
export interface PortableEvent {
  name: string;
  table: string;
  native: unknown;
}

/** A db-level custom function/procedure — neutral identity + opaque dialect `native` payload. */
export interface PortableFunction {
  name: string;
  native: unknown;
}

/** A db-level access/auth definition — neutral identity + opaque dialect `native` payload. */
export interface PortableAccess {
  name: string;
  native: unknown;
}

/** A field in the portable IR: the field with a structured {@link PortableType} instead of a dialect kind string. */
export interface PortableField {
  name: string;
  type: PortableType;
  flexible?: boolean;
  readonly?: boolean;
  default?: string;
  default_always?: boolean;
  value?: string;
  computed?: string;
  assert?: string;
  /**
   * A field-level CHECK constraint (dialect boolean expression, carried verbatim). DISTINCT from
   * `assert`: that is Surreal's `ASSERT`; this is the SQL `CHECK` a driver like Postgres emits. A
   * driver maps whichever of the two it supports and surfaces the other as a capability gap.
   */
  check?: string;
  comment?: string;
  /** Referential action(s) on a foreign reference. A driver honors the actions it supports. */
  reference?: { on_delete?: string; on_update?: string };
  /**
   * Auto-generated identity column — `GENERATED ALWAYS`/`BY DEFAULT AS IDENTITY`; a `serial`/
   * auto-increment column maps here too. Absent → an ordinary column. Drivers without identity ignore it.
   */
  identity?: "always" | "by-default";
  permissions?: PortablePermissions;
  table: string;
}

export interface PortableTable {
  name: string;
  kind: PortableTableKind;
  schemafull: boolean;
  drop?: boolean;
  comment?: string;
  /** Change-data-capture window (dialect feature; a driver without it drops it). */
  changefeed?: { expiry: string; original: boolean };
  permissions?: PortablePermissions;
  /**
   * Custom/composite PRIMARY KEY column(s). Absent → the driver's implicit key (e.g. Surreal's `id`).
   * A driver without composite keys honors a single-column value and surfaces multi-column as a gap.
   */
  primaryKey?: string[];
  /** Table-level CHECK constraints (dialect boolean expressions, carried verbatim). */
  checks?: string[];
  fields: PortableField[];
  indexes: PortableIndex[];
  events: PortableEvent[];
}

/**
 * A db-level dialect-native object that has NO portable structure — a Postgres ENUM/DOMAIN
 * (`CREATE TYPE`), an EXTENSION (`CREATE EXTENSION`), and the like. Neutral identity (`kind` + `name`)
 * plus an OPAQUE `native` payload the owning driver round-trips, exactly like {@link PortableFunction}/
 * {@link PortableAccess}. A driver with no such objects omits them.
 */
export interface PortableNative {
  kind: string;
  name: string;
  native: unknown;
}

export interface PortableDb {
  tables: PortableTable[];
  functions: PortableFunction[];
  accesses: PortableAccess[];
  /** Db-level dialect-native objects (Postgres ENUM/DOMAIN/EXTENSION, …). Optional; a driver without them omits it. */
  natives?: PortableNative[];
}
