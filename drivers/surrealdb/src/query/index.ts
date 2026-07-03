/**
 * `@schemic/surrealdb/query` — the SurrealDB-native, opt-in query builder over `@schemic/core/query`.
 * Driver-OWNED surface: the operators + the lowering to SurrealQL live here; the cross-driver machinery
 * (projection inference + the projection decode) is reused from core.
 *
 * Scope (Phase-0): single-table `SELECT` — `where` (=,!=,<,<=,>,>=, and/or), `orderBy`, `limit`, and a
 * flat `return` projection. Decode-by-default; `.raw()` opts out. NO graph/FETCH/writes yet.
 */
import {
  brandRef,
  decodeProjection,
  type FieldRefBase,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { escapeIdent, type Surreal } from "surrealdb";
import type { App, TableDef, Wire } from "../pure";

// --- the field-ref surface (driver-owned: operators + the column it carries) --------------------

type CmpOp = "=" | "!=" | "<" | "<=" | ">" | ">=";
type Expr =
  | {
      readonly kind: "cmp";
      readonly col: string;
      readonly op: CmpOp;
      readonly value: unknown;
    }
  | { readonly kind: "and" | "or"; readonly parts: readonly Expr[] };

/** A reference to a column inside a `where`/`orderBy`/`return` callback. Extends the neutral
 *  `FieldRefBase<T>` so core's `Project` can read its app type; adds SurrealDB's comparison operators. */
export interface FieldRef<T> extends FieldRefBase<T> {
  eq(v: T): Expr;
  neq(v: T): Expr;
  lt(v: T): Expr;
  lte(v: T): Expr;
  gt(v: T): Expr;
  gte(v: T): Expr;
}

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
    (op: CmpOp) =>
    (value: unknown): Expr => ({ kind: "cmp", col, op, value });
  return brandRef({
    __col: col,
    eq: cmp("="),
    neq: cmp("!="),
    lt: cmp("<"),
    lte: cmp("<="),
    gt: cmp(">"),
    gte: cmp(">="),
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
  proj?: { as: string; col: string }[]; // flat projection (undefined => SELECT *)
  decode: boolean;
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
    fn: (row: Row<TD>) => FieldRef<unknown>,
    dir: "asc" | "desc" = "asc",
  ): Select<TD, Res> {
    return this.next<Res>({ order: { col: colOf(fn(this.row)), dir } });
  }

  limit(n: number): Select<TD, Res> {
    return this.next<Res>({ limit: n });
  }

  /** Project to a flat shape of refs — re-types the result to the decoded projection (`Project<P>`). */
  return<P extends Record<string, FieldRef<unknown>>>(
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
    let sql = `SELECT ${cols} FROM ${escapeIdent(this.table.name)}`;
    if (s.where) sql += ` WHERE ${lowerExpr(s.where, vars)}`;
    if (s.order)
      sql += ` ORDER BY ${escapeIdent(s.order.col)} ${s.order.dir.toUpperCase()}`;
    if (s.limit !== undefined) sql += ` LIMIT ${Number(s.limit)}`;
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

export type { Expr };
export { Select };
