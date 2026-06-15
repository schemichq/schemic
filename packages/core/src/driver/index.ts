// The driver layer — the multi-DB seam (see docs/MULTI-DB-SPIKE.md).

export type {
  ApplyOptions,
  Authored,
  AuthoredDef,
  ConnectionOverrides,
  Driver,
  EmitOptions,
  MigrationDirection,
  MigrationRecord,
  MigrationStore,
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
  PortableAccess,
  PortableDb,
  PortableEvent,
  PortableField,
  PortableFunction,
  PortableIndex,
  PortablePermissions,
  PortableTable,
  PortableTableKind,
} from "./portable-ir";
// liftDb/lowerDb are SURREAL lift/lower (not neutral IR) — they move to @schemic/surreal at the split.
export { liftDb, lowerDb } from "./surreal-ir";
// NOTE: the "postgres" driver is now the separate @schemic/postgres package (it self-registers on
// import). Core no longer bundles it — the neutral SDK lives at `@schemic/core/driver` (src/driver/sdk.ts).
export { emitSurqlType, parseSurqlType } from "./surql-type";
// Registers the "surreal" driver as a side effect of import.
export { surrealDriver } from "./surreal";
