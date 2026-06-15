// The SURREAL lift/lower: maps SurrealDB's string-kind `DbStructured` to and from the neutral
// portable IR (src/driver/portable-ir.ts). Field kinds parse to/from a structured PortableType; the
// dialect-specific objects (events/functions/accesses) ride in the portable `native` payload, so a
// round-trip is lossless. This file is surreal-coupled (it imports `surql-type` + the `Struct*`
// types) and belongs to @schemic/surreal at the physical split — it is NOT part of the neutral IR.

import type {
  DbStructured,
  StructAccess,
  StructEvent,
  StructField,
  StructFunction,
  StructIndex,
  StructTable,
  StructTableKind,
} from "../cli/structure";
import type {
  PortableDb,
  PortableField,
  PortableIndex,
  PortableTable,
  PortableTableKind,
} from "@schemic/core";
import { emitSurqlType, parseSurqlType } from "./surql-type";

/** Lift a Surreal string-kind `DbStructured` into the portable IR. */
export function liftDb(db: DbStructured): PortableDb {
  return {
    tables: db.tables.map(liftTable),
    functions: db.functions.map((fn) => ({ name: fn.name, native: fn })),
    accesses: db.accesses.map((a) => ({ name: a.name, native: a })),
  };
}

function liftTable(t: StructTable): PortableTable {
  const { fields, indexes, events, kind, ...rest } = t;
  return {
    ...rest,
    kind: { ...kind } as PortableTableKind,
    fields: fields.map(liftField),
    indexes: indexes.map(
      (i): PortableIndex => ({ name: i.name, cols: i.cols, spec: i.index }),
    ),
    events: events.map((e) => ({ name: e.name, table: e.what, native: e })),
  };
}

function liftField({ kind, ...f }: StructField): PortableField {
  return { ...f, type: parseSurqlType(kind) };
}

/** Lower the portable IR back to a Surreal string-kind `DbStructured`. */
export function lowerDb(db: PortableDb): DbStructured {
  return {
    tables: db.tables.map(lowerTable),
    functions: db.functions.map((fn) => fn.native as StructFunction),
    accesses: db.accesses.map((a) => a.native as StructAccess),
  };
}

function lowerTable(t: PortableTable): StructTable {
  const { fields, indexes, events, kind, ...rest } = t;
  return {
    ...rest,
    kind: { ...kind, kind: kind.kind as StructTableKind["kind"] },
    fields: fields.map(lowerField),
    indexes: indexes.map(
      (i): StructIndex => ({ name: i.name, cols: i.cols, index: i.spec }),
    ),
    events: events.map((e) => e.native as StructEvent),
  };
}

function lowerField({ type, ...f }: PortableField): StructField {
  return { ...f, kind: emitSurqlType(type) };
}
