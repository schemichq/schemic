/**
 * @schemic/core — the dialect-neutral engine for Schemic.
 *
 * The Driver contract + the portable schema IR + the neutral migration/diff/snapshot/CLI-support
 * engine. NO database dialect and NO authoring surface (`s.*`/`defineTable`) live here — those ship
 * in driver packages (`@schemic/surrealdb`, `@schemic/postgres`). `@schemic/cli` and the drivers all
 * build on the surface re-exported below.
 */

// --- neutral config ---------------------------------------------------------------------------
export {
  loadConfig,
  loadProject,
  makeJiti,
  type ResolvedConfig,
  resolveConnectionConfig,
} from "./cli/config";
// --- neutral diff display ---------------------------------------------------------------------
export {
  type Diff,
  type DiffItem,
  formatDiff,
  formatItems,
  formatPatch,
  isEmptyDiff,
  summarizeKinds,
  tokenDiff,
} from "./cli/diff";
// --- neutral filtering ------------------------------------------------------------------------
export {
  type Filter,
  type FilterOpts,
  filterKinds,
  inCat,
  intersectKinds,
  kindFlags,
  mergeStored,
  parseFilter,
  passesFilter,
} from "./cli/filter";
// --- pull plan + magicast merge (neutral codegen support) -------------------------------------
export {
  actionLabel,
  applyPull,
  type LocalOnly,
  lineDiff,
  type MergeOptions,
  type MergeResult,
  mergeUnits,
  type PullFilePlan,
  type PullPlan,
  type RenderedUnit,
  unifiedDiff,
} from "./cli/merge";
// --- snapshot + migration metadata ------------------------------------------------------------
export {
  checksum,
  EMPTY_STORED,
  listMigrations,
  type Migration,
  readSnapshot,
  type StoredSnapshot,
  slug,
  timestamp,
  writeSnapshot,
} from "./cli/meta";
// --- pager + style ----------------------------------------------------------------------------
export { pipeThroughPager, resolvePager } from "./cli/pager";
// --- jiti schema loader (loads a project's authored schema files agnostically) ----------------
export {
  type AnyTable,
  duplicateTables,
  existingTables,
  loadDefs,
  loadSchemas,
  scanLocalEntities,
} from "./cli/schema";
export { colorEnabled, fail, ok, plural, style } from "./cli/style";
// --- multi-connection contract (docs/MULTI-CONNECTION.md) -------------------------------------
export {
  type ConnectionConfigBase,
  type ConnectionEntry,
  type ConnectionInput,
  connectionEntry,
  isConnectionEntry,
  type ResolveContext,
  type ResolvedConnectionHandle,
} from "./connection";
// --- driver contract + registry ---------------------------------------------------------------
export {
  type ApplyOptions,
  type Authored,
  type AuthoredDef,
  type ConnectionOverrides,
  type Driver,
  driverNames,
  type EmitOptions,
  getDriver,
  type MigrationDirection,
  type MigrationRecord,
  type MigrationStore,
  registerDriver,
  type ShadowCapability,
  type Statement,
} from "./driver/driver";
// --- portable schema IR -----------------------------------------------------------------------
export {
  array,
  literal,
  nullable,
  option,
  type PortableType,
  record,
  type ScalarName,
  scalar,
  union,
} from "./driver/portable";
// (the Statement-level portable-diff is retired — superseded by the kind registry's
// planKinds/buildKindDiff in ./kind/plan.ts.)
export type {
  PortableField,
  PortablePermissions,
} from "./driver/portable-ir";
// --- kind registry (core-v2) — generic, open object kinds (docs/kind-registry.md) -------------
export {
  buildKindDiff,
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
  type PortableObject,
  planKinds,
  type Ref,
  snapshotKinds,
  snapshotObjects,
} from "./kind";
