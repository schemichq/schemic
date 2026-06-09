/**
 * surreal-zod — author SurrealDB schemas with Zod.
 *
 * Define tables/relations with `sz.*` (a drop-in for `z.*`), generate SurrealQL
 * DDL, and map JS <-> DB across Zod's two channels via codecs (`decode`/`encode`).
 */

/** Re-exported from the SDK: author SurrealQL expressions (event/permission bodies, asserts). */
export { surql } from "surrealdb";
export type { DefineOptions, DefineStatement } from "./ddl";
export {
  emitEventStatement,
  emitField,
  emitFieldStatements,
  emitStatements,
  emitTable,
  overwriteStatement,
  removeStatement,
} from "./ddl";
export type {
  App,
  Create,
  Expr,
  Shape,
  SurrealMeta,
  TableConfig,
  TableEvent,
  TableIndex,
  Update,
  Wire,
} from "./pure";
export {
  defineEvent,
  defineRelation,
  defineTable,
  EventDef,
  objectFieldsRegistry,
  RecordIdField,
  RelationDef,
  SField,
  SystemView,
  surrealTypeRegistry,
  sz,
  TableDef,
} from "./pure";
