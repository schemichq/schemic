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
