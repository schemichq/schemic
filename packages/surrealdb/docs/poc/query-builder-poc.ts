/**
 * Query-builder feasibility POC (TYPES ONLY — runtime is stubbed).
 *
 * Goal: prove that a fluent `select(table).where(...).return(...)` builder can be
 * driven entirely by a @schemic/core `s` table definition, and that its RESULT
 * TYPE is correctly INFERRED as the *decoded* `App` shape (codecs applied:
 * datetime -> Date, uuid -> string, recordId -> RecordId), with projections
 * narrowing the result to exactly the selected fields.
 *
 * This is the load-bearing risk for "build a query builder on top of @schemic/core".
 * If this compiles, the core inference threading is feasible.
 *
 * Compile with:  bunx tsc --noEmit -p tsconfig.json   (from this directory)
 */

import type { RecordId } from "surrealdb";
import {
  type App,
  defineTable,
  type Shape,
  s,
  type TableDef,
} from "../../src/index.ts";

// ---------------------------------------------------------------------------
// 0. Tiny type-level test harness (no test-runner dependency)
// ---------------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// ---------------------------------------------------------------------------
// 1. The schema — a real `s` table. `id`/`createdAt`/`uid`/`manager` exercise
//    the codecs and smart-id machinery we want to flow into query results.
// ---------------------------------------------------------------------------
const User = defineTable("user", {
  name: s.string(),
  age: s.number(),
  email: s.email(),
  createdAt: s.datetime(), // DB `datetime` <-> app `Date`   (codec)
  uid: s.uuid(), //            DB `uuid`     <-> app `string` (codec)
  manager: s.recordId("user").optional(), // record link -> RecordId<"user">
});

// The decoded app type, straight from @schemic/core. The builder must reproduce
// this for a full-row select.
type UserApp = App<typeof User>;

// ---------------------------------------------------------------------------
// 2. Field references + expressions (the `where`/`return` callback surface)
// ---------------------------------------------------------------------------

/** An opaque boolean SurrealQL expression (e.g. `age >= 18`). */
interface Expr {
  readonly __expr: true;
}

/**
 * A typed handle to a field/column inside a callback. Carries the decoded type
 * `T` (used to re-type projections) and the operator surface (used by `where`).
 * In the real builder this is a Proxy that also renders the idiom path; here we
 * only need the *types*.
 */
interface FieldRef<T> {
  /** Phantom carrier of the decoded field type. */
  readonly _type: T;
  eq(value: T): Expr;
  ne(value: T): Expr;
  gt(value: T): Expr;
  gte(value: T): Expr;
  lt(value: T): Expr;
  lte(value: T): Expr;
}

/** The row object handed to `where`/`return`: every decoded field as a `FieldRef`. */
type Row<TD extends TableDef<string, Shape>> = {
  [K in keyof App<TD>]-?: FieldRef<App<TD>[K]>;
};

// ---------------------------------------------------------------------------
// 3. Projection inference — unwrap a returned shape of `FieldRef`s back to values
// ---------------------------------------------------------------------------

/** What a `.return()` callback may return: a field, or a (nested) object of them. */
type Projection = FieldRef<unknown> | { [k: string]: Projection };

/** Collapse a projection back to its concrete decoded type. */
type Unwrap<P> =
  P extends FieldRef<infer U>
    ? U
    : P extends Record<string, unknown>
      ? { [K in keyof P]: Unwrap<P[K]> }
      : never;

// ---------------------------------------------------------------------------
// 4. The builder. `R` is the per-row result; the query resolves to `R[]`.
//    Runtime is stubbed — only the type threading matters.
// ---------------------------------------------------------------------------
class Select<TD extends TableDef<string, Shape>, R = App<TD>> {
  /** Phantom: lets the tests read the inferred element type. */
  declare readonly _row: R;

  /** Filter rows. Does NOT change the result type. */
  where(_cb: (row: Row<TD>) => Expr): this {
    throw new Error("poc: runtime not implemented");
  }

