/**
 * `@schemic/surrealdb/query` — the SurrealDB-native, opt-in query builder over `@schemic/core/query`.
 * Driver-OWNED surface: the operators + the lowering to SurrealQL live here; the cross-driver machinery
 * (projection inference + the projection decode) is reused from core.
 *
 * Scope: single-table `SELECT` — `where` (comparisons, `in`/`notIn`, `contains*`,
 * `startsWith`/`endsWith`, NONE checks, and/or, raw fragments), the per-kind stdlib on refs
 * (`u.name.length().gt(3)`), `orderBy`, `limit`/`start`, a `return` projection (columns, derived
 * expressions, and SUBQUERIES — an outer-row ref inside a nested builder lowers to
 * `$parent.<col>`), plus the single-row terminals `one()`/`get(T, id)` and `count()`.
 * Decode-by-default; `.raw()` opts out. Writes live in `./write`; `block()` in `./block`.
 */
import type { FieldRefBase } from "@schemic/core/query";
import { BoundQuery, escapeIdent, RecordId, type Surreal } from "surrealdb";
import { z } from "zod";
import type { App, TableDef, Wire } from "../pure";
import {
  type Expr,
  type FieldRefOps,
  lowerExpr,
  type Predicate,
  type Row,
  refCol,
  refsFor,
  toExpr,
} from "./expr";
import {
  type Ctx,
  FRAGMENT,
  fragOf,
  mergeRaw,
  refState,
  renderRef,
  stripOuterParens,
  toFragment,
} from "./render";

export type { FnArg, Frag } from "../fn";
export type {
  ArrayRefOps,
  DateRefOps,
  NumberRefOps,
  StringRefOps,
} from "./expr";
// The stable public surface of the predicate/ref layer (implementation in ./expr and ./render).
export {
  and,
  type Expr,
  type FieldRef,
  type FieldRefOps,
  type Operand,
  or,
  type Predicate,
  type Row,
  refCol,
  refsFor,
} from "./expr";
export { FRAGMENT, toFragment } from "./render";

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
type AnyTableDef = TableDef<string, any>;

/** A record target: the app-typed smart id (a `RecordId`) or its plain string id part. */
export type TargetId<TD extends AnyTableDef> = App<TD>["id"] | string;

/** INTERNAL (shared with `./write`): normalize a target to a `RecordId` (a plain string is the
 *  STRING id part — no numeric coercion). */
export const thingOf = (table: AnyTableDef, id: unknown): RecordId =>
  id instanceof RecordId ? id : new RecordId(table.name, id as string);

// --- projections ----------------------------------------------------------------------------------

/** What a `.return(row => ({ … }))` entry accepts: a column ref, a DERIVED expression over one
 *  (`u.name.length()`), a nested builder (subquery — outer-row refs lower to `$parent.<col>`),
 *  or a raw fragment. */
export type ProjectionValue =
  | FieldRefBase<unknown>
  // biome-ignore lint/suspicious/noExplicitAny: any table's builder can be projected.
  | Select<any, any>
  // biome-ignore lint/suspicious/noExplicitAny: any row shape.
  | SelectOne<any>
  | CountQuery
  | BoundQuery;

/** The decoded result type of a projection shape: refs decode to their app value, a nested
 *  `select` to its rows, `.one()` to row-or-undefined, `.count()` to a number, a typed fragment
 *  to its `[T]`. */
export type Projected<P> = { [K in keyof P]: ProjectedValue<P[K]> };
type ProjectedValue<E> = E extends CountQuery
  ? number
  : E extends SelectOne<infer R>
    ? R | undefined
    : // biome-ignore lint/suspicious/noExplicitAny: matching any table's builder.
      E extends Select<any, infer R>
      ? R[]
      : E extends BoundQuery<[infer T]>
        ? T
        : E extends FieldRefBase<infer T>
          ? T
          : unknown;

/** One lowered projection entry: a plain column (schema-decoded) or a rendered expression /
 *  subquery (custom or identity decode). */
type ProjEntry =
  | { readonly kind: "col"; readonly as: string; readonly col: string }
  | {
      readonly kind: "expr";
      readonly as: string;
      readonly render: (ctx: Ctx) => string;
      readonly decode?: (v: unknown) => unknown;
    };

