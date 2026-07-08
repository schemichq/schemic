/**
 * `@schemic/surrealdb/query` — the SurrealDB-native, opt-in query builder over `@schemic/core/query`.
 * Driver-OWNED surface: the operators + the lowering to SurrealQL live here; the cross-driver machinery
 * (projection inference + the projection decode) is reused from core.
 *
 * Scope: `SELECT` over one table or a `select([A, B])` union — `where` (comparisons, `in`/`notIn`, `contains*`,
 * `startsWith`/`endsWith`, NONE checks, and/or, raw fragments), the per-kind stdlib on refs
 * (`u.name.length().gt(3)`), `orderBy`, `limit`/`start`, a `return` projection (columns, derived
 * expressions, and SUBQUERIES — an outer-row ref inside a nested builder lowers to
 * `$parent.<col>`), plus the single-row terminals `one()`/`get(T, id)` and `count()`.
 * Decode-by-default; `.raw()` opts out. Writes live in `./write`; `block()` in `./block`.
 */
import type { FieldRefBase } from "@schemic/core/query";
import {
  BoundQuery,
  escapeIdent,
  RecordId,
  type Surreal,
  Table,
} from "surrealdb";
import { z } from "zod";
import type { App, SingletonIdOf, TableDef, Wire } from "../pure";
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
  attachGraphSteps,
  type EdgeTraversal,
  isEdgeTraversal,
  isRecursion,
  isTraversal,
  makeUnionRef,
  type NodeTraversal,
  type RecursionTraversal,
  type RowFor,
} from "./graph";
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
import {
  type SchemalessTable,
  schemaless,
  type UntypedTable,
} from "./schemaless";

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
 *  STRING id part — no numeric coercion). An OMITTED id resolves a SINGLETON table's fixed key. */
export const thingOf = (table: AnyTableDef, id: unknown): RecordId => {
  if (id === undefined) {
    const key = table.singletonId;
    if (key === undefined)
      throw new Error(
        `${table.name} needs a record id — only a defineSingleton() table can omit it.`,
      );
    return new RecordId(table.name, key);
  }
  return id instanceof RecordId ? id : new RecordId(table.name, id as string);
};

/** The id argument tuple: REQUIRED for normal tables, optional for SINGLETONS (their fixed key
 *  fills in) — `get(Config)` vs `get(User, id)`, enforced at compile time. */
export type IdArgs<TD extends AnyTableDef, Rest extends unknown[]> = [
  SingletonIdOf<TD>,
] extends [never]
  ? [id: TargetId<TD>, ...Rest]
  : [id?: TargetId<TD>, ...Rest];

/** INTERNAL (shared with `./write`): split a `[id?, conn?]` rest tuple at runtime. */
export function splitIdArgs(
  rest: readonly unknown[],
): [unknown, Queryable | undefined] {
  const [a, b] = rest;
  if (a === undefined || typeof a === "string" || a instanceof RecordId)
    return [a, b as Queryable | undefined];
  return [undefined, a as Queryable | undefined];
}

// --- projections ----------------------------------------------------------------------------------

/** What a `.return(row => ({ … }))` entry accepts: a column ref, a DERIVED expression over one
 *  (`u.name.length()`), a nested builder (subquery — outer-row refs lower to `$parent.<col>`),
 *  or a raw fragment. */
export type ProjectionValue =
  | FieldRefBase<unknown>
  // biome-ignore lint/suspicious/noExplicitAny: any table's builder can be projected.
  | Select<any, any, any>
  | CountQuery
  // biome-ignore lint/suspicious/noExplicitAny: any node union can be traversed to.
  | NodeTraversal<any>
  // biome-ignore lint/suspicious/noExplicitAny: any edge can be traversed / projected.
  | EdgeTraversal<any, any, any>
  // biome-ignore lint/suspicious/noExplicitAny: any recursion result can be projected.
  | RecursionTraversal<any, any>
  | BoundQuery;

/** The decoded result type of a projection shape: refs decode to their app value, a nested
 *  `select` to its rows, `.one()` to row-or-undefined, `.count()` to a number, a typed fragment
 *  to its `[T]`. */
