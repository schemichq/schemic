/**
 * `@schemic/surrealdb/query` — the SurrealDB-native, opt-in query builder over `@schemic/core/query`.
 * Driver-OWNED surface: the operators + the lowering to SurrealQL live here; the cross-driver machinery
 * (projection inference + the projection decode) is reused from core.
 *
 * Scope (Phase-1): single-table `SELECT` — `where` (comparisons, `in`/`notIn`, `contains*`,
 * `startsWith`/`endsWith`, NONE checks, and/or), `orderBy`, `limit`/`start`, a flat `return`
 * projection, plus the single-row terminals `one()`/`get(T, id)` and `count()`. Decode-by-default;
 * `.raw()` opts out. NO graph/FETCH yet (writes live in `./write`).
 */
import {
  brandRef,
  decodeProjection,
  type FieldRefBase,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { escapeIdent, RecordId, type Surreal } from "surrealdb";
import type { App, TableDef, Wire } from "../pure";

// --- the field-ref surface (driver-owned: operators + the column it carries) --------------------

/** Binary operators lowered as `col <op> $bind` (spellings live-verified on 3.1.4). */
type BinOp =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "IN"
  | "NOT IN"
  | "CONTAINS"
  | "CONTAINSANY"
  | "CONTAINSALL";
type Expr =
  | {
      readonly kind: "cmp";
      readonly col: string;
      readonly op: BinOp;
      readonly value: unknown;
    }
  | {
      readonly kind: "strfn";
      readonly fn: "string::starts_with" | "string::ends_with";
      readonly col: string;
      readonly value: string;
    }
  | { readonly kind: "none"; readonly col: string; readonly not: boolean }
  | { readonly kind: "and" | "or"; readonly parts: readonly Expr[] };

/** The operators every column carries (comparisons, set membership, NONE checks). */
export interface FieldRefOps<T> extends FieldRefBase<T> {
  eq(v: T): Expr;
  neq(v: T): Expr;
  lt(v: T): Expr;
  lte(v: T): Expr;
  gt(v: T): Expr;
  gte(v: T): Expr;
  /** `col IN [...]` — the value is one of. */
  in(values: readonly T[]): Expr;
  /** `col NOT IN [...]`. */
  notIn(values: readonly T[]): Expr;
  /** `col = NONE` — the field is absent (optional fields). */
  isNone(): Expr;
  /** `col != NONE` — the field is present. */
  isNotNone(): Expr;
}
/** String-only operators (`string::starts_with`/`ends_with`, substring `CONTAINS`). */
export interface StringRefOps {
  startsWith(prefix: string): Expr;
  endsWith(suffix: string): Expr;
  /** `col CONTAINS $substr` — substring test. */
  contains(substring: string): Expr;
}
/** Array-only operators (SurrealDB `CONTAINS`/`CONTAINSANY`/`CONTAINSALL`). */
export interface ArrayRefOps<E> {
  /** `col CONTAINS $v` — the array holds the element. */
  contains(v: E): Expr;
  containsAny(vs: readonly E[]): Expr;
  containsAll(vs: readonly E[]): Expr;
}

// biome-ignore lint/suspicious/noExplicitAny: the canonical `IsAny` probe.
type IsAny<T> = 0 extends 1 & T ? true : false;

/** A reference to a column inside a `where`/`orderBy`/`return` callback. Extends the neutral
 *  `FieldRefBase<T>` (so core's `Project` can read its app type); the operator set narrows by the
 *  column's app type — string ops on strings, `contains*` on arrays. The `IsAny` guard keeps the
 *  shape-agnostic `TableDef<string, any>` row assignable (an `any` column gets just the base ops). */
export type FieldRef<T> = FieldRefOps<T> &
  (IsAny<T> extends true
    ? unknown
    : ([NonNullable<T>] extends [string] ? StringRefOps : unknown) &
        ([NonNullable<T>] extends [readonly (infer E)[]]
          ? ArrayRefOps<E>
          : unknown));

/** The typed row handed to a callback: every column as a `FieldRef`. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export type Row<TD extends TableDef<string, any>> = {
  [K in keyof App<TD>]-?: FieldRef<App<TD>[K]>;
};

export const and = (...parts: Expr[]): Expr => ({ kind: "and", parts });
export const or = (...parts: Expr[]): Expr => ({ kind: "or", parts });

/** Runtime field ref — carries its column name; phantom `FieldRefBase` member is type-only. */
interface RuntimeRef {
  readonly __col: string;
}
function makeRef(col: string): FieldRef<unknown> {
  const cmp =
    (op: BinOp) =>
    (value: unknown): Expr => ({ kind: "cmp", col, op, value });
  const strfn =
    (fn: "string::starts_with" | "string::ends_with") =>
    (value: string): Expr => ({ kind: "strfn", fn, col, value });
  return brandRef({
    __col: col,
    eq: cmp("="),
    neq: cmp("!="),
    lt: cmp("<"),
    lte: cmp("<="),
    gt: cmp(">"),
    gte: cmp(">="),
    in: cmp("IN"),
    notIn: cmp("NOT IN"),
    contains: cmp("CONTAINS"),
    containsAny: cmp("CONTAINSANY"),
    containsAll: cmp("CONTAINSALL"),
    startsWith: strfn("string::starts_with"),
    endsWith: strfn("string::ends_with"),
    isNone: (): Expr => ({ kind: "none", col, not: false }),
    isNotNone: (): Expr => ({ kind: "none", col, not: true }),
  }) as FieldRef<unknown>;
}
const colOf = (ref: unknown): string => (ref as RuntimeRef).__col;

/** INTERNAL (shared with `./write`): the typed callback row for a table, every column a ref. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export function refsFor<TD extends TableDef<string, any>>(table: TD): Row<TD> {
  const refs: Record<string, FieldRef<unknown>> = {};
  for (const key of Object.keys(table.object.shape)) refs[key] = makeRef(key);
  return refs as unknown as Row<TD>;
}
/** INTERNAL (shared with `./write`): a ref's column name. */
export const refCol: (ref: unknown) => string = colOf;

/** A record target: the app-typed smart id (a `RecordId`) or its plain string id part. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export type TargetId<TD extends TableDef<string, any>> = App<TD>["id"] | string;

/** INTERNAL (shared with `./write`): normalize a target to a `RecordId` (a plain string is the
 *  STRING id part — no numeric coercion). */
export const thingOf = (
  // biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
  table: TableDef<string, any>,
  id: unknown,
): RecordId =>
  id instanceof RecordId ? id : new RecordId(table.name, id as string);

// --- SurrealQL lowering --------------------------------------------------------------------------

interface Lowered {
  readonly sql: string;
  readonly vars: Record<string, unknown>;
}

function lowerExpr(e: Expr, vars: Record<string, unknown>): string {
  if (e.kind === "cmp") {
    const bind = `b${Object.keys(vars).length}`;
    vars[bind] = e.value;
    return `${escapeIdent(e.col)} ${e.op} $${bind}`;
  }
  if (e.kind === "strfn") {
    const bind = `b${Object.keys(vars).length}`;
    vars[bind] = e.value;
    return `${e.fn}(${escapeIdent(e.col)}, $${bind})`;
  }
  if (e.kind === "none")
    return `${escapeIdent(e.col)} ${e.not ? "!=" : "="} NONE`;
  const joined = e.parts
    .map((p) => lowerExpr(p, vars))
    .join(e.kind === "and" ? " AND " : " OR ");
  return `(${joined})`;
}

// --- the builder --------------------------------------------------------------------------------

/** The minimal connection the builder needs to execute — a `.query(sql, vars)`. Both a `Surreal`
 *  client and a forked `SurrealSession` satisfy it, so a bound builder works against either. */
export type Queryable = Pick<Surreal, "query">;

interface State {
  where?: Expr;
  order?: { col: string; dir: "asc" | "desc" };
  limit?: number;
  start?: number;
  proj?: { as: string; col: string }[]; // flat projection (undefined => SELECT *)
  decode: boolean;
  /** A single-record target (`get(T, id)`) — `FROM $__thing` instead of the table. */
  target?: RecordId;
  /** A pre-bound connection (set by the ORM client) — makes the builder awaitable (`then`) and lets
   *  `.run()` be called with no argument. Absent for the standalone `select(table).run(conn)` path. */
  conn?: Queryable;
}

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
class Select<TD extends TableDef<string, any>, Res> {
  private readonly row: Row<TD>;
  constructor(
    private readonly table: TD,
    private readonly state: State,
  ) {
    this.row = refsFor(table);
  }

  private next<R>(patch: Partial<State>): Select<TD, R> {
    return new Select<TD, R>(this.table, { ...this.state, ...patch });
  }

  where(fn: (row: Row<TD>) => Expr): Select<TD, Res> {
    return this.next<Res>({ where: fn(this.row) });
  }

  orderBy(
    fn: (row: Row<TD>) => FieldRefOps<unknown>,
    dir: "asc" | "desc" = "asc",
  ): Select<TD, Res> {
    return this.next<Res>({ order: { col: colOf(fn(this.row)), dir } });
  }

  limit(n: number): Select<TD, Res> {
    return this.next<Res>({ limit: n });
  }

  /** Skip the first `n` matching rows (`START n`) — pair with `limit` for pagination. */
  start(n: number): Select<TD, Res> {
    return this.next<Res>({ start: n });
  }

  /** Project to a flat shape of refs — re-types the result to the decoded projection (`Project<P>`). */
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): Select<TD, Project<P>> {
    const shape = fn(this.row);
    const proj = Object.entries(shape).map(([as, ref]) => ({
      as,
      col: colOf(ref),
    }));
    return this.next<Project<P>>({ proj });
  }

  /** Skip decode — return raw wire rows. */
  raw(): Select<TD, Wire<TD>> {
    return this.next<Wire<TD>>({ decode: false });
  }

  /** Take the FIRST matching row (forces `LIMIT 1`) — resolves to the row or `undefined`. */
  one(): SelectOne<Res> {
    return new SelectOne<Res>(this.next<Res>({ limit: 1 }));
  }

  /** Count the matching rows (`SELECT count() … GROUP ALL`) — `where` applies; order/limit/projection
   *  don't. Awaitable when bound; `.run(conn)` standalone. */
  count(): CountQuery {
    return new CountQuery(this.table.name, this.state.where, this.state.conn);
  }

  /** The SurrealQL + named binds this builder lowers to. */
  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    const s = this.state;
    const cols = s.proj
      ? s.proj
          .map((p) =>
            p.as === p.col
              ? escapeIdent(p.col)
              : `${escapeIdent(p.col)} AS ${escapeIdent(p.as)}`,
          )
          .join(", ")
      : "*";
    let from: string;
    if (s.target) {
      vars.__thing = s.target;
      from = "$__thing";
    } else {
      from = escapeIdent(this.table.name);
    }
    let sql = `SELECT ${cols} FROM ${from}`;
    if (s.where) sql += ` WHERE ${lowerExpr(s.where, vars)}`;
    if (s.order)
      sql += ` ORDER BY ${escapeIdent(s.order.col)} ${s.order.dir.toUpperCase()}`;
    if (s.limit !== undefined) sql += ` LIMIT ${Number(s.limit)}`;
    if (s.start !== undefined) sql += ` START ${Number(s.start)}`;
    return { sql, vars };
  }

  /** Decode raw rows per the current shape (full-row codec, or core's projection codec). Used by `run`;
   *  exposed so decode-by-default is testable without a live server. */
  decodeRows(rows: readonly unknown[]): Res[] {
    if (!this.state.decode) return rows as Res[];
    if (this.state.proj) {
      const fields: ProjectionField[] = this.state.proj.map((p) => ({
        as: p.as,
        schema: this.table.object.shape[p.col],
      }));
      return decodeProjection(fields, rows) as Res[];
    }
    return rows.map((r) => this.table.decode(r)) as Res[];
  }

  /** Execute against `conn` (or the pre-bound connection, if this builder came from a client). */
  async run(conn?: Queryable): Promise<Res[]> {
    const c = conn ?? this.state.conn;
    if (!c)
      throw new Error(
        "select() is not bound to a connection — pass one to `.run(conn)`, or use a bound client (`connect()`).",
      );
    const { sql, vars } = this.toSQL();
    const out = (await c.query(sql, vars)) as unknown[];
    const rows = (out[0] ?? []) as unknown[];
    return this.decodeRows(rows);
  }

  /** PromiseLike: awaiting a **bound** builder runs it (drizzle-style `await db.select(User)…`). An
   *  unbound builder rejects with the same guidance as {@link Select.run}. */
  then<TResult1 = Res[], TResult2 = never>(
    onfulfilled?: ((value: Res[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** A single-row terminal over a {@link Select} — resolves to the first row or `undefined`. */
export class SelectOne<Res> {
  // biome-ignore lint/suspicious/noExplicitAny: the wrapped Select's table shape is irrelevant here.
  constructor(private readonly sel: Select<any, Res>) {}

  /** The SurrealQL + named binds the wrapped select lowers to. */
  toSQL(): Lowered {
    return this.sel.toSQL();
  }

  async run(conn?: Queryable): Promise<Res | undefined> {
    const rows = await this.sel.run(conn);
    return rows[0];
  }

  then<TResult1 = Res | undefined, TResult2 = never>(
    onfulfilled?:
      | ((value: Res | undefined) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** A count terminal — `SELECT count() FROM <table> [WHERE …] GROUP ALL`, resolves to a number. */
export class CountQuery {
  constructor(
    private readonly table: string,
    private readonly where: Expr | undefined,
    private readonly conn?: Queryable,
  ) {}

  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    let sql = `SELECT count() FROM ${escapeIdent(this.table)}`;
    if (this.where) sql += ` WHERE ${lowerExpr(this.where, vars)}`;
    sql += " GROUP ALL";
    return { sql, vars };
  }

  async run(conn?: Queryable): Promise<number> {
    const c = conn ?? this.conn;
    if (!c)
      throw new Error(
        "count() is not bound to a connection — pass one to `.run(conn)`, or use a bound client (`connect()`).",
      );
    const { sql, vars } = this.toSQL();
    const out = (await c.query(sql, vars)) as unknown[];
    const rows = (out[0] ?? []) as { count?: number }[];
    return rows[0]?.count ?? 0;
  }

  then<TResult1 = number, TResult2 = never>(
    onfulfilled?: ((value: number) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** Start a single-table SELECT. Bare result is the decoded row `App<TD>`; `.return(...)` re-types it.
 *  Pass a `conn` to pre-bind it (the ORM client does this) — then the builder is awaitable and `.run()`
 *  needs no argument; omit it for the standalone `select(table).run(conn)` path. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export function select<TD extends TableDef<string, any>>(
  table: TD,
  conn?: Queryable,
): Select<TD, App<TD>> {
  return new Select<TD, App<TD>>(table, { decode: true, conn });
}

/** Fetch ONE record by id — `get(User, id)` resolves to the decoded row or `undefined`. `id` is the
 *  app-typed `RecordId` or its plain string id part. The read half of id-chaining: `create` hands you
 *  an id, `get` fetches it back. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export function get<TD extends TableDef<string, any>>(
  table: TD,
  id: TargetId<TD>,
  conn?: Queryable,
): SelectOne<App<TD>> {
  return new Select<TD, App<TD>>(table, {
    decode: true,
    conn,
    target: thingOf(table, id),
  }).one();
}

export type { Expr };
export { Select };