function projEntry(as: string, v: unknown): ProjEntry {
  const rs = refState(v);
  if (rs) {
    if (!rs.wrap && "col" in rs.root)
      return { kind: "col", as, col: rs.root.col };
    return { kind: "expr", as, render: (ctx) => renderRef(rs, ctx) };
  }
  if (v instanceof Select || v instanceof SelectOne || v instanceof CountQuery)
    return {
      kind: "expr",
      as,
      render: (ctx) => mergeRaw(v.toQuery(), ctx.vars),
      decode: (raw) => v.decodeValue(raw),
    };
  const frag = fragOf(v);
  if (frag)
    return {
      kind: "expr",
      as,
      render: (ctx) =>
        v instanceof BoundQuery
          ? `(${mergeRaw(frag, ctx.vars)})`
          : mergeRaw(frag, ctx.vars),
    };
  throw new Error(
    `.return(): "${as}" is not a projectable value — pass a column ref, a derived expression, a nested builder, or a surql fragment.`,
  );
}

// --- SurrealQL lowering ----------------------------------------------------------------------------

interface Lowered {
  readonly sql: string;
  readonly vars: Record<string, unknown>;
}

// --- the builder ------------------------------------------------------------------------------------

/** The minimal connection the builder needs to execute — a `.query(sql, vars)`. Both a `Surreal`
 *  client and a forked `SurrealSession` satisfy it, so a bound builder works against either. */
export type Queryable = Pick<Surreal, "query">;

interface State {
  where?: Expr;
  order?: { col: string; dir: "asc" | "desc" };
  limit?: number;
  start?: number;
  proj?: ProjEntry[]; // projection (undefined => SELECT *)
  decode: boolean;
  /** A single-record target (`get(T, id)`) — `FROM $__thing` instead of the table. */
  target?: RecordId;
  /** A pre-bound connection (set by the ORM client) — makes the builder awaitable (`then`) and lets
   *  `.run()` be called with no argument. Absent for the standalone `select(table).run(conn)` path. */
  conn?: Queryable;
}

class Select<TD extends AnyTableDef, Res> {
  private readonly row: Row<TD>;
  constructor(
    private readonly table: TD,
    private readonly state: State,
    /** This CHAIN's row-scope token (persists across the immutable chain) — a ref lowered
     *  inside a DIFFERENT chain's builder renders as `$parent.<col>`. */
    private readonly token: symbol = Symbol("row"),
  ) {
    this.row = refsFor(table, this.token);
  }

  private next<R>(patch: Partial<State>): Select<TD, R> {
    return new Select<TD, R>(
      this.table,
      { ...this.state, ...patch },
      this.token,
    );
  }

  where(fn: (row: Row<TD>) => Predicate): Select<TD, Res> {
    return this.next<Res>({ where: toExpr(fn(this.row)) });
  }

  orderBy(
    fn: (row: Row<TD>) => FieldRefOps<unknown>,
    dir: "asc" | "desc" = "asc",
  ): Select<TD, Res> {
    return this.next<Res>({ order: { col: refCol(fn(this.row)), dir } });
  }

  limit(n: number): Select<TD, Res> {
    return this.next<Res>({ limit: n });
  }

  /** Skip the first `n` matching rows (`START n`) — pair with `limit` for pagination. */
  start(n: number): Select<TD, Res> {
    return this.next<Res>({ start: n });
  }

  /** Project to a shape of refs, derived expressions, fragments, or nested builders — re-types
   *  the result to the decoded projection. An outer-row ref inside a nested builder lowers to
   *  `$parent.<col>` (correlated subquery):
   *  `select(User).return((u) => ({ posts: select(Post).where((p) => p.author.eq(u.id)) }))`. */
  return<P extends Record<string, ProjectionValue>>(
    fn: (row: Row<TD>) => P,
  ): Select<TD, Projected<P>> {
    const shape = fn(this.row);
    const proj = Object.entries(shape).map(([as, v]) => projEntry(as, v));
    return this.next<Projected<P>>({ proj });
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
    return new CountQuery(
      this.table.name,
      this.state.where,
      this.state.conn,
      this.token,
    );
  }

  /** Interpolate this builder into a `surql` template — it splices as `(SELECT ...)`. */
  [FRAGMENT](): BoundQuery {
    return this.toQuery();
  }

  /** This builder as a composable fragment: the lowered `(SELECT ...)` with namespaced binds.
   *  Interpolates into `surql` templates and every authoring slot that takes one. */
  toQuery(): BoundQuery {
    return toFragment(this.toSQL());
  }

