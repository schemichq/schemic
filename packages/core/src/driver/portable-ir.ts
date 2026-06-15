// The PORTABLE Struct-IR (Milestone 2): the existing `DbStructured` with every field's `kind` STRING
// replaced by a structured {@link PortableType}. This is the dialect-independent PIVOT both drivers
// translate through — the Surreal driver lifts its string-kind IR into it (`liftDb`) and lowers back
// (`lowerDb`); the Postgres driver produces/consumes it natively. See docs/MULTI-DB-SPIKE.md.
//
// Field CLAUSES (default/value/assert/permissions/events/…) are carried verbatim: they are SurrealQL
// expressions that don't port to other dialects, so a foreign driver ignores the ones it can't honor
// (and surfaces that as a capability gap). Only the TYPE is portable here — that's the keystone.

import type {
  DbStructured,
  StructAccess,
  StructEvent,
  StructFunction,
  StructIndex,
  StructPermissions,
  StructTable,
  StructTableKind,
} from "../cli/structure";
import type { PortableType } from "./portable";
import { emitSurqlType, parseSurqlType } from "./surql-type";

/** A field in the portable IR: the Struct field with `kind: string` swapped for `type: PortableType`. */
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
  comment?: string;
  reference?: unknown;
  permissions?: StructPermissions;
  table: string;
}

export interface PortableTable {
  name: string;
  kind: StructTableKind;
  schemafull: boolean;
  drop?: boolean;
  comment?: string;
  changefeed?: { expiry: string; original: boolean };
  permissions?: StructPermissions;
  fields: PortableField[];
  indexes: StructIndex[];
  events: StructEvent[];
}

export interface PortableDb {
  tables: PortableTable[];
  // Functions/accesses are db-level and Surreal-shaped; carried opaque for now (a foreign driver
  // that has no analogue simply drops them — a documented capability gap, not a silent loss).
  functions: StructFunction[];
  accesses: StructAccess[];
}

/** Lift a Surreal string-kind `DbStructured` into the portable IR (parse each field `kind`). */
export function liftDb(db: DbStructured): PortableDb {
  return {
    tables: db.tables.map((t) => liftTable(t)),
    functions: db.functions,
    accesses: db.accesses,
  };
}

function liftTable(t: StructTable): PortableTable {
  const { fields, ...rest } = t;
  return {
    ...rest,
    fields: fields.map(({ kind, ...f }) => ({
      ...f,
      type: parseSurqlType(kind),
    })),
  };
}

/** Lower the portable IR back to a Surreal string-kind `DbStructured` (emit each field `type`). */
export function lowerDb(db: PortableDb): DbStructured {
  return {
    tables: db.tables.map((t) => lowerTable(t)),
    functions: db.functions,
    accesses: db.accesses,
  };
}

function lowerTable(t: PortableTable): StructTable {
  const { fields, ...rest } = t;
  return {
    ...rest,
    fields: fields.map(({ type, ...f }) => ({
      ...f,
      kind: emitSurqlType(type),
    })),
  };
}