export type Projected<P> = { [K in keyof P]: ProjectedValue<P[K]> };
type ProjectedValue<E> = E extends CountQuery
  ? number
  : // biome-ignore lint/suspicious/noExplicitAny: matching any table's builder + its output mode.
    E extends Select<any, infer R, infer S extends boolean>
    ? Out<R, S>
    : // biome-ignore lint/suspicious/noExplicitAny: matching any node union + its result.
      E extends NodeTraversal<infer _C extends TableDef<string, any>, infer R>
      ? R
      : // biome-ignore lint/suspicious/noExplicitAny: matching any edge traversal + its result.
        E extends EdgeTraversal<any, any, infer R>
        ? R
        : // biome-ignore lint/suspicious/noExplicitAny: matching any recursion + its result.
          E extends RecursionTraversal<any, infer R>
          ? R
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
  if (v instanceof Select || v instanceof CountQuery)
    return {
      kind: "expr",
      as,
      render: (ctx) => mergeRaw(v.toQuery(), ctx.vars),
      decode: (raw) => v.decodeValue(raw),
    };
  if (isTraversal(v) || isEdgeTraversal(v) || isRecursion(v))
    return {
      kind: "expr",
      as,
      render: (ctx) => mergeRaw(v[FRAGMENT](), ctx.vars),
      decode: (raw) => v.decode(raw),
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
  /** The `ONLY` output mode: `"one"` = `FROM ONLY … LIMIT 1` (lenient, first-or-NONE); `"only"` =
   *  `FROM ONLY …` (strict — the DB errors unless exactly one). Absent => array (the faithful default). */
  only?: "one" | "only";
  /** A single-record target (`select(T, id)`) — `FROM $__thing` instead of the table. */
  target?: RecordId;
  /** A pre-bound connection (set by the ORM client) — makes the builder awaitable (`then`) and lets
   *  `.run()` be called with no argument. Absent for the standalone `select(table).run(conn)` path. */
  conn?: Queryable;
}

/** The result shape of a run: an array, or (in `.one()`/`.only()` single mode) a row-or-`undefined`. */
export type Out<Res, Single extends boolean> = Single extends true
  ? Res | undefined
  : Res[];

class Select<TD extends AnyTableDef, Res, Single extends boolean = false> {
  /** Runtime discriminant — `q.kind === "select"`. */
  readonly kind = "select" as const;
  /** The source table(s) — one for `select(T)`, several for a `select([A, B])` union root. */
  private readonly tables: readonly AnyTableDef[];
  // Typed `Row<TD>` so `Select<any, any>`'s structural identity is unchanged (the graph steps / union
  // `.match` would break `Row<any>`'s string-index signature). At runtime it carries `.out/.in/.both`
  // (single) or `.match` (union) — callbacks see it as `RowFor<TD>` via a cast.
  private readonly row: Row<TD>;
  constructor(
    table: TD | readonly AnyTableDef[],
    private readonly state: State,
    /** This CHAIN's row-scope token (persists across the immutable chain) — a ref lowered
     *  inside a DIFFERENT chain's builder renders as `$parent.<col>`. */
    private readonly token: symbol = Symbol("row"),
  ) {
    this.tables = Array.isArray(table)
      ? (table as readonly AnyTableDef[])
      : [table as AnyTableDef];
    this.row = (this.tables.length === 1
      ? attachGraphSteps(refsFor(this.tables[0], this.token), this.tables[0])
      : makeUnionRef([...this.tables], this.token)) as unknown as Row<TD>;
  }

  private next<R, S extends boolean = Single>(
    patch: Partial<State>,
  ): Select<TD, R, S> {
    return new Select<TD, R, S>(
      this.tables as unknown as TD,
      { ...this.state, ...patch },
      this.token,
    );
  }

  /** The FROM source: one escaped name, or the union list `a, b`. */
  private fromList(): string {
    return this.tables.map((t) => escapeIdent(t.name)).join(", ");
  }

  /** The member table for a decoded row — the sole table, or matched by the row's id table. */
  private tableFor(row: unknown): AnyTableDef {
    if (this.tables.length === 1) return this.tables[0];
    const id = (row as { id?: RecordId }).id;
    const tb = id?.table?.name;
    return this.tables.find((t) => t.name === tb) ?? this.tables[0];
  }

  /** The Zod schema for a projected column, found across the union's members. */
  private colSchema(col: string): z.ZodType | undefined {
    for (const t of this.tables)
      if (col in t.object.shape) return t.object.shape[col] as z.ZodType;
    return undefined;
  }

  where(fn: (row: RowFor<TD>) => Predicate): Select<TD, Res, Single> {
    return this.next<Res>({ where: toExpr(fn(this.row as RowFor<TD>)) });
  }

  orderBy(
    fn: (row: RowFor<TD>) => FieldRefOps<unknown>,
    dir: "asc" | "desc" = "asc",
  ): Select<TD, Res, Single> {
    return this.next<Res>({
      order: { col: refCol(fn(this.row as RowFor<TD>)), dir },
    });
  }

