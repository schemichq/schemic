/**
 * `@schemic/surrealdb/query` subpath entry — the SurrealDB-owned typed query builder (opt-in,
 * tree-shakeable; a schema-only project never pulls it). Reads in `./query/index`, writes
 * (`create`/`update`/`remove` split builders) in `./query/write`.
 */
export * from "./query/index";
export * from "./query/write";
