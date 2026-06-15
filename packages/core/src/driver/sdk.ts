// The NEUTRAL driver SDK — the public surface a driver package (@schemic/surreal, @schemic/postgres,
// …) consumes from `@schemic/core/driver`. It re-exports ONLY dialect-free building blocks: the
// Driver contract + registry, the portable IR types + constructors, and the config/diff types a
// driver's ops reference. It deliberately does NOT re-export any concrete driver (that would drag a
// dialect's whole tree into every consumer); the internal barrel (driver/index.ts) keeps those for
// core-internal relative imports.

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
export type { GeometryKind, PortableType, ScalarName } from "./portable";
export { array, literal, nullable, option, record, scalar, union } from "./portable";
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
// Types a driver's ops reference (Driver.connect/diff) — re-exported so a driver imports them from
// the one SDK entry rather than reaching into core's cli/* internals.
export type { ResolvedConfig } from "../cli/config";
export type { Diff, DiffItem } from "../cli/diff";
