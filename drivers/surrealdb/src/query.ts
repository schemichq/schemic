/**
 * `@schemic/surrealdb/query` subpath entry — the SurrealDB-owned typed query builder (opt-in,
 * tree-shakeable; a schema-only project never pulls it). Reads in `./query/index`, writes
 * (`create`/`update`/`remove` split builders) in `./query/write`, typed statement blocks
 * (`block()`) in `./query/block`. The SCHEMALESS (untyped) adapter — `select("user")` etc. — is in
 * `./query/schemaless`.
 */
export * from "./query/block";
export * from "./query/index";
export {
  isSchemaless,
  type SchemalessRelation,
  type SchemalessTable,
  schemaless,
  type UntypedTable,
} from "./query/schemaless";
export * from "./query/write";