  /** The SurrealQL + named binds this builder lowers to. */
  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    const ctx: Ctx = { vars, row: this.token };
    const s = this.state;
    const cols = s.proj
      ? s.proj
          .map((e) =>
            e.kind === "col"
              ? e.as === e.col
                ? escapeIdent(e.col)
                : `${escapeIdent(e.col)} AS ${escapeIdent(e.as)}`
              : `${e.render(ctx)} AS ${escapeIdent(e.as)}`,
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
    if (s.where) sql += ` WHERE ${stripOuterParens(lowerExpr(s.where, ctx))}`;
    if (s.order)
      sql += ` ORDER BY ${escapeIdent(s.order.col)} ${s.order.dir.toUpperCase()}`;
    if (s.limit !== undefined) sql += ` LIMIT ${Number(s.limit)}`;
    if (s.start !== undefined) sql += ` START ${Number(s.start)}`;
    return { sql, vars };
  }

  /** Decode raw rows per the current shape (full-row codec, or per-entry projection decode —
   *  plain columns decode through their field codec, nested builders through THEIR decode, other
   *  expressions pass through). Used by `run`; exposed so decode-by-default is testable without a
   *  live server. */
  decodeRows(rows: readonly unknown[]): Res[] {
    if (!this.state.decode) return rows as Res[];
    const proj = this.state.proj;
    if (proj) {
      return rows.map((r) => {
        const rec = r as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const e of proj) {
          if (e.kind === "col")
            out[e.as] = z.decode(
              this.table.object.shape[e.col] as z.ZodType,
              rec[e.as] as never,
            );
          else out[e.as] = e.decode ? e.decode(rec[e.as]) : rec[e.as];
        }
        return out;
      }) as Res[];
    }
    return rows.map((r) => this.table.decode(r)) as Res[];
  }

  /** INTERNAL: decode this builder's value when PROJECTED inside another builder (its rows). */
  decodeValue(raw: unknown): unknown {
    return this.decodeRows((raw ?? []) as unknown[]);
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

  /** Interpolates as the FIRST ROW of the `(SELECT ... LIMIT 1)` subquery. */
  [FRAGMENT](): BoundQuery {
    return this.toQuery();
  }

  /** This terminal as a composable fragment: `(SELECT ... LIMIT 1)[0]`. */
  toQuery(): BoundQuery {
    return toFragment(this.sel.toSQL(), (sql) => `(${sql})[0]`);
  }

  /** The SurrealQL + named binds the wrapped select lowers to. */
  toSQL(): Lowered {
    return this.sel.toSQL();
  }

  /** INTERNAL: decode this terminal's value when PROJECTED inside another builder (one row). */
  decodeValue(raw: unknown): unknown {
    if (raw === undefined || raw === null) return undefined;
    return (this.sel.decodeRows([raw]) as unknown[])[0];
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
    private readonly token?: symbol,
  ) {}

  /** Interpolates as the SCALAR count: `((SELECT count() ... GROUP ALL)[0].count OR 0)` —
   *  spelled `OR` (the canonical printer's form for `||`, so DDL round-trips stay drift-free). */
  [FRAGMENT](): BoundQuery {
    return this.toQuery();
  }

  /** This terminal as a composable fragment: the scalar count expression. */
  toQuery(): BoundQuery {
    return toFragment(this.toSQL(), (sql) => `((${sql})[0].count OR 0)`);
  }

  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    let sql = `SELECT count() FROM ${escapeIdent(this.table)}`;
    if (this.where)
      sql += ` WHERE ${stripOuterParens(lowerExpr(this.where, { vars, row: this.token }))}`;
    sql += " GROUP ALL";
    return { sql, vars };
  }

  /** INTERNAL: decode this terminal's value when PROJECTED inside another builder (a number). */
  decodeValue(raw: unknown): unknown {
    return raw ?? 0;
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
export function select<TD extends AnyTableDef>(
  table: TD,
  conn?: Queryable,
): Select<TD, App<TD>> {
  return new Select<TD, App<TD>>(table, { decode: true, conn });
}

/** Fetch ONE record by id — `get(User, id)` resolves to the decoded row or `undefined`. `id` is the
 *  app-typed `RecordId` or its plain string id part. The read half of id-chaining: `create` hands you
 *  an id, `get` fetches it back. */
export function get<TD extends AnyTableDef>(
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

export { Select };
