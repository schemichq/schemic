/**
 * `@schemic/postgres/query` — the Postgres-OWNED typed query builder (Phase-0 reference). A single-table
 * `select(table)` that lowers straight to Postgres SQL (positional `$1..$n` binds) and decodes results to
 * real `App` types. Composes the dialect-neutral machinery from `@schemic/core/query`:
 *   - `FieldRefBase<T>` — our `FieldRef<T>` extends it so `Project` can read the app value back
 *   - `Project<P>` — types `.return(row => P)` to the decoded projected shape
 *   - `decodeProjection` / `ProjectionField` — runtime decode of a projected (subset/renamed) row
 *
 * SCOPE: single-table SELECT — where (=,!=,<,<=,>,>=, and/or), orderBy, limit, flat projection — plus
 * single-record WRITES (P2): create(T).content / update(T,id).merge|content|set / remove(T,id), each
 * with `.return`. No joins / CTE (later phases).
 */
import {
  brandRef,
  decodeProjection,
  type FieldRefBase,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { z } from "zod";
import type { App, CreateInput, PgTableDef, UpdateInput } from "../authoring";
import type { PgConn } from "../connection";
import { escId } from "../emit";

// --- expressions ---------------------------------------------------------------------------------

type Cmp = "=" | "<>" | "<" | "<=" | ">" | ">=";
type PredNode =
  | { kind: "cmp"; path: string; op: Cmp; value: unknown }
  | { kind: "in"; path: string; values: readonly unknown[]; not: boolean }
  | { kind: "null"; path: string; not: boolean }
  | { kind: "strfn"; path: string; fn: "starts" | "ends"; value: string }
  | {
      kind: "arr";
      path: string;
      op: "contains" | "any" | "all";
      value: unknown;
    }
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

/** The operators EVERY column carries: comparisons, set membership (`in`/`notIn`), and NULL checks
 *  (`isNone`/`isNotNone`, cross-driver names for `IS [NOT] NULL`). The neutral `FieldRefBase` carrier
 *  lets core's `Project` read the app type back. */
export interface FieldRefOps<T> extends FieldRefBase<T> {
  eq(v: T): Expr;
  neq(v: T): Expr;
  lt(v: T): Expr;
  lte(v: T): Expr;
  gt(v: T): Expr;
  gte(v: T): Expr;
  /** `col IN (…)` — the value is one of. */
  in(values: readonly T[]): Expr;
  /** `col NOT IN (…)`. */
  notIn(values: readonly T[]): Expr;
  /** `col IS NULL` — the (nullable) column is absent. */
  isNone(): Expr;
  /** `col IS NOT NULL`. */
  isNotNone(): Expr;
}
/** String-only operators — `starts_with(col, …)` / `right(col, …) = …`. (No substring `contains`: that's
 *  array membership on pg; a future `.includes(...)` would be the substring op — cross-driver decision.) */
export interface StringRefOps {
  startsWith(prefix: string): Expr;
  endsWith(suffix: string): Expr;
}
/** Array-only operators — pg `= ANY` / `&&` / `@>`. */
export interface ArrayRefOps<E> {
  /** `v = ANY(col)` — the array holds the element. */
  contains(v: E): Expr;
  /** `col && [...]` — the arrays overlap (holds ANY of). */
  containsAny(vs: readonly E[]): Expr;
  /** `col @> [...]` — the array holds ALL of. */
  containsAll(vs: readonly E[]): Expr;
}

/** The canonical `IsAny` probe — `1 & any` collapses to `any`, so `0 extends (1 & T)` is only true for `any`. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** A column reference inside a `where`/`orderBy`/`return` callback. The operator set NARROWS by the
 *  column's app type — string ops on strings, `contains*` on arrays — via conditional intersections.
 *  The `IsAny` guard keeps a shape-agnostic `PgTableDef` row assignable (an `any` column gets base ops
 *  only). Mirrors `@schemic/surrealdb`'s `FieldRef` exactly. */
export type FieldRef<T> = FieldRefOps<T> &
  (IsAny<T> extends true
    ? unknown
    : ([NonNullable<T>] extends [string] ? StringRefOps : unknown) &
        ([NonNullable<T>] extends [readonly (infer E)[]]
          ? ArrayRefOps<E>
          : unknown));

/** Internal carrier behind a FieldRef — its column path + source Zod schema (for projection decode). */
interface RefImpl {
  readonly __path: string;
  readonly __schema: z.ZodType;
}

function makeRef(path: string, schema: z.ZodType): FieldRef<unknown> & RefImpl {
  const cmp = (op: Cmp) => (value: unknown) =>
    new Expr({ kind: "cmp", path, op, value });
  const inOp = (not: boolean) => (values: readonly unknown[]) =>
    new Expr({ kind: "in", path, values, not });
  const strfn = (fn: "starts" | "ends") => (value: string) =>
    new Expr({ kind: "strfn", path, fn, value });
  const arr = (op: "contains" | "any" | "all") => (value: unknown) =>
    new Expr({ kind: "arr", path, op, value });
  return brandRef({
    __path: path,
    __schema: schema,
    eq: cmp("="),
    neq: cmp("<>"),
    lt: cmp("<"),
    lte: cmp("<="),
    gt: cmp(">"),
    gte: cmp(">="),
    in: inOp(false),
    notIn: inOp(true),
    isNone: () => new Expr({ kind: "null", path, not: false }),
    isNotNone: () => new Expr({ kind: "null", path, not: true }),
    startsWith: strfn("starts"),
    endsWith: strfn("ends"),
    contains: arr("contains"),
    containsAny: arr("any"),
    containsAll: arr("all"),
  }) as unknown as FieldRef<unknown> & RefImpl;
}

/** The typed row handed to `where`/`orderBy`/`return` callbacks — one `FieldRef` per declared column. */
export type Row<TD extends PgTableDef> = {
  [K in keyof App<TD>]-?: FieldRef<App<TD>[K]>;
};

function rowOf(table: PgTableDef): Record<string, FieldRef<unknown> & RefImpl> {
  const row: Record<string, FieldRef<unknown> & RefImpl> = {};
  // Schemas come from the table's `object` (the same codec that decodes a full row), so refs and decode
  // can never drift apart.
  for (const [k, schema] of Object.entries(table.object.shape))
    row[k] = makeRef(k, schema as z.ZodType);
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
  switch (node.kind) {
    case "cmp":
      return `${escId(node.path)} ${node.op} ${b.bind(node.value)}`;
    case "in": {
      // an empty set: `IN ()` is invalid — `in [] ` is always false, `notIn []` always true.
      if (!node.values.length) return node.not ? "TRUE" : "FALSE";
      const list = node.values.map((v) => b.bind(v)).join(", ");
      return `${escId(node.path)} ${node.not ? "NOT IN" : "IN"} (${list})`;
    }
    case "null":
      return `${escId(node.path)} IS ${node.not ? "NOT NULL" : "NULL"}`;
    case "strfn": {
      const p = b.bind(node.value); // one bind, referenced twice for the suffix length + compare
      return node.fn === "starts"
        ? `starts_with(${escId(node.path)}, ${p})`
        : `right(${escId(node.path)}, char_length(${p})) = ${p}`;
    }
    case "arr":
      // contains -> element membership; any -> overlap; all -> superset (bind the JS array directly).
      return node.op === "contains"
        ? `${b.bind(node.value)} = ANY(${escId(node.path)})`
        : `${escId(node.path)} ${node.op === "any" ? "&&" : "@>"} ${b.bind(node.value)}`;
  }
  const joiner = node.kind === "and" ? " AND " : " OR ";
  return `(${node.parts.map((p) => renderPred(p, b)).join(joiner)})`;
}

// --- the builder ---------------------------------------------------------------------------------

/**
 * The RETURNED-row type: a returned row CARRIES ITS ID. When a table declares its own `id` column it's
 * already in `App`; when it relies on pg's IMPLICIT `id text PRIMARY KEY` (added at emit, so outside the
 * declared shape), we carry it as `{ id: string }` so `const c = await db.create(T)…; db.update(T, c.id)`
 * chains (cross-driver convention — surreal injects `id: RecordId`). Mirrors {@link IdOf}'s split.
 */
export type RowOf<TD extends PgTableDef> = "id" extends keyof App<TD>
  ? App<TD>
  : App<TD> & { id: string };

/** Does this table rely on pg's IMPLICIT `id text PRIMARY KEY`? True iff no `id` column is declared, no
 * field is a `$primaryKey`, and there's no composite key — mirrors `createTableDdl`'s `!custom` rule. */
function usesImplicitId(table: PgTableDef): boolean {
  if ("id" in table.fields) return false;
  if (table.config.primaryKey?.length) return false;
  for (const f of Object.values(table.fields))
    if ((f as { native?: { primaryKey?: boolean } }).native?.primaryKey)
      return false;
  return true;
}

/** Splice the implicit `id` back onto a decoded FULL row: the pg implicit PK isn't a declared field (so
 * it's absent from `object`/`App`/`.decode`), but the wire row HAS it — carry it so returned rows are
 * addressable. No-op when the row already has an `id` (declared) or the raw row carries none. */
function withImplicitId(decoded: unknown, raw: unknown): unknown {
  if (
    decoded &&
    typeof decoded === "object" &&
    !("id" in decoded) &&
    raw &&
    typeof raw === "object" &&
    "id" in raw
  )
    return { id: (raw as { id: unknown }).id, ...(decoded as object) };
  return decoded;
}

/** A projected column: core's `ProjectionField` (`as` + decode `schema`) plus the source SQL `path`. */
interface ProjItem extends ProjectionField {
  path: string;
}

interface State {
  where?: Expr;
  order?: { path: string; dir: "asc" | "desc" }[];
  limit?: number;
  /** Rows to skip (`OFFSET`), for pagination alongside `limit`. */
  start?: number;
  /** Flat projection columns (absent → full row). */
  projection?: ProjItem[];
}

export class SelectQuery<TD extends PgTableDef, Res>
  implements PromiseLike<Res[]>
{
  constructor(
    private readonly table: TD,
    private readonly state: State = {},
    private readonly decodeOn = true,
    // Optionally BOUND to a connection (via the ORM client's `db.select(...)`, or `select(t, conn)`): a
    // bound query EXECUTES on `await` / a no-arg `.run()`. Chaining preserves the binding. Absent -> the
    // classic BYO builder (`select(t).run(db)`).
    private readonly conn?: PgConn,
  ) {}

  private with(patch: Partial<State>): SelectQuery<TD, Res> {
    return new SelectQuery(
      this.table,
      { ...this.state, ...patch },
      this.decodeOn,
      this.conn,
    );
  }

  where(cb: (row: Row<TD>) => Expr): SelectQuery<TD, Res> {
    return this.with({ where: cb(rowOf(this.table) as unknown as Row<TD>) });
  }

  orderBy(
    cb: (row: Row<TD>) => FieldRef<unknown>,
    dir: "asc" | "desc" = "asc",
  ): SelectQuery<TD, Res> {
    const ref = cb(
      rowOf(this.table) as unknown as Row<TD>,
    ) as unknown as RefImpl;
    return this.with({
      order: [...(this.state.order ?? []), { path: ref.__path, dir }],
    });
  }

  limit(n: number): SelectQuery<TD, Res> {
    return this.with({ limit: n });
  }

  /** Skip the first `n` rows (`OFFSET n`) — pagination alongside `.limit(...)`. */
  start(n: number): SelectQuery<TD, Res> {
    return this.with({ start: n });
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
    return new SelectQuery<TD, Project<P>>(
      this.table,
      { ...this.state, projection },
      this.decodeOn,
      this.conn,
    );
  }

  /** Opt out of codec decoding — rows come back as raw wire records. */
  raw(): SelectQuery<TD, Record<string, unknown>> {
    return new SelectQuery<TD, Record<string, unknown>>(
      this.table,
      this.state,
      false,
      this.conn,
    );
  }

  /** Take the FIRST matching row (forces `LIMIT 1`) — resolves to the row or `undefined`. */
  one(): PgSelectOne<Res> {
    return new PgSelectOne<Res>(this.limit(1));
  }

  /** Count the matching rows (`SELECT count(*) … WHERE …`) — `where` applies; order/limit/projection
   *  don't. Awaitable when bound; `.run(conn)` standalone. */
  count(): PgCountQuery {
    return new PgCountQuery(this.table.name, this.state.where, this.conn);
  }

  /** Render to `{ sql, params }` (positional binds) without executing. */
  toSQL(): { sql: string; params: unknown[] } {
    const b = new Binder();
    const cols = this.state.projection
      ? this.state.projection
          .map((p) =>
            p.path === p.as
              ? escId(p.as)
              : `${escId(p.path)} AS ${escId(p.as)}`,
          )
          .join(", ")
      : // full row: fetch the implicit id too (it's not a declared field) so the row stays addressable
        [
          ...(usesImplicitId(this.table) ? ["id"] : []),
          ...Object.keys(this.table.fields),
        ]
          .map(escId)
          .join(", ");
    let sql = `SELECT ${cols} FROM ${escId(this.table.name)}`;
    if (this.state.where)
      sql += ` WHERE ${renderPred(this.state.where.node, b)}`;
    if (this.state.order?.length)
      sql += ` ORDER BY ${this.state.order.map((o) => `${escId(o.path)} ${o.dir.toUpperCase()}`).join(", ")}`;
    if (this.state.limit != null) sql += ` LIMIT ${b.bind(this.state.limit)}`;
    if (this.state.start != null) sql += ` OFFSET ${b.bind(this.state.start)}`;
    return { sql: `${sql};`, params: b.params };
  }

  /** Decode raw rows per the current shape (the table's full-row codec, or the projection codec). */
  decode(rows: unknown[]): Res[] {
    if (!this.decodeOn) return rows as Res[];
    if (this.state.projection)
      return decodeProjection<Res>(this.state.projection, rows);
    // Full row: carry the implicit id (absent from `object`) so returned rows stay addressable.
    return rows.map((r) => withImplicitId(this.table.decode(r), r) as Res);
  }

  /**
   * Execute + decode (unless `.raw()`). Pass a connection explicitly, or omit it to use the one this
   * query is BOUND to (from `db.select(...)` / `select(t, conn)`). Throws if neither is available.
   */
  async run(conn?: PgConn): Promise<Res[]> {
    const c = conn ?? this.conn;
    if (!c)
      throw new Error(
        "select(...).run() needs a connection — pass one (`.run(conn)`), or use a bound `db.select(...)`.",
      );
    const { sql, params } = this.toSQL();
    const { rows } = await c.query(sql, params);
    return this.decode(rows);
  }

  /** Thenable: awaiting a BOUND query runs it (`await db.select(t).where(...)`). Unbound -> rejects. */
  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound query is awaitable (drizzle-style, cross-driver-aligned)
  then<R1 = Res[], R2 = never>(
    onFulfilled?: ((value: Res[]) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/**
 * Start a single-table typed read. Bare result is `App<TD>[]` (decoded); `.return(...)` re-types it.
 * Pass `conn` to BIND it (so `await select(t, conn)` runs); omit for the classic `select(t).run(db)`.
 */
export function select<TD extends PgTableDef>(
  table: TD,
  conn?: PgConn,
): SelectQuery<TD, RowOf<TD>> {
  return new SelectQuery<TD, RowOf<TD>>(table, {}, true, conn);
}

/** A single-row terminal over a {@link SelectQuery} — resolves to the first row or `undefined`. */
export class PgSelectOne<Res> implements PromiseLike<Res | undefined> {
  constructor(private readonly sel: SelectQuery<PgTableDef, Res>) {}

  /** Render `{ sql, params }` (the wrapped select, already `LIMIT 1`). */
  toSQL(): { sql: string; params: unknown[] } {
    return this.sel.toSQL();
  }

  async run(conn?: PgConn): Promise<Res | undefined> {
    return (await this.sel.run(conn))[0];
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound one() is awaitable (mirrors select)
  then<R1 = Res | undefined, R2 = never>(
    onFulfilled?: ((value: Res | undefined) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/** A count terminal — `SELECT count(*) FROM <table> [WHERE …]`, resolves to a number. `where` applies;
 *  order/limit/projection don't. */
export class PgCountQuery implements PromiseLike<number> {
  constructor(
    private readonly table: string,
    private readonly where: Expr | undefined,
    private readonly conn?: PgConn,
  ) {}

  toSQL(): { sql: string; params: unknown[] } {
    const b = new Binder();
    let sql = `SELECT count(*)::int AS count FROM ${escId(this.table)}`;
    if (this.where) sql += ` WHERE ${renderPred(this.where.node, b)}`;
    return { sql: `${sql};`, params: b.params };
  }

  async run(conn?: PgConn): Promise<number> {
    const c = conn ?? this.conn;
    if (!c) throw new Error("count(...).run() needs a connection.");
    const { sql, params } = this.toSQL();
    const { rows } = await c.query<{ count: number }>(sql, params);
    return rows[0]?.count ?? 0;
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound count() is awaitable (mirrors select)
  then<R1 = number, R2 = never>(
    onFulfilled?: ((value: number) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/** Fetch ONE record by id — `get(User, id)` resolves to the decoded row or `undefined`. The read half of
 *  id-chaining (`create` hands you an id, `get` fetches it back). Filters by the single-column pk (the
 *  implicit `id` too — which isn't a declared field, so it's matched directly, not via a row ref). */
export function get<TD extends PgTableDef>(
  table: TD,
  id: IdOf<TD>,
  conn?: PgConn,
): PgSelectOne<RowOf<TD>> {
  const pk = pkColumn(table);
  const where = new Expr({
    kind: "cmp",
    path: pk,
    op: "=",
    value: encodeField(table, pk, id),
  });
  return new SelectQuery<TD, RowOf<TD>>(table, { where }, true, conn).one();
}

// --- writes (P2): create / update / remove -------------------------------------------------------
// Single-record INSERT / UPDATE / DELETE, mirroring surreal's ratified split-builder surface. Payloads
// validate through the table's Create/Update codecs FAIL-FAST (the ZodError throws at the `.content` /
// `.merge` / `.set` call site, not at `await`), and `z.encode` doubles as the app -> wire lowering. Each
// builder is thenable + `.run(conn?)`, and pre-bound when built from a `db.*` client method.

/** The RETURNING mode of a write: full row (`"after"`, default), a flat projection, or nothing. */
type ReturnState =
  | { kind: "after" }
  | { kind: "none" }
  | { kind: "projection"; projection: ProjItem[] };

/** The id-column value type for `update`/`remove` — the `id` column's app type when present, else a scalar. */
export type IdOf<TD extends PgTableDef> = "id" extends keyof App<TD>
  ? App<TD>["id"]
  : string | number;

/** The single-column primary key for by-id writes (`config.primaryKey`, else the implicit `id`). */
function pkColumn(table: PgTableDef): string {
  const pk = table.config.primaryKey;
  if (pk && pk.length > 1)
    throw new Error(
      `postgres: update/remove(T, id) needs a single-column primary key on "${table.name}" — use db.query(...) for a composite key.`,
    );
  return pk?.[0] ?? "id";
}

/** Encode one app value to its wire form via a field's codec (app -> wire; identity for plain fields). */
function encodeField(table: PgTableDef, col: string, value: unknown): unknown {
  const schema = table.object.shape[col] as z.ZodType | undefined;
  return schema ? z.encode(schema, value as never) : value;
}

/** The RETURNING clause for a write (empty for `"none"`). */
function returningSql(ret: ReturnState): string {
  if (ret.kind === "none") return "";
  if (ret.kind === "projection")
    return ` RETURNING ${ret.projection
      .map((p) =>
        p.path === p.as ? escId(p.as) : `${escId(p.path)} AS ${escId(p.as)}`,
      )
      .join(", ")}`;
  return " RETURNING *";
}

/** Decode a write's RETURNING rows to the single affected record (or `undefined` — no match / `"none"`). */
function decodeReturn(
  table: PgTableDef,
  ret: ReturnState,
  rows: unknown[],
): unknown {
  if (ret.kind === "none" || !rows.length) return undefined;
  if (ret.kind === "projection")
    return decodeProjection(ret.projection, rows)[0];
  // Full row: carry the implicit id so `db.create(T)…` returns an addressable record.
  return withImplicitId(table.decode(rows[0]), rows[0]);
}

/** Build a projection `ReturnState` from a `.return(row => ({...}))` callback (shared with `select`). */
function projectionOf<TD extends PgTableDef>(
  table: TD,
  cb: (row: Row<TD>) => Record<string, FieldRef<unknown>>,
): ReturnState {
  const shape = cb(rowOf(table) as unknown as Row<TD>);
  const projection: ProjItem[] = Object.entries(shape).map(([as, ref]) => {
    const r = ref as unknown as RefImpl;
    return { as, schema: r.__schema, path: r.__path };
  });
  return { kind: "projection", projection };
}

/** INSERT one row: `create(T).content(data)` — data validates vs `T.create`, returns the created row. */
export class CreateQuery<TD extends PgTableDef, Res>
  implements PromiseLike<Res>
{
  constructor(
    private readonly table: TD,
    private readonly values: Record<string, unknown>,
    private readonly ret: ReturnState,
    private readonly conn?: PgConn,
  ) {}

  /** Re-type the returned projection: `.return("after")` (default full row), `.return(r => ({...}))`, or `.return("none")`. */
  return(mode: "after"): CreateQuery<TD, RowOf<TD>>;
  return(mode: "none"): CreateQuery<TD, undefined>;
  return<P extends Record<string, FieldRef<unknown>>>(
    cb: (row: Row<TD>) => P,
  ): CreateQuery<TD, Project<P>>;
  return(
    arg:
      | "after"
      | "none"
      | ((row: Row<TD>) => Record<string, FieldRef<unknown>>),
  ): CreateQuery<TD, unknown> {
    const ret: ReturnState =
      arg === "after"
        ? { kind: "after" }
        : arg === "none"
          ? { kind: "none" }
          : projectionOf(this.table, arg);
    return new CreateQuery(this.table, this.values, ret, this.conn);
  }

  /** Render to `{ sql, params }` (positional binds) without executing. */
  toSQL(): { sql: string; params: unknown[] } {
    const cols = Object.keys(this.values);
    const params = cols.map((c) => this.values[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const colList = cols.map(escId).join(", ");
    const sql = `INSERT INTO ${escId(this.table.name)} (${colList}) VALUES (${placeholders})${returningSql(this.ret)};`;
    return { sql, params };
  }

  async run(conn?: PgConn): Promise<Res> {
    const c = conn ?? this.conn;
    if (!c) throw new Error(NO_CONN("create"));
    const { sql, params } = this.toSQL();
    const { rows } = await c.query(sql, params);
    return decodeReturn(this.table, this.ret, rows) as Res;
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound write is awaitable (mirrors select)
  then<R1 = Res, R2 = never>(
    onFulfilled?: ((value: Res) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/** The `create(T)` entry — pick the payload with `.content(data)` (validated vs `T.create`, fail-fast). */
export class CreateBuilder<TD extends PgTableDef> {
  constructor(
    private readonly table: TD,
    private readonly conn?: PgConn,
  ) {}
  /** INSERT this row (validated vs `T.create` NOW — a bad payload throws here, not at `await`). */
  content(data: CreateInput<TD>): CreateQuery<TD, RowOf<TD>> {
    const values = z.encode(this.table.create, data) as Record<string, unknown>;
    return new CreateQuery(this.table, values, { kind: "after" }, this.conn);
  }
}

/** UPDATE one row by id: `.merge(patch)` / `.set(patch)` (partial, vs `T.update`) or `.content(row)` (replace, vs `T.create`). */
export class UpdateQuery<TD extends PgTableDef, Res>
  implements PromiseLike<Res>
{
  constructor(
    private readonly table: TD,
    private readonly id: unknown,
    private readonly values: Record<string, unknown>,
    private readonly ret: ReturnState,
    private readonly conn?: PgConn,
  ) {}

  return(mode: "after"): UpdateQuery<TD, RowOf<TD> | undefined>;
  return(mode: "none"): UpdateQuery<TD, undefined>;
  return<P extends Record<string, FieldRef<unknown>>>(
    cb: (row: Row<TD>) => P,
  ): UpdateQuery<TD, Project<P> | undefined>;
  return(
    arg:
      | "after"
      | "none"
      | ((row: Row<TD>) => Record<string, FieldRef<unknown>>),
  ): UpdateQuery<TD, unknown> {
    const ret: ReturnState =
      arg === "after"
        ? { kind: "after" }
        : arg === "none"
          ? { kind: "none" }
          : projectionOf(this.table, arg);
    return new UpdateQuery(this.table, this.id, this.values, ret, this.conn);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const cols = Object.keys(this.values);
    if (!cols.length)
      throw new Error(
        `postgres: update(${this.table.name}, …) has no columns to set — pass a non-empty patch.`,
      );
    const pk = pkColumn(this.table);
    const assignments = cols
      .map((c, i) => `${escId(c)} = $${i + 1}`)
      .join(", ");
    const params = cols.map((c) => this.values[c]);
    params.push(encodeField(this.table, pk, this.id));
    const sql = `UPDATE ${escId(this.table.name)} SET ${assignments} WHERE ${escId(pk)} = $${params.length}${returningSql(this.ret)};`;
    return { sql, params };
  }

  async run(conn?: PgConn): Promise<Res> {
    const c = conn ?? this.conn;
    if (!c) throw new Error(NO_CONN("update"));
    const { sql, params } = this.toSQL();
    const { rows } = await c.query(sql, params);
    return decodeReturn(this.table, this.ret, rows) as Res;
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound write is awaitable (mirrors select)
  then<R1 = Res, R2 = never>(
    onFulfilled?: ((value: Res) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

/** The `update(T, id)` entry — pick the mutation. pg columns are flat, so `.merge` and `.set` coincide
 * (partial UPDATE via `T.update`); `.content` REPLACES every column (validated vs `T.create`). */
export class UpdateBuilder<TD extends PgTableDef> {
  constructor(
    private readonly table: TD,
    private readonly id: unknown,
    private readonly conn?: PgConn,
  ) {}
  private build(
    values: Record<string, unknown>,
  ): UpdateQuery<TD, RowOf<TD> | undefined> {
    return new UpdateQuery(
      this.table,
      this.id,
      values,
      { kind: "after" },
      this.conn,
    );
  }
  /** Partial UPDATE — set only the provided columns (validated vs `T.update`, fail-fast). */
  merge(patch: UpdateInput<TD>): UpdateQuery<TD, RowOf<TD> | undefined> {
    return this.build(
      z.encode(this.table.update, patch) as Record<string, unknown>,
    );
  }
  /** Alias of {@link merge} for pg (flat columns) — an explicit SET of the provided columns. */
  set(patch: UpdateInput<TD>): UpdateQuery<TD, RowOf<TD> | undefined> {
    return this.build(
      z.encode(this.table.update, patch) as Record<string, unknown>,
    );
  }
  /** REPLACE the row — every non-generated column (validated vs `T.create`, fail-fast). */
  content(row: CreateInput<TD>): UpdateQuery<TD, RowOf<TD> | undefined> {
    return this.build(
      z.encode(this.table.create, row) as Record<string, unknown>,
    );
  }
}

/** DELETE one row by id: `remove(T, id).return(...)`. Default RETURNING yields the deleted (before) row. */
export class DeleteQuery<TD extends PgTableDef, Res>
  implements PromiseLike<Res>
{
  constructor(
    private readonly table: TD,
    private readonly id: unknown,
    private readonly ret: ReturnState,
    private readonly conn?: PgConn,
  ) {}

  return(mode: "after"): DeleteQuery<TD, RowOf<TD> | undefined>;
  return(mode: "none"): DeleteQuery<TD, undefined>;
  return<P extends Record<string, FieldRef<unknown>>>(
    cb: (row: Row<TD>) => P,
  ): DeleteQuery<TD, Project<P> | undefined>;
  return(
    arg:
      | "after"
      | "none"
      | ((row: Row<TD>) => Record<string, FieldRef<unknown>>),
  ): DeleteQuery<TD, unknown> {
    const ret: ReturnState =
      arg === "after"
        ? { kind: "after" }
        : arg === "none"
          ? { kind: "none" }
          : projectionOf(this.table, arg);
    return new DeleteQuery(this.table, this.id, ret, this.conn);
  }

  toSQL(): { sql: string; params: unknown[] } {
    const pk = pkColumn(this.table);
    const params = [encodeField(this.table, pk, this.id)];
    const sql = `DELETE FROM ${escId(this.table.name)} WHERE ${escId(pk)} = $1${returningSql(this.ret)};`;
    return { sql, params };
  }

  async run(conn?: PgConn): Promise<Res> {
    const c = conn ?? this.conn;
    if (!c) throw new Error(NO_CONN("remove"));
    const { sql, params } = this.toSQL();
    const { rows } = await c.query(sql, params);
    return decodeReturn(this.table, this.ret, rows) as Res;
  }

  // biome-ignore lint/suspicious/noThenProperty: intentional — a bound write is awaitable (mirrors select)
  then<R1 = Res, R2 = never>(
    onFulfilled?: ((value: Res) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onFulfilled, onRejected);
  }
}

const NO_CONN = (op: string) =>
  `${op}(...).run() needs a connection — pass one (\`.run(conn)\`), or use a bound \`db.${op === "remove" ? "delete" : op}(...)\`.`;

/** INSERT one record: `create(T).content(data)`. Pass `conn` to BIND it (awaitable); omit for `.run(db)`. */
export function create<TD extends PgTableDef>(
  table: TD,
  conn?: PgConn,
): CreateBuilder<TD> {
  return new CreateBuilder(table, conn);
}

/** UPDATE one record by id: `update(T, id).merge|content|set(...)`. Bind with `conn` (awaitable) or `.run(db)`. */
export function update<TD extends PgTableDef>(
  table: TD,
  id: IdOf<TD>,
  conn?: PgConn,
): UpdateBuilder<TD> {
  return new UpdateBuilder(table, id, conn);
}

/** DELETE one record by id: `remove(T, id).return(...)`. Named `remove` (`delete` is reserved); the client
 * method is `db.delete`. Bind with `conn` (awaitable) or `.run(db)`. */
export function remove<TD extends PgTableDef>(
  table: TD,
  id: IdOf<TD>,
  conn?: PgConn,
): DeleteQuery<TD, RowOf<TD> | undefined> {
  return new DeleteQuery(table, id, { kind: "after" }, conn);
}
