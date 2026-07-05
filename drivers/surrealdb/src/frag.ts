/**
 * The typed-fragment carrier — `Surql<R>` is the `BoundQuery` subclass every schemic-built
 * fragment returns (the `surql` tag, the `surql.fn` catalog), adding the ONE retype hook:
 * `.as<T>()` (the `[T]` rule: an expression of type `T` IS a one-statement query `[T]`).
 * Its own module so the authoring index and the catalog share it without a cycle.
 */
import { BoundQuery } from "surrealdb";

/** The tag/catalog output: a `BoundQuery` plus `.as<T>()` — retype as a typed expression
 *  fragment. Type-only. */
export class Surql<R extends unknown[] = unknown[]> extends BoundQuery<R> {
  /** Retype this fragment as an expression of type `T` — `surql\`age >= 18\`.as<boolean>()`,
   *  `surql.fn.http.post(...).as<{ id?: string }>()`. Purely a type-level cast; the runtime
   *  object is unchanged. */
  as<T>(): Surql<[T]> {
    return this as unknown as Surql<[T]>;
  }
}
