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

interface State {
  where?: Expr;
  order?: { col: string; dir: "asc" | "desc" };
  limit?: number;
  proj?: { as: string; col: string }[]; // flat projection (undefined => SELECT *)
  decode: boolean;
}

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
class Select<TD extends TableDef<string, any>, Res> {
  private readonly row: Row<TD>;
  constructor(
    private readonly table: TD,
    private readonly state: State,
  ) {
    const refs: Record<string, FieldRef<unknown>> = {};
    for (const key of Object.keys(table.object.shape)) refs[key] = makeRef(key);
    this.row = refs as unknown as Row<TD>;
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

  async run(conn: Surreal): Promise<Res[]> {
    const { sql, vars } = this.toSQL();
    const out = (await conn.query(sql, vars)) as unknown[];
    const rows = (out[0] ?? []) as unknown[];
    return this.decodeRows(rows);
  }
}

/** Start a single-table SELECT. Bare result is the decoded row `App<TD>`; `.return(...)` re-types it. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export function select<TD extends TableDef<string, any>>(
  table: TD,
): Select<TD, App<TD>> {
  return new Select<TD, App<TD>>(table, { decode: true });
}

export type { Expr };
