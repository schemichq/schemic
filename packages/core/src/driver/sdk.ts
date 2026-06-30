// The NEUTRAL driver SDK — the public surface a driver package (@schemic/surrealdb, @schemic/postgres,
// …) consumes from `@schemic/core/driver`. It re-exports ONLY dialect-free building blocks: the
// Driver contract + registry, the portable IR types + constructors, and the config/diff types a
// driver's ops reference. It deliberately does NOT re-export any concrete driver (that would drag a
// dialect's whole tree into every consumer); the internal barrel (driver/index.ts) keeps those for
// core-internal relative imports.

// Types a driver's ops reference (Driver.connect/diff) — re-exported so a driver imports them from
// the one SDK entry rather than reaching into core's cli/* internals.
export type { ResolvedConfig } from "../cli-kit/config";
export type { Diff, DiffItem } from "../cli-kit/diff";
// Multi-connection: the primitive each driver wraps in its typed `<driver>Connection(...)` factory.
export {
  type ConnectionConfigBase,
  type ConnectionEntry,
  type ConnectionInput,
  connectionEntry,
  type ResolveContext,
} from "../connection";
export type {
  ApplyOptions,
  Authored,
  AuthoredDef,
  CommandArgs,
  CommandContext,
  CommandIo,
  ConnectionOverrides,
  Driver,
  DriverCommand,
  EmitOptions,
  MigrationDirection,
  MigrationRecord,
  MigrationStore,
  ParsedCommandArgs,
  ShadowCapability,
  Statement,
} from "./driver";
export { driverNames, getDriver, registerDriver } from "./driver";
export type { GeometryKind, PortableType, ScalarName } from "./portable";
export {
  array,
  literal,
  nullable,
  option,
  record,
  scalar,
  union,
} from "./portable";
// The field SUBSTRATE every kind composes (the fixed-slot object types are retired — a driver owns
// its own portable shapes; see ../kind).
export type { PortableField, PortablePermissions } from "./portable-ir";
// The KIND REGISTRY (core-v2) — what a driver builds its `registry`/`explode`/`introspectAll` against.
export {
  type Definable,
  emitKinds,
  introspectKinds,
  type KindEngine,
  type KindPlan,
  KindRegistry,
  type KindSnapshot,
  type KindSpec,
  lowerSchema,
  type OrderNode,
  orderObjects,
  buildKindDiff,
  planKinds,
  type PortableObject,
  type Ref,
  snapshotKinds,
  snapshotObjects,
} from "../kind";
