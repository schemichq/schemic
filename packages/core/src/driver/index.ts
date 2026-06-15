// The driver layer — the multi-DB seam (see docs/MULTI-DB-SPIKE.md).

export type {
  ApplyOptions,
  ConnectionOverrides,
  Driver,
  EmitOptions,
  ShadowCapability,
  Statement,
} from "./driver";
export { driverNames, getDriver, registerDriver } from "./driver";
export type {
  GeometryKind,
  PortableType,
  ScalarName,
} from "./portable";
export {
  array,
  literal,
  nullable,
  option,
  record,
  scalar,
  union,
} from "./portable";
export type {
  PortableDb,
  PortableField,
  PortableTable,
} from "./portable-ir";
export { liftDb, lowerDb } from "./portable-ir";
// Registers the "postgres" driver as a side effect of import.
export { type PgConn, postgresDriver } from "./postgres";
export { emitSurqlType, parseSurqlType } from "./surql-type";
// Registers the "surreal" driver as a side effect of import.
export { surrealDriver } from "./surreal";
