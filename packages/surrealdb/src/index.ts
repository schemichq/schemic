/**
 * @schemic/surrealdb — author SurrealDB schemas with Zod.
 *
 * The **authoring** surface and nothing else: define tables/relations with `s.*` (a drop-in for `z.*`)
 * and map JS <-> DB across Zod's two channels via codecs (`decode`/`encode`). This entry is
 * **side-effect-free** — importing it registers no driver and pulls in neither the DDL emit engine nor
 * the diff/migration engine, so `s.*` is safe in app bundles. The engine surfaces live in subpaths:
 *   - `@schemic/surrealdb/driver`     — the `Driver` impl + `emit*` + the `registerDriver` side-effect.
 *   - `@schemic/surrealdb/connection` — the `surrealConnection` factory + connection config types.
 *   - `@schemic/surrealdb/query`      — the opt-in typed query builder.
 */

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
export type {
  AnalyzerConfig,
  App,
  CallArgs,
  Create,
  DiskannOptions,
  Expr,
  FieldRefs,
  Filter,
  FilterBuilder,
  FulltextFieldOptions,
  FulltextOptions,
  HnswOptions,
  Shape,
  SnowballLanguage,
  StandaloneDef,
  SurrealMeta,
  TableConfig,
  TableEvent,
  TableIndex,
  Tokenizer,
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
  ViewBuilder,
} from "./pure";
/** Type a `database/seed/*.ts` default export: `export default defineSeed(async (db, ctx) => { … })`. */
export { defineSeed, type SeedFn } from "./seed";
