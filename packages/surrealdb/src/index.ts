/**
 * @schemic/surrealdb — author SurrealDB schemas with Zod, and the SurrealDB driver.
 *
 * Define tables/relations with `s.*` (a drop-in for `z.*`), generate SurrealQL DDL, and map JS <-> DB
 * across Zod's two channels via codecs (`decode`/`encode`). Importing this package registers the
 * SurrealDB driver with `@schemic/core` (so the CLI's `getDriver("surrealdb")` resolves).
 */

// Side-effect: register `surrealDriver` with the core registry on import.
import "./driver/surreal";

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
export { surrealDriver } from "./driver/surreal";
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
