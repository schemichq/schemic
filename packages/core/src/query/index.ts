/**
 * `@schemic/core/query` — the dialect-neutral query toolkit. NOT a query builder: builders are
 * driver-owned (each driver ships its own at `@schemic/<driver>/query`). Core owns the *machinery* every
 * driver builder reuses so the hard parts aren't reimplemented per driver:
 *
 * - `FieldRefBase<T>` — the carrier a driver's field ref extends, so result inference is cross-driver.
 * - `Project<P>` — projection result-type inference (`.return(row => P)` → the decoded shape).
 * - the projection codec — decode a projected (subset/renamed) row at runtime.
 *
 * The `.call` capability (invoke a defined DB function + decode) lives on the `Driver` contract as
 * `CallableFunctions` (see `@schemic/core` `driver/driver`).
 */
export { projectionSchema, decodeProjection, type ProjectionField } from "./codec";
export type { Project } from "./project";
export { type FieldRefBase, type RefValue } from "./ref";
