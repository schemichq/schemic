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
  if (node.kind === "cmp")
    return `${escId(node.path)} ${node.op} ${b.bind(node.value)}`;
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
      : Object.keys(this.table.fields).map(escId).join(", ");
    let sql = `SELECT ${cols} FROM ${escId(this.table.name)}`;
    if (this.state.where)
      sql += ` WHERE ${renderPred(this.state.where.node, b)}`;
    if (this.state.order?.length)
      sql += ` ORDER BY ${this.state.order.map((o) => `${escId(o.path)} ${o.dir.toUpperCase()}`).join(", ")}`;
    if (this.state.limit != null) sql += ` LIMIT ${b.bind(this.state.limit)}`;
    return { sql: `${sql};`, params: b.params };
  }

  /** Decode raw rows per the current shape (the table's full-row codec, or the projection codec). */
  decode(rows: unknown[]): Res[] {
    if (!this.decodeOn) return rows as Res[];
    if (this.state.projection)
      return decodeProjection<Res>(this.state.projection, rows);
    return rows.map((r) => this.table.decode(r) as Res);
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
): SelectQuery<TD, App<TD>> {
  return new SelectQuery<TD, App<TD>>(table, {}, true, conn);
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
  return table.decode(rows[0]);
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
  return(mode: "after"): CreateQuery<TD, App<TD>>;
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
  content(data: CreateInput<TD>): CreateQuery<TD, App<TD>> {
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

  return(mode: "after"): UpdateQuery<TD, App<TD> | undefined>;
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
  ): UpdateQuery<TD, App<TD> | undefined> {
    return new UpdateQuery(
      this.table,
      this.id,
      values,
      { kind: "after" },
      this.conn,
    );
  }
  /** Partial UPDATE — set only the provided columns (validated vs `T.update`, fail-fast). */
  merge(patch: UpdateInput<TD>): UpdateQuery<TD, App<TD> | undefined> {
    return this.build(
      z.encode(this.table.update, patch) as Record<string, unknown>,
    );
  }
  /** Alias of {@link merge} for pg (flat columns) — an explicit SET of the provided columns. */
  set(patch: UpdateInput<TD>): UpdateQuery<TD, App<TD> | undefined> {
    return this.build(
      z.encode(this.table.update, patch) as Record<string, unknown>,
    );
  }
  /** REPLACE the row — every non-generated column (validated vs `T.create`, fail-fast). */
  content(row: CreateInput<TD>): UpdateQuery<TD, App<TD> | undefined> {
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

  return(mode: "after"): DeleteQuery<TD, App<TD> | undefined>;
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
): DeleteQuery<TD, App<TD> | undefined> {
  return new DeleteQuery(table, id, { kind: "after" }, conn);
}
