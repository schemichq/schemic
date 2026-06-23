/**
 * The neutral carrier a driver's field reference extends so the core projection inference can read its
 * app-value type — the cross-driver contract for `@schemic/core/query`. Builders are driver-owned (each
 * driver ships its own `FieldRef` with its own operators at `@schemic/<driver>/query`); the ONE thing
 * core needs from any such ref is the *decoded app value* it stands for, carried here as a phantom.
 *
 * A driver's ref does: `interface SurrealRef<T> extends FieldRefBase<T> { eq(v: T): Expr; … }`.
 * `Project` (./project) then reads `T` back out of any ref in a returned projection shape.
 */
declare const REF_VALUE: unique symbol;

export interface FieldRefBase<T> {
  /** Phantom — the decoded app-value type this ref projects to. Never present at runtime. */
  readonly [REF_VALUE]: T;
}

/** The app-value type carried by a field ref (`never` if it isn't one). */
export type RefValue<R> = R extends FieldRefBase<infer T> ? T : never;