  limit(n: number): Select<TD, Res, Single> {
    return this.next<Res>({ limit: n });
  }

  /** Skip the first `n` matching rows (`START n`) — pair with `limit` for pagination. */
  start(n: number): Select<TD, Res, Single> {
    return this.next<Res>({ start: n });
  }

  /** Project to a shape of refs, derived expressions, fragments, or nested builders — re-types
   *  the result to the decoded projection. An outer-row ref inside a nested builder lowers to
   *  `$parent.<col>` (correlated subquery):
   *  `select(User).return((u) => ({ posts: select(Post).where((p) => p.author.eq(u.id)) }))`. */
  return<P extends Record<string, ProjectionValue>>(
    fn: (row: RowFor<TD>) => P,
  ): Select<TD, Projected<P>, Single> {
    const shape = fn(this.row as RowFor<TD>);
    const proj = Object.entries(shape).map(([as, v]) => projEntry(as, v));
    return this.next<Projected<P>>({ proj });
  }

  /** Output mode — skip decode, return raw wire rows. Composes with `.one()`/`.only()`. */
  raw(): Select<TD, Wire<TD>, Single> {
    return this.next<Wire<TD>>({ decode: false });
  }

  /** Output mode — a single row (`FROM ONLY … LIMIT 1`): the FIRST match, `undefined` if none. */
  one(): Select<TD, Res, true> {
    return this.next<Res, true>({ only: "one" });
  }

  /** Output mode — the SOLE row (`FROM ONLY …`): the DB errors unless there is exactly one. */
  only(): Select<TD, Res, true> {
    return this.next<Res, true>({ only: "only" });
  }

