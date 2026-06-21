/**
 * @schemic/surrealdb — author SurrealDB schemas with Zod, and the SurrealDB driver.
 *
 * Define tables/relations with `s.*` (a drop-in for `z.*`), generate SurrealQL DDL, and map JS <-> DB
 * across Zod's two channels via codecs (`decode`/`encode`). Importing this package registers the
 * SurrealDB driver with `@schemic/core` (so the CLI's `getDriver("surrealdb")` resolves).
 */

// Side-effect: register `surrealDriver` with the core registry on import.
import "./driver/surreal";

import { type BoundQuery, surql as sdkSurql } from "surrealdb";

/**
 * Author SurrealQL expressions — the `s.*` authoring API takes these `BoundQuery` values everywhere a
 * dynamic expression is allowed (`$default`/`$value`/`$computed`/`$assert`, `reference({ onDelete })`,
 * event `when`/`then`, function bodies, permissions). A thin GENERIC wrapper over the SDK's tag so a
 * direct SDK query can also carry its RESULT type — one tuple entry per statement:
 * `db.query(surql<[string[]]>\`RETURN ['a', 'b', 'c']\`)`. Plain `surql\`…\`` (no type arg) is unchanged.
 * Provided here (typed) so you stay on a single import, decoupled from the SDK version.
 */
export function surql<R extends unknown[] = unknown[]>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): BoundQuery<R> {
  return sdkSurql(strings, ...values) as BoundQuery<R>;
}
export type { BoundQuery } from "surrealdb";
/** SurrealDB config types (relocated from @schemic/core/config, now connections-only + dialect-free). */
export type {
  AuthLevel,
  CapabilityList,
  EmbeddedCapabilities,
  SurrealParams,
  SurrealZodCheck,
  SurrealZodCheckEmbedded,
  SurrealZodConnection,
} from "./config";
export type { SurrealConnectionConfig } from "./connection";
/** Multi-connection factory: `defineConfig({ connections: { db: surrealConnection({ … }) } })`. */
export { surrealConnection } from "./connection";
export type { DefineOptions, DefineStatement, FieldInfo } from "./ddl";
export {
  alterField,
  alterTable,
  assertExpr,
  braceBody,
  emitDefStatement,
  emitField,
  emitFieldStatements,
  emitStatements,
  emitTable,
  eventClause,
  fieldType,
  inferField,
  inline,
  overwriteStatement,
  removeStatement,
} from "./ddl";
export { surrealDriver } from "./driver/surreal";
export type {
  AnalyzerConfig,
  App,
  Create,
  DiskannOptions,
  Expr,
  FieldRefs,
  FulltextFieldOptions,
  FulltextOptions,
  HnswOptions,
  Shape,
  StandaloneDef,
  SurrealMeta,
  TableConfig,
  TableEvent,
  TableIndex,
  Update,
  Wire,
} from "./pure";
export {
  AccessDef,
  AnalyzerDef,
  defineAccess,
  defineAnalyzer,
  defineEvent,
  defineFunction,
  defineRelation,
  defineTable,
  defineView,
  EventDef,
  FunctionDef,
  formatForAssert,
  objectFieldsRegistry,
  RecordIdField,
  RelationDef,
  SField,
  SystemView,
  s,
  surrealTypeRegistry,
  TableDef,
} from "./pure";
/** Type a `database/seed/*.ts` default export: `export default defineSeed(async (db, ctx) => { … })`. */
export { defineSeed, type SeedFn } from "./seed";
