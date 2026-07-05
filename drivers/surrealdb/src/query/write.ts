/**
 * The SurrealDB write builders (ORM P2): split builders per the core proposal —
 * `create(T).content(data)` / `update(T, id).merge(patch)` / `remove(T, id)` — with
 * `.set(...)`, `.return(...)`, `.raw()`, and the same bound/standalone duality as `select`:
 * pass a `conn` (the ORM client does) and the builder is awaitable; omit it and call `.run(conn)`.
 *
 * Validation is the codec channel: `.content` validates + encodes via `table.encode` (the
 * `Create` shape — DB-filled fields optional), `.merge`/`.set` via `table.encodePartial` (the
 * `Update` shape — partial, id/readonly excluded). Invalid input throws the aggregated
 * `z.ZodError` AT THE CALL SITE (fail-fast, the error points at your data, not at `await`).
 *
 * `.return(...)` (cross-driver convention): `"after"` is the default; a PROJECTION CALLBACK
 * (`.return(r => ({ name: r.name }))`) is the shared cross-driver surface; `"before"`/`"diff"`
 * are SurrealDB-native extras.
 */

import {
  decodeProjection,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { type BoundQuery, escapeIdent, type RecordId } from "surrealdb";
import type { App, Create, TableDef, Update, Wire } from "../pure";
import {
  type FieldRefOps,
  FRAGMENT,
  type Queryable,
  type Row,
  refCol,
  refsFor,
  type TargetId,
  thingOf,
  toFragment,
} from "./index";

export type { TargetId } from "./index";

/** SurrealDB's write `RETURN` modes (`"diff"`/`"before"` are surreal-native extras). */
export type WriteReturn = "none" | "before" | "after" | "diff";

// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
type AnyTableDef = TableDef<string, any>;

interface Lowered {
  readonly sql: string;
  readonly vars: Record<string, unknown>;
}

/** The RETURN clause state: a keyword mode, or a flat projection. */
type Ret = WriteReturn | { as: string; col: string }[];

const retClause = (ret: Ret): string =>
  Array.isArray(ret)
    ? `RETURN ${ret
        .map((p) =>
          p.as === p.col
            ? escapeIdent(p.col)
            : `${escapeIdent(p.col)} AS ${escapeIdent(p.as)}`,
        )
        .join(", ")}`
    : `RETURN ${ret.toUpperCase()}`;

/** Shared execute/decode/thenable core of the three write builders. */
abstract class WriteQuery<TD extends AnyTableDef, Res> {
  /** Interpolate this write into a `surql` template — it splices as `(CREATE/UPDATE/DELETE ...)`. */
  [FRAGMENT](): BoundQuery {
    const { sql, vars } = this.toSQL();
    return toFragment({ sql, vars });
  }

  protected constructor(
    protected readonly table: TD,
    protected readonly ret: Ret,
    protected readonly decode: boolean,
    protected readonly conn?: Queryable,
  ) {}

  /** The SurrealQL + named binds this builder lowers to. */
  abstract toSQL(): Lowered;
  protected abstract kind(): string; // for error messages

  /** Lower a `.return(row => …)` projection callback to the RETURN column list. */
  protected projOf(
    fn: (row: Row<TD>) => Record<string, FieldRefOps<unknown>>,
  ): { as: string; col: string }[] {
    return Object.entries(fn(refsFor(this.table))).map(([as, ref]) => ({
      as,
      col: refCol(ref),
    }));
  }

  /** Decode the statement's single result row per the current `RETURN` mode. */
  decodeRows(rows: readonly unknown[]): Res {
    if (this.ret === "none") return undefined as Res;
    const row = rows[0];
    if (row === undefined) return undefined as Res;
    if (Array.isArray(this.ret)) {
      const fields: ProjectionField[] = this.ret.map((p) => ({
        as: p.as,
        schema: this.table.object.shape[p.col],
      }));
      return decodeProjection(fields, [row])[0] as Res;
    }
    if (this.ret === "diff" || !this.decode) return row as Res;
    return this.table.decode(row) as Res;
  }

  /** Execute against `conn` (or the pre-bound connection, if this builder came from a client). */
  async run(conn?: Queryable): Promise<Res> {
    const c = conn ?? this.conn;
    if (!c)
      throw new Error(
        `${this.kind()}() is not bound to a connection — pass one to \`.run(conn)\`, or use a bound client (\`connect()\`).`,
      );
    const { sql, vars } = this.toSQL();
    const out = (await c.query(sql, vars)) as unknown[];
    return this.decodeRows((out[0] ?? []) as unknown[]);
  }

  /** PromiseLike: awaiting a **bound** builder runs it. */
  then<TResult1 = Res, TResult2 = never>(
    onfulfilled?: ((value: Res) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// --- CREATE --------------------------------------------------------------------------------------

export class CreateQuery<
  TD extends AnyTableDef,
  Res = App<TD>,
> extends WriteQuery<TD, Res> {
  constructor(
    table: TD,
    private readonly payload: Record<string, unknown> | undefined,
    ret: Ret = "after",
    decode = true,
    conn?: Queryable,
  ) {
    super(table, ret, decode, conn);
  }
  protected kind(): string {
    return "create";
  }

  /** The row to create — validated + encoded via the table's `Create` codec (DB-filled fields
   *  optional; invalid input throws the aggregated `z.ZodError` here, not at `await`). */
  content(data: Create<TD>): CreateQuery<TD, Res> {
    return new CreateQuery<TD, Res>(
      this.table,
      this.table.encode(data) as Record<string, unknown>,
      this.ret,
      this.decode,
      this.conn,
    );
  }

  /** What the statement returns: `after` (default — the created row), a projection callback
   *  (`.return(r => ({ name: r.name }))`), or the surreal-native `before`/`none`/`diff`. */
  return(mode: "none"): CreateQuery<TD, undefined>;
  return(mode: "before" | "after"): CreateQuery<TD, App<TD>>;
  return(mode: "diff"): CreateQuery<TD, unknown>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): CreateQuery<TD, Project<P>>;
  return(
    mode:
      | WriteReturn
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): CreateQuery<TD, unknown> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new CreateQuery(
      this.table,
      this.payload,
      ret,
      this.decode,
      this.conn,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): CreateQuery<TD, Wire<TD>> {
    return new CreateQuery<TD, Wire<TD>>(
      this.table,
      this.payload,
      this.ret,
      false,
      this.conn,
    );
  }

  toSQL(): Lowered {
    if (!this.payload)
      throw new Error(
        "create() has no row yet — call `.content(data)` before running it.",
      );
    return {
      sql: `CREATE ${escapeIdent(this.table.name)} CONTENT $__content ${retClause(this.ret)}`,
      vars: { __content: this.payload },
    };
  }
}

// --- UPDATE --------------------------------------------------------------------------------------

type UpdateMode = "merge" | "content" | "set";

export class UpdateQuery<
  TD extends AnyTableDef,
  Res = App<TD>,
> extends WriteQuery<TD, Res> {
  constructor(
    table: TD,
    private readonly target: RecordId,
    private readonly mode: UpdateMode | undefined,
    private readonly payload: Record<string, unknown> | undefined,
    ret: Ret = "after",
    decode = true,
    conn?: Queryable,
  ) {
    super(table, ret, decode, conn);
  }
  protected kind(): string {
    return "update";
  }

  private with(mode: UpdateMode, payload: Record<string, unknown>) {
    return new UpdateQuery<TD, Res>(
      this.table,
      this.target,
      mode,
      payload,
      this.ret,
      this.decode,
      this.conn,
    );
  }

  /** Deep-`MERGE` a partial patch — validated + encoded via the table's `Update` codec
   *  (id/readonly excluded at the type level; nested objects merge recursively in the DB). */
  merge(patch: Update<TD>): UpdateQuery<TD, Res> {
    return this.with(
      "merge",
      this.table.encodePartial(patch) as Record<string, unknown>,
    );
  }

  /** Replace the row (`CONTENT`) — the full row, validated via the `Create` codec. */
  content(data: Create<TD>): UpdateQuery<TD, Res> {
    return this.with(
      "content",
      this.table.encode(data) as Record<string, unknown>,
    );
  }

  /** Explicit `SET field = value, …` — a partial patch via the `Update` codec; unlike `.merge`,
   *  a nested object value REPLACES the field (SurrealDB `SET` assignment semantics). */
  set(patch: Update<TD>): UpdateQuery<TD, Res> {
    return this.with(
      "set",
      this.table.encodePartial(patch) as Record<string, unknown>,
    );
  }

  /** What the statement returns: `after` (default — the updated row), a projection callback,
   *  or the surreal-native `before`/`none`/`diff`. */
  return(mode: "none"): UpdateQuery<TD, undefined>;
  return(mode: "before" | "after"): UpdateQuery<TD, App<TD>>;
  return(mode: "diff"): UpdateQuery<TD, unknown>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): UpdateQuery<TD, Project<P>>;
  return(
    mode:
      | WriteReturn
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): UpdateQuery<TD, unknown> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new UpdateQuery(
      this.table,
      this.target,
      this.mode,
      this.payload,
      ret,
      this.decode,
      this.conn,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): UpdateQuery<TD, Wire<TD>> {
    return new UpdateQuery<TD, Wire<TD>>(
      this.table,
      this.target,
      this.mode,
      this.payload,
      this.ret,
      false,
      this.conn,
    );
  }

  toSQL(): Lowered {
    if (!this.mode || !this.payload)
      throw new Error(
        "update() has no patch yet — call `.merge(patch)`, `.content(row)`, or `.set(patch)` before running it.",
      );
    const vars: Record<string, unknown> = { __thing: this.target };
    let clause: string;
    if (this.mode === "set") {
      const parts = Object.keys(this.payload).map((k, i) => {
        vars[`__s${i}`] = (this.payload as Record<string, unknown>)[k];
        return `${escapeIdent(k)} = $__s${i}`;
      });
      clause = `SET ${parts.join(", ")}`;
    } else {
      vars.__payload = this.payload;
      clause = `${this.mode.toUpperCase()} $__payload`;
    }
    return {
      sql: `UPDATE $__thing ${clause} ${retClause(this.ret)}`,
      vars,
    };
  }
}

// --- DELETE --------------------------------------------------------------------------------------

export class DeleteQuery<
  TD extends AnyTableDef,
  Res = undefined,
> extends WriteQuery<TD, Res> {
  constructor(
    table: TD,
    private readonly target: RecordId,
    ret: Ret = "none",
    decode = true,
    conn?: Queryable,
  ) {
    super(table, ret, decode, conn);
  }
  protected kind(): string {
    return "delete";
  }

  /** What the statement returns: `none` (default), `before` (the deleted row), a projection
   *  callback (over the deleted row's fields), or `diff`. */
  return(mode: "none"): DeleteQuery<TD, undefined>;
  return(mode: "before"): DeleteQuery<TD, App<TD>>;
  return(mode: "diff"): DeleteQuery<TD, unknown>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): DeleteQuery<TD, Project<P>>;
  return(
    mode:
      | Exclude<WriteReturn, "after">
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): DeleteQuery<TD, unknown> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new DeleteQuery(
      this.table,
      this.target,
      ret,
      this.decode,
      this.conn,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): DeleteQuery<TD, Wire<TD>> {
    return new DeleteQuery<TD, Wire<TD>>(
      this.table,
      this.target,
      this.ret,
      false,
      this.conn,
    );
  }

  toSQL(): Lowered {
    return {
      sql: `DELETE $__thing ${retClause(this.ret)}`,
      vars: { __thing: this.target },
    };
  }
}

// --- factories -----------------------------------------------------------------------------------

/** Start a `CREATE` — `create(User).content({ … })`. Returns the created row (decoded `App<TD>`).
 *  Pass a `conn` to pre-bind (the ORM client does); omit it for `.run(conn)`. */
export function create<TD extends AnyTableDef>(
  table: TD,
  conn?: Queryable,
): CreateQuery<TD, App<TD>> {
  return new CreateQuery<TD, App<TD>>(table, undefined, "after", true, conn);
}

/** Start an `UPDATE` of one record — `update(User, id).merge({ … })`. `id` is the app-typed
 *  `RecordId` or its plain string id part. Returns the updated row (decoded `App<TD>`). */
export function update<TD extends AnyTableDef>(
  table: TD,
  id: TargetId<TD>,
  conn?: Queryable,
): UpdateQuery<TD, App<TD>> {
  return new UpdateQuery<TD, App<TD>>(
    table,
    thingOf(table, id),
    undefined,
    undefined,
    "after",
    true,
    conn,
  );
}

/** Start a `DELETE` of one record — `remove(User, id)` (named `remove` because `delete` is a
 *  reserved word; the bound client exposes it as `db.delete(User, id)`). Returns nothing by
 *  default; `.return("before")` hands back the deleted row. */
export function remove<TD extends AnyTableDef>(
  table: TD,
  id: TargetId<TD>,
  conn?: Queryable,
): DeleteQuery<TD, undefined> {
  return new DeleteQuery<TD, undefined>(
    table,
    thingOf(table, id),
    "none",
    true,
    conn,
  );
}