  /** Count the matching rows (`SELECT count() … GROUP ALL`) — `where` applies; order/limit/projection
   *  don't. Awaitable when bound; `.run(conn)` standalone. */
  count(): CountQuery {
    return new CountQuery(
      this.tables.map((t) => t.name),
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
    const only = s.only ? "ONLY " : "";
    let from: string;
    if (s.target) {
      vars.__thing = s.target;
      from = `${only}$__thing`;
    } else {
      from = `${only}${this.fromList()}`;
    }
    let sql = `SELECT ${cols} FROM ${from}`;
    if (s.where) sql += ` WHERE ${stripOuterParens(lowerExpr(s.where, ctx))}`;
    if (s.order)
      sql += ` ORDER BY ${escapeIdent(s.order.col)} ${s.order.dir.toUpperCase()}`;
    // `.one()` (lenient ONLY) caps to a single row; an explicit `.limit()` wins.
    const limit = s.limit ?? (s.only === "one" ? 1 : undefined);
    if (limit !== undefined) sql += ` LIMIT ${Number(limit)}`;
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
          if (e.kind === "col") {
            const schema = this.colSchema(e.col);
            out[e.as] = schema
              ? z.decode(schema, rec[e.as] as never)
              : rec[e.as];
          } else out[e.as] = e.decode ? e.decode(rec[e.as]) : rec[e.as];
        }
        return out;
      }) as Res[];
    }
    return rows.map((r) => this.tableFor(r).decode(r)) as Res[];
  }

  /** INTERNAL: decode this builder's value when PROJECTED inside another builder. In single mode the
   *  subquery yields one object (or NONE); otherwise its rows. */
  decodeValue(raw: unknown): unknown {
    if (this.state.only) {
      if (raw === undefined || raw === null) return undefined;
      return this.decodeRows([raw])[0];
    }
    return this.decodeRows((raw ?? []) as unknown[]);
  }

  /** Execute against `conn` (or the pre-bound connection, if this builder came from a client). */
  async run(conn?: Queryable): Promise<Out<Res, Single>> {
    const c = conn ?? this.state.conn;
    if (!c)
      throw new Error(
        "select() is not bound to a connection — pass one to `.run(conn)`, or use a bound client (`connect()`).",
      );
    const { sql, vars } = this.toSQL();
    const out = (await c.query(sql, vars)) as unknown[];
    const first = out[0];
    if (this.state.only) {
      const decoded = this.decodeRows(
        first === undefined || first === null ? [] : [first],
      );
      return decoded[0] as Out<Res, Single>;
    }
    return this.decodeRows((first ?? []) as unknown[]) as Out<Res, Single>;
  }

  /** PromiseLike: awaiting a **bound** builder runs it (drizzle-style `await db.select(User)…`). An
   *  unbound builder rejects with the same guidance as {@link Select.run}. */
  then<TResult1 = Out<Res, Single>, TResult2 = never>(
    onfulfilled?:
      | ((value: Out<Res, Single>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

/** A count terminal — `SELECT count() FROM <table> [WHERE …] GROUP ALL`, resolves to a number. */
export class CountQuery {
  /** Runtime discriminant — `q.kind === "count"`. */
  readonly kind = "count" as const;
  private readonly tables: readonly string[];
  constructor(
    table: string | readonly string[],
    private readonly where: Expr | undefined,
    private readonly conn?: Queryable,
    private readonly token?: symbol,
  ) {
    this.tables = typeof table === "string" ? [table] : table;
  }

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
    const from = this.tables.map((t) => escapeIdent(t)).join(", ");
    let sql = `SELECT count() FROM ${from}`;
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
): Select<TD, App<TD>>;
/** Target a single record — `select(User, id)` reads `FROM user:id` (still an array `[row]`; add
 *  `.one()`/`.only()` for the single). Replaces the old `get`. `id` is the app-typed `RecordId` or
 *  its plain string id part. */
export function select<TD extends AnyTableDef>(
  table: TD,
  id: TargetId<TD>,
  conn?: Queryable,
): Select<TD, App<TD>>;
/** Start a multi-table (union) SELECT — `select([A, B])` reads `FROM a, b`. The row is the union
 *  `App<A> | App<B>` (discriminated by its record id); the callback sees the COMMON fields plus
 *  `.match(Member, m => …)` for member-specific access. */
export function select<const TDs extends readonly AnyTableDef[]>(
  tables: TDs,
  conn?: Queryable,
): Select<TDs[number], App<TDs[number]>>;
/** UNTYPED SELECT over a table not modeled in Schemic — pass a plain name string or an SDK `Table`.
 *  The row is `Record<string, unknown>` (no decode); callback rows are a proxy (any field is a
 *  generic ref). Optionally target a record by id. */
export function select(
  table: UntypedTable,
  idOrConn?: RecordId | string | Queryable,
  conn?: Queryable,
): Select<SchemalessTable, Record<string, unknown>>;
export function select(
  table: AnyTableDef | readonly AnyTableDef[] | UntypedTable,
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
  arg2?: any,
  conn?: Queryable,
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): Select<any, any, any> {
  // A plain name / SDK `Table` becomes the untyped adapter; a `TableDef` (or array) passes through.
  const src =
    typeof table === "string" || table instanceof Table
      ? schemaless(table)
      : table;
  const [id, boundConn] = splitIdArgs([arg2, conn]);
  const state: State = { decode: true, conn: boundConn };
  if (id !== undefined && !Array.isArray(src))
    state.target = thingOf(src as AnyTableDef, id);
  return new Select(src, state);
}

/** Sugar for `select(T, id).one()` — fetch ONE record (row-or-`undefined`), singleton-aware (the id
 *  is optional for a `defineSingleton` table, resolving its fixed key). */
export function get<TD extends AnyTableDef>(
  table: TD,
  ...rest: IdArgs<TD, [conn?: Queryable]>
): Select<TD, App<TD>, true> {
  const [id, conn] = splitIdArgs(rest);
  return select(table, thingOf(table, id) as TargetId<TD>, conn).one();
}

export { Select };

// --- widened builder aliases ----------------------------------------------------------------------
// "Any*" helpers for functions that receive a builder regardless of its row type OR output mode
// (`.one()`/`.only()`/`.raw()` change the type params, so a bare `Select<any, any>` — which pins
// `Single = false` — rejects a `.only()` result). The write aliases + `AnyStatement` live in `./write`.

/** Any SELECT builder — any row type, any output mode (`.one()`/`.only()`/`.raw()`). */
// biome-ignore lint/suspicious/noExplicitAny: a widened alias — every type param is intentionally open.
export type AnySelect = Select<any, any, any>;

/** The COUNT builder (`select(T).count()`) — a scalar aggregate (no `.raw()`; not in `AnyStatement`). */
export type AnyCount = CountQuery;

/** The runtime discriminant carried by every statement builder (`q.kind`) — `switch` on it to branch
 *  by statement type (it splits `update` from `upsert`, unlike `instanceof`, and is a plain string so
 *  it survives dual-instance package loading). See `AnyStatement`. */
export type StatementKind =
  | "select"
  | "create"
  | "update"
  | "upsert"
  | "delete"
  | "relate"
  | "count";
