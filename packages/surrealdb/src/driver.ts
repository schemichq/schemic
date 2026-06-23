/**
 * `@schemic/surrealdb/driver` — the engine surface: the SurrealDB `Driver` implementation, the
 * SurrealQL DDL emitters, and the `registerDriver` SIDE-EFFECT (registers `surrealDriver` with the
 * `@schemic/core` registry on import, so the CLI's `getDriver("surrealdb")` resolves). CLI/engine-only
 * — kept OUT of the side-effect-free authoring index (`@schemic/surrealdb`) so `s.*` never drags the
 * emit/diff engine into an app bundle. The CLI loader imports this subpath to register the driver.
 */

// Side-effect: register `surrealDriver` with the core registry on import.
import "./driver/surreal";

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
