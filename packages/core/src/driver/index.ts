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
export type { PortableField, PortablePermissions } from "./portable-ir";