  /** Project rows. RE-TYPES the result to the unwrapped projection. */
  return<P extends Projection>(
    _cb: (row: Row<TD>) => P,
  ): Select<TD, Unwrap<P>> {
    throw new Error("poc: runtime not implemented");
  }

  /** Execute (stub). Resolves to the decoded rows. */
  run(): Promise<R[]> {
    throw new Error("poc: runtime not implemented");
  }
}

function select<TD extends TableDef<string, Shape>>(_table: TD): Select<TD> {
  throw new Error("poc: runtime not implemented");
}

/** Extract the resolved result array type of a built query. */
type ResultOf<Q> =
  Q extends Select<TableDef<string, Shape>, infer R> ? R[] : never;

// ===========================================================================
// TYPE CHECKS  (each `_check*` must be `true` for the file to compile)
// ===========================================================================

// --- Check 1: projecting two fields yields exactly { name; age }[] ----------
const q1 = select(User).return((u) => ({ name: u.name, age: u.age }));
type R1 = ResultOf<typeof q1>;
// expected type: { name: string; age: number }[]
type _check1 = Expect<Equal<R1, { name: string; age: number }[]>>;

// --- Check 2: a full-row select yields the decoded App shape -----------------
//   (proves RecordId + Date + uuid-as-string survive end to end)
const q2 = select(User);
type R2 = ResultOf<typeof q2>;
// expected type: App<typeof User>[]  — i.e. includes id: RecordId<"user">,
//                createdAt: Date, uid: string, manager?: RecordId<"user">
type _check2 = Expect<Equal<R2, UserApp[]>>;

// Spelled out, to make the decoded shape explicit at a glance:
type _check2b = Expect<
  Equal<
    R2,
    Array<{
      name: string;
      age: number;
      email: string;
      createdAt: Date; //          <- datetime codec decoded
      uid: string; //              <- uuid codec decoded
      manager?: RecordId<"user"> | undefined; // <- record link
      id: RecordId<"user">; //     <- smart id
    }>
  >
>;

// --- Check 3: renamed + codec-typed projection ------------------------------
const q3 = select(User).return((u) => ({
  label: u.name,
  joined: u.createdAt, // FieldRef<Date>  ->  Date in the result
  boss: u.manager, //     FieldRef<RecordId<"user"> | undefined>
}));
type R3 = ResultOf<typeof q3>;
// expected type: { label: string; joined: Date; boss: RecordId<"user"> | undefined }[]
type _check3 = Expect<
  Equal<
    R3,
    { label: string; joined: Date; boss: RecordId<"user"> | undefined }[]
  >
>;

// --- Check 4: where() preserves the (projected) result type -----------------
const q4 = select(User)
  .where((u) => u.age.gte(18)) // operator on a FieldRef<number>
  .where((u) => u.email.eq("a@b.com")) // operator on a FieldRef<string>
  .return((u) => ({ name: u.name }));
type R4 = ResultOf<typeof q4>;
// expected type: { name: string }[]
type _check4 = Expect<Equal<R4, { name: string }[]>>;

// --- Check 5: the row handle exposes DECODED field types (not wire types) ----
//   createdAt is a FieldRef<Date>, NOT FieldRef<DateTime>; uid is string.
type RowU = Row<typeof User>;
type _check5a = Expect<Equal<RowU["createdAt"]["_type"], Date>>;
type _check5b = Expect<Equal<RowU["uid"]["_type"], string>>;
type _check5c = Expect<Equal<RowU["id"]["_type"], RecordId<"user">>>;

// Reference the checks so they are not flagged as unused.
export type Checks = [
  _check1,
  _check2,
  _check2b,
  _check3,
  _check4,
  _check5a,
  _check5b,
  _check5c,
];

// A couple of assignment-style sanity checks (compile = pass).
export const demo = async () => {
  const rows = await q1.run();
  const first = rows[0]!;
  const _n: string = first.name;
  const _a: number = first.age;
  return [_n, _a] as const;
};
