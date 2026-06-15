/**
 * @schemic/core — author SurrealDB schemas with Zod.
 *
 * Define tables/relations with `s.*` (a drop-in for `z.*`), generate SurrealQL
 * DDL, and map JS <-> DB across Zod's two channels via codecs (`decode`/`encode`).
 */

/** Re-exported from the SDK: author SurrealQL expressions (event/permission bodies, asserts). */
export { surql } from "surrealdb";
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
// NOTE: the multi-DB driver layer (src/driver/*) is intentionally NOT re-exported from the public
// library surface yet — it transitively pulls the CLI-internal cli/* modules (which self-import
// `@schemic/core` for jiti module-identity) into the library bundle. It's consumed internally by the
// CLI (cli/portable-diff) and the tests via relative imports; the public multi-DB API is a future
// design (see docs/MULTI-DB-SPIKE.md, graduation phase).
export type {
  App,
  Create,
  Expr,
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
  defineAccess,
  defineEvent,
  defineFunction,
  defineRelation,
  defineTable,
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
