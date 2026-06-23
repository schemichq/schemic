/**
 * `@schemic/postgres/query` — the Postgres-OWNED typed query builder (Phase-0 reference). A single-table
 * `select(table)` that lowers straight to Postgres SQL (positional `$1..$n` binds) and decodes results to
 * real `App` types. Composes the dialect-neutral machinery from `@schemic/core/query`:
 *   - `FieldRefBase<T>` — our `FieldRef<T>` extends it so `Project` can read the app value back
 *   - `Project<P>` — types `.return(row => P)` to the decoded projected shape
 *   - `decodeProjection` / `ProjectionField` — runtime decode of a projected (subset/renamed) row
 *
 * SCOPE: single-table SELECT — where (=,!=,<,<=,>,>=, and/or), orderBy, limit, flat projection. No
 * joins / CTE / writes (later phases).
 */
import {
  brandRef,
  decodeProjection,
  type FieldRefBase,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { z } from "zod";
import type { App, PgField, PgTableDef } from "../authoring";
import { escId } from "../emit";
import type { PgConn } from "../index";

// --- expressions ---------------------------------------------------------------------------------

type Cmp = "=" | "<>" | "<" | "<=" | ">" | ">=";
type PredNode =
  | { kind: "cmp"; path: string; op: Cmp; value: unknown }
  | { kind: "and" | "or"; parts: PredNode[] };

/** An opaque boolean expression produced by field operators / `and`/`or` — rendered in `WHERE`. */
export class Expr {
  constructor(readonly node: PredNode) {}
}

export function and(...parts: Expr[]): Expr {
  return new Expr({ kind: "and", parts: parts.map((p) => p.node) });
}
export function or(...parts: Expr[]): Expr {
  return new Expr({ kind: "or", parts: parts.map((p) => p.node) });
}

// --- field refs ----------------------------------------------------------------------------------

/** A Postgres field reference: the neutral `FieldRefBase` carrier + pg comparison operators. */
export interface FieldRef<T> extends FieldRefBase<T> {
  eq(v: T): Expr;
  neq(v: T): Expr;
  lt(v: T): Expr;
  lte(v: T): Expr;
  gt(v: T): Expr;
  gte(v: T): Expr;
}

/** Internal carrier behind a FieldRef — its column path + source Zod schema (for projection decode). */
interface RefImpl {
  readonly __path: string;
  readonly __schema: z.ZodType;
}

function makeRef(path: string, schema: z.ZodType): FieldRef<unknown> & RefImpl {
  const cmp = (op: Cmp) => (value: unknown) =>
    new Expr({ kind: "cmp", path, op, value });
  return brandRef({
    __path: path,
    __schema: schema,
    eq: cmp("="),
    neq: cmp("<>"),
    lt: cmp("<"),
    lte: cmp("<="),
    gt: cmp(">"),
    gte: cmp(">="),
  }) as FieldRef<unknown> & RefImpl;
}

/** The typed row handed to `where`/`orderBy`/`return` callbacks — one `FieldRef` per declared column. */
export type Row<TD extends PgTableDef> = {
  [K in keyof App<TD>]-?: FieldRef<App<TD>[K]>;
};

function rowOf(table: PgTableDef): Record<string, FieldRef<unknown> & RefImpl> {
  const row: Record<string, FieldRef<unknown> & RefImpl> = {};
  for (const [k, f] of Object.entries(table.fields))
    row[k] = makeRef(k, (f as PgField).schema);
  return row;
}

// --- lowering: predicate tree -> SQL + positional params ----------------------------------------

class Binder {
  readonly params: unknown[] = [];
  bind(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function renderPred(node: PredNode, b: Binder): string {
  if (node.kind === "cmp") return `${escId(node.path)} ${node.op} ${b.bind(node.value)}`;
  const joiner = node.kind === "and" ? " AND " : " OR ";
  return `(${node.parts.map((p) => renderPred(p, b)).join(joiner)})`;
}

// --- the builder ---------------------------------------------------------------------------------

/** A projected column: core's `ProjectionField` (`as` + decode `schema`) plus the source SQL `path`. */
interface ProjItem extends ProjectionField {
  path: string;
}

interface State {
  where?: Expr;
  order?: { path: string; dir: "asc" | "desc" }[];
  limit?: number;
  /** Flat projection columns (absent → full row). */
  projection?: ProjItem[];
}

export class SelectQuery<TD extends PgTableDef, Res> {
  constructor(
    private readonly table: TD,
    private readonly state: State = {},
    private readonly decodeOn = true,
  ) {}

  private with(patch: Partial<State>): SelectQuery<TD, Res> {
    return new SelectQuery(this.table, { ...this.state, ...patch }, this.decodeOn);
  }

  where(cb: (row: Row<TD>) => Expr): SelectQuery<TD, Res> {
    return this.with({ where: cb(rowOf(this.table) as unknown as Row<TD>) });
  }

  orderBy(cb: (row: Row<TD>) => FieldRef<unknown>, dir: "asc" | "desc" = "asc"): SelectQuery<TD, Res> {
    const ref = cb(rowOf(this.table) as unknown as Row<TD>) as unknown as RefImpl;
    return this.with({ order: [...(this.state.order ?? []), { path: ref.__path, dir }] });
  }

  limit(n: number): SelectQuery<TD, Res> {
    return this.with({ limit: n });
  }

  /** Project to a flat shape: `.return(r => ({ name: r.name, at: r.createdAt }))`. Re-types the result. */
  return<P extends Record<string, FieldRef<unknown>>>(
    cb: (row: Row<TD>) => P,
  ): SelectQuery<TD, Project<P>> {
    const shape = cb(rowOf(this.table) as unknown as Row<TD>);
    const projection: ProjItem[] = Object.entries(shape).map(([as, ref]) => {
      const r = ref as unknown as RefImpl;
      return { as, schema: r.__schema, path: r.__path };
    });
    return new SelectQuery<TD, Project<P>>(this.table, { ...this.state, projection }, this.decodeOn);
  }

  /** Opt out of codec decoding — rows come back as raw wire records. */
  raw(): SelectQuery<TD, Record<string, unknown>> {
    return new SelectQuery<TD, Record<string, unknown>>(this.table, this.state, false);
  }

  /** Render to `{ sql, params }` (positional binds) without executing. */
  toSQL(): { sql: string; params: unknown[] } {
    const b = new Binder();
    const cols = this.state.projection
      ? this.state.projection
          .map((p) => (p.path === p.as ? escId(p.as) : `${escId(p.path)} AS ${escId(p.as)}`))
          .join(", ")
      : Object.keys(this.table.fields).map(escId).join(", ");
    let sql = `SELECT ${cols} FROM ${escId(this.table.name)}`;
    if (this.state.where) sql += ` WHERE ${renderPred(this.state.where.node, b)}`;
    if (this.state.order?.length)
      sql += ` ORDER BY ${this.state.order.map((o) => `${escId(o.path)} ${o.dir.toUpperCase()}`).join(", ")}`;
    if (this.state.limit != null) sql += ` LIMIT ${b.bind(this.state.limit)}`;
    return { sql: `${sql};`, params: b.params };
  }

  private fullRowSchema(): z.ZodObject<Record<string, z.ZodType>> {
    const shape: Record<string, z.ZodType> = {};
    for (const [k, f] of Object.entries(this.table.fields))
      shape[k] = (f as PgField).schema;
    return z.object(shape);
  }

  /** Decode raw rows per the current shape (full-row codec, or the projection codec). */
  decode(rows: unknown[]): Res[] {
    if (!this.decodeOn) return rows as Res[];
    if (this.state.projection)
      return decodeProjection<Res>(this.state.projection, rows);
    const schema = this.fullRowSchema();
    return rows.map((r) => z.decode(schema, r as never) as Res);
  }

  /** Execute against a live connection and decode (unless `.raw()`). */
  async run(conn: PgConn): Promise<Res[]> {
    const { sql, params } = this.toSQL();
    const { rows } = await conn.query(sql, params);
    return this.decode(rows);
  }
}

/** Start a single-table typed read. Bare result is `App<TD>[]` (decoded); `.return(...)` re-types it. */
export function select<TD extends PgTableDef>(table: TD): SelectQuery<TD, App<TD>> {
  return new SelectQuery<TD, App<TD>>(table);
}
