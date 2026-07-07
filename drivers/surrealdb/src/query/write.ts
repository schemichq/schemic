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
import { BoundQuery, escapeIdent, type RecordId } from "surrealdb";
import type { App, Create, TableDef, Update, Wire } from "../pure";
import { isParamRef } from "../pure";
import { type Expr, lowerExpr, type Predicate, toExpr } from "./expr";
import {
  type FieldRefOps,
  FRAGMENT,
  type Operand,
  type Out,
  type Queryable,
  type Row,
  refCol,
  refsFor,
  splitIdArgs,
  type TargetId,
  thingOf,
  toFragment,
} from "./index";
import { type Ctx, operandText, refState, stripOuterParens } from "./render";

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

/** Shared execute/decode/thenable core of the three write builders. Array by default (SurrealDB-
 *  faithful); `.only()` emits `ONLY` and re-types the result to a single row (`Single = true`). */
abstract class WriteQuery<
  TD extends AnyTableDef,
  Res,
  Single extends boolean = false,
> {
  /** Interpolate this write into a `surql` template — it splices as `(CREATE/UPDATE/DELETE ...)`. */
  [FRAGMENT](): BoundQuery {
    return this.toQuery();
  }

  /** This write as a composable fragment: the lowered `(CREATE/UPDATE/DELETE ...)` with
   *  namespaced binds. Interpolates into `surql` templates and every authoring slot that takes one. */
  toQuery(): BoundQuery {
    const { sql, vars } = this.toSQL();
    return toFragment({ sql, vars });
  }

  protected constructor(
    protected readonly table: TD,
    protected readonly ret: Ret,
    protected readonly decode: boolean,
    protected readonly conn?: Queryable,
    /** `.only()` -> emit the `ONLY` keyword + return a single row instead of an array. */
    protected readonly onlyMode: boolean = false,
  ) {}

  /** `"ONLY "` when in single mode (else `""`) — placed right after the verb. */
  protected onlyKw(): string {
    return this.onlyMode ? "ONLY " : "";
  }

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

  /** Decode the statement's result rows per the current `RETURN` mode (`Res` is the element type). */
  decodeRows(rows: readonly unknown[]): Res[] {
    if (this.ret === "none") return [];
    if (Array.isArray(this.ret)) {
      const fields: ProjectionField[] = this.ret.map((p) => ({
        as: p.as,
        schema: this.table.object.shape[p.col],
      }));
      return decodeProjection(fields, rows as unknown[]) as Res[];
    }
    if (this.ret === "diff" || !this.decode) return rows as Res[];
    return rows.map((r) => this.table.decode(r)) as Res[];
  }

  /** INTERNAL: decode this write's value when PROJECTED inside another builder. */
  decodeValue(raw: unknown): unknown {
    if (this.onlyMode) {
      if (raw === undefined || raw === null) return undefined;
      return this.decodeRows([raw])[0];
    }
    return this.decodeRows((raw ?? []) as unknown[]);
  }

  /** Execute against `conn` (or the pre-bound connection, if this builder came from a client).
   *  Array by default; a single row (or `undefined`) in `.only()` mode. */
  async run(conn?: Queryable): Promise<Out<Res, Single>> {
    const c = conn ?? this.conn;
    if (!c)
      throw new Error(
        `${this.kind()}() is not bound to a connection — pass one to \`.run(conn)\`, or use a bound client (\`connect()\`).`,
      );
    const { sql, vars } = this.toSQL();
    const out = (await c.query(sql, vars)) as unknown[];
    const first = out[0];
    if (this.onlyMode) {
      const decoded = this.decodeRows(
        first === undefined || first === null ? [] : [first],
      );
      return decoded[0] as Out<Res, Single>;
    }
    return this.decodeRows((first ?? []) as unknown[]) as Out<Res, Single>;
  }

  /** PromiseLike: awaiting a **bound** builder runs it. */
  then<TResult1 = Out<Res, Single>, TResult2 = never>(
    onfulfilled?:
      | ((value: Out<Res, Single>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }
}

// --- CREATE --------------------------------------------------------------------------------------

export class CreateQuery<
  TD extends AnyTableDef,
  Res = App<TD>,
  Single extends boolean = false,
> extends WriteQuery<TD, Res, Single> {
  constructor(
    table: TD,
    private readonly payload: Record<string, unknown> | undefined,
    ret: Ret = "after",
    decode = true,
    conn?: Queryable,
    /** A fixed CREATE target — a SINGLETON table creates ITS record (`CREATE config:default`). */
    private readonly target?: RecordId,
    only = false,
  ) {
    super(table, ret, decode, conn, only);
  }
  protected kind(): string {
    return "create";
  }

  /** Output mode — emit `CREATE ONLY …`, returning the single created row (not an array). */
  only(): CreateQuery<TD, Res, true> {
    return new CreateQuery<TD, Res, true>(
      this.table,
      this.payload,
      this.ret,
      this.decode,
      this.conn,
      this.target,
      true,
    );
  }

  /** The row to create — validated + encoded via the table's `Create` codec (DB-filled fields
   *  optional; invalid input throws the aggregated `z.ZodError` here, not at `await`). */
  content(data: Create<TD>): CreateQuery<TD, Res, Single> {
    return new CreateQuery<TD, Res, Single>(
      this.table,
      this.table.encode(data) as Record<string, unknown>,
      this.ret,
      this.decode,
      this.conn,
      this.target,
      this.onlyMode,
    );
  }

  /** What the statement returns: `after` (default — the created row), a projection callback
   *  (`.return(r => ({ name: r.name }))`), or the surreal-native `before`/`none`/`diff`. */
  return(mode: "none"): CreateQuery<TD, undefined, Single>;
  return(mode: "before" | "after"): CreateQuery<TD, App<TD>, Single>;
  return(mode: "diff"): CreateQuery<TD, unknown, Single>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): CreateQuery<TD, Project<P>, Single>;
  return(
    mode:
      | WriteReturn
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): CreateQuery<TD, unknown, Single> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new CreateQuery(
      this.table,
      this.payload,
      ret,
      this.decode,
      this.conn,
      this.target,
      this.onlyMode,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): CreateQuery<TD, Wire<TD>, Single> {
    return new CreateQuery<TD, Wire<TD>, Single>(
      this.table,
      this.payload,
      this.ret,
      false,
      this.conn,
      this.target,
      this.onlyMode,
    );
  }

  toSQL(): Lowered {
    if (!this.payload)
      throw new Error(
        "create() has no row yet — call `.content(data)` before running it.",
      );
    if (this.target)
      return {
        sql: `CREATE ${this.onlyKw()}$__thing CONTENT $__content ${retClause(this.ret)}`,
        vars: { __thing: this.target, __content: this.payload },
      };
    return {
      sql: `CREATE ${this.onlyKw()}${escapeIdent(this.table.name)} CONTENT $__content ${retClause(this.ret)}`,
      vars: { __content: this.payload },
    };
  }
}

// --- UPDATE --------------------------------------------------------------------------------------

type UpdateMode = "merge" | "content" | "set";

/** The callback form of `.set`: each field takes its app value (encoded through the codec), a
 *  typed expression over the row (`p.views.plus(1)`), a `$param` ref, or a `surql` fragment. */
export type SetSpec<TD extends AnyTableDef> = {
  [K in keyof Update<TD>]?: Operand<Update<TD>[K]>;
};

/** Is this `.set` value an EXPRESSION (spliced) rather than a literal (codec-encoded + bound)? */
function isSetExpr(v: unknown): boolean {
  return (
    isParamRef(v) ||
    refState(v) !== undefined ||
    v instanceof BoundQuery ||
    (v !== null &&
      typeof v === "object" &&
      typeof (v as { toQuery?: unknown }).toQuery === "function")
  );
}

export class UpdateQuery<
  TD extends AnyTableDef,
  Res = App<TD>,
  Single extends boolean = false,
> extends WriteQuery<TD, Res, Single> {
  constructor(
    table: TD,
    /** A `RecordId` (by-id single target) or `undefined` (BULK — the whole table `UPDATE t …`). */
    private readonly target: RecordId | undefined,
    private readonly mode: UpdateMode | undefined,
    private readonly payload: Record<string, unknown> | undefined,
    ret: Ret = "after",
    decode = true,
    conn?: Queryable,
    /** `.set` callback entries whose value is an EXPRESSION (spliced, not bound). */
    private readonly exprSet?: readonly { col: string; value: unknown }[],
    /** `.where(…)` filter (bulk updates; also a conditional guard on a by-id target). */
    private readonly filter?: Expr,
    only = false,
    /** `UPDATE` or `UPSERT` — the same builder shape lowers both (see the `upsert` factory). */
    private readonly verb: "UPDATE" | "UPSERT" = "UPDATE",
  ) {
    super(table, ret, decode, conn, only);
  }
  protected kind(): string {
    return this.verb.toLowerCase();
  }

  /** Output mode — emit `UPDATE/UPSERT ONLY …`, returning the single row (not an array). */
  only(): UpdateQuery<TD, Res, true> {
    return new UpdateQuery<TD, Res, true>(
      this.table,
      this.target,
      this.mode,
      this.payload,
      this.ret,
      this.decode,
      this.conn,
      this.exprSet,
      this.filter,
      true,
      this.verb,
    );
  }

  /** Filter which rows the update touches — `UPDATE t SET … WHERE …`. On a bulk `update(T)` this
   *  scopes a whole-table update; on `update(T, id)` it is a conditional guard (optimistic write). */
  where(fn: (row: Row<TD>) => Predicate): UpdateQuery<TD, Res, Single> {
    return new UpdateQuery<TD, Res, Single>(
      this.table,
      this.target,
      this.mode,
      this.payload,
      this.ret,
      this.decode,
      this.conn,
      this.exprSet,
      toExpr(fn(refsFor(this.table))),
      this.onlyMode,
      this.verb,
    );
  }

  private with(
    mode: UpdateMode,
    payload: Record<string, unknown>,
    exprSet?: readonly { col: string; value: unknown }[],
  ) {
    return new UpdateQuery<TD, Res, Single>(
      this.table,
      this.target,
      mode,
      payload,
      this.ret,
      this.decode,
      this.conn,
      exprSet,
      this.filter,
      this.onlyMode,
      this.verb,
    );
  }

  /** Deep-`MERGE` a partial patch — validated + encoded via the table's `Update` codec
   *  (id/readonly excluded at the type level; nested objects merge recursively in the DB). */
  merge(patch: Update<TD>): UpdateQuery<TD, Res, Single> {
    return this.with(
      "merge",
      this.table.encodePartial(patch) as Record<string, unknown>,
    );
  }

  /** Replace the row (`CONTENT`) — the full row, validated via the `Create` codec. */
  content(data: Create<TD>): UpdateQuery<TD, Res, Single> {
    return this.with(
      "content",
      this.table.encode(data) as Record<string, unknown>,
    );
  }

  /** Explicit `SET field = value, …` — a partial patch via the `Update` codec; unlike `.merge`,
   *  a nested object value REPLACES the field (SurrealDB `SET` assignment semantics). The
   *  CALLBACK form takes typed row expressions per field —
   *  `.set((p) => ({ views: p.views.plus(1) }))` lowers to `SET views = views + $n` — mixing
   *  freely with literal values (codec-encoded + bound) and `surql` fragments. */
  set(patch: Update<TD>): UpdateQuery<TD, Res, Single>;
  set(fn: (row: Row<TD>) => SetSpec<TD>): UpdateQuery<TD, Res, Single>;
  set(
    arg: Update<TD> | ((row: Row<TD>) => SetSpec<TD>),
  ): UpdateQuery<TD, Res, Single> {
    if (typeof arg === "function") {
      const spec = arg(refsFor(this.table)) as Record<string, unknown>;
      const literals: Record<string, unknown> = {};
      const exprs: { col: string; value: unknown }[] = [];
      for (const [k, v] of Object.entries(spec)) {
        if (v === undefined) continue;
        if (isSetExpr(v)) exprs.push({ col: k, value: v });
        else literals[k] = v;
      }
      const encoded = Object.keys(literals).length
        ? (this.table.encodePartial(literals) as Record<string, unknown>)
        : {};
      return this.with("set", encoded, exprs);
    }
    return this.with(
      "set",
      this.table.encodePartial(arg) as Record<string, unknown>,
    );
  }

  /** What the statement returns: `after` (default — the updated row), a projection callback,
   *  or the surreal-native `before`/`none`/`diff`. */
  return(mode: "none"): UpdateQuery<TD, undefined, Single>;
  return(mode: "before" | "after"): UpdateQuery<TD, App<TD>, Single>;
  return(mode: "diff"): UpdateQuery<TD, unknown, Single>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): UpdateQuery<TD, Project<P>, Single>;
  return(
    mode:
      | WriteReturn
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): UpdateQuery<TD, unknown, Single> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new UpdateQuery(
      this.table,
      this.target,
      this.mode,
      this.payload,
      ret,
      this.decode,
      this.conn,
      this.exprSet,
      this.filter,
      this.onlyMode,
      this.verb,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): UpdateQuery<TD, Wire<TD>, Single> {
    return new UpdateQuery<TD, Wire<TD>, Single>(
      this.table,
      this.target,
      this.mode,
      this.payload,
      this.ret,
      false,
      this.conn,
      this.exprSet,
      this.filter,
      this.onlyMode,
      this.verb,
    );
  }

  toSQL(): Lowered {
    if (!this.mode || !this.payload)
      throw new Error(
        `${this.kind()}() has no patch yet — call \`.merge(patch)\`, \`.content(row)\`, or \`.set(patch)\` before running it.`,
      );
    const vars: Record<string, unknown> = {};
    // BULK (no `.target`) writes to the whole table by name; a by-id target binds as `$__thing`.
    const tgt = this.target ? "$__thing" : escapeIdent(this.table.name);
    if (this.target) vars.__thing = this.target;
    let clause: string;
    if (this.mode === "set") {
      const parts = Object.keys(this.payload).map((k, i) => {
        vars[`__s${i}`] = (this.payload as Record<string, unknown>)[k];
        return `${escapeIdent(k)} = $__s${i}`;
      });
      if (this.exprSet?.length) {
        const ctx: Ctx = { vars };
        for (const e of this.exprSet)
          parts.push(`${escapeIdent(e.col)} = ${operandText(e.value, ctx)}`);
      }
      if (!parts.length)
        throw new Error(
          "update().set() got an empty patch — set at least one field.",
        );
      clause = `SET ${parts.join(", ")}`;
    } else {
      vars.__payload = this.payload;
      clause = `${this.mode.toUpperCase()} $__payload`;
    }
    const where = this.filter
      ? ` WHERE ${stripOuterParens(lowerExpr(this.filter, { vars }))}`
      : "";
    return {
      sql: `${this.verb} ${this.onlyKw()}${tgt} ${clause}${where} ${retClause(this.ret)}`,
      vars,
    };
  }
}

// --- DELETE --------------------------------------------------------------------------------------

export class DeleteQuery<
  TD extends AnyTableDef,
  Res = undefined,
  Single extends boolean = false,
> extends WriteQuery<TD, Res, Single> {
  constructor(
    table: TD,
    /** A `RecordId` (by-id single target) or `undefined` (BULK — the whole table `DELETE t …`). */
    private readonly target: RecordId | undefined,
    ret: Ret = "none",
    decode = true,
    conn?: Queryable,
    /** `.where(…)` filter (bulk deletes; also a conditional guard on a by-id target). */
    private readonly filter?: Expr,
    only = false,
  ) {
    super(table, ret, decode, conn, only);
  }
  protected kind(): string {
    return "delete";
  }

  /** Output mode — emit `DELETE ONLY …`, returning a single row (not an array). */
  only(): DeleteQuery<TD, Res, true> {
    return new DeleteQuery<TD, Res, true>(
      this.table,
      this.target,
      this.ret,
      this.decode,
      this.conn,
      this.filter,
      true,
    );
  }

  /** Filter which rows the delete removes — `DELETE t WHERE …`. On a bulk `remove(T)` this scopes a
   *  whole-table delete; on `remove(T, id)` it is a conditional guard. */
  where(fn: (row: Row<TD>) => Predicate): DeleteQuery<TD, Res, Single> {
    return new DeleteQuery<TD, Res, Single>(
      this.table,
      this.target,
      this.ret,
      this.decode,
      this.conn,
      toExpr(fn(refsFor(this.table))),
      this.onlyMode,
    );
  }

  /** What the statement returns: `none` (default), `before` (the deleted row), a projection
   *  callback (over the deleted row's fields), or `diff`. */
  return(mode: "none"): DeleteQuery<TD, undefined, Single>;
  return(mode: "before"): DeleteQuery<TD, App<TD>, Single>;
  return(mode: "diff"): DeleteQuery<TD, unknown, Single>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<TD>) => P,
  ): DeleteQuery<TD, Project<P>, Single>;
  return(
    mode:
      | Exclude<WriteReturn, "after">
      | ((row: Row<TD>) => Record<string, FieldRefOps<unknown>>),
  ): DeleteQuery<TD, unknown, Single> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return new DeleteQuery(
      this.table,
      this.target,
      ret,
      this.decode,
      this.conn,
      this.filter,
      this.onlyMode,
    );
  }

  /** Skip decode — return the raw wire row. */
  raw(): DeleteQuery<TD, Wire<TD>, Single> {
    return new DeleteQuery<TD, Wire<TD>, Single>(
      this.table,
      this.target,
      this.ret,
      false,
      this.conn,
      this.filter,
      this.onlyMode,
    );
  }

  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    // BULK (no `.target`) deletes the whole table by name; a by-id target binds as `$__thing`.
    const tgt = this.target ? "$__thing" : escapeIdent(this.table.name);
    if (this.target) vars.__thing = this.target;
    const where = this.filter
      ? ` WHERE ${stripOuterParens(lowerExpr(this.filter, { vars }))}`
      : "";
    return {
      sql: `DELETE ${this.onlyKw()}${tgt}${where} ${retClause(this.ret)}`,
      vars,
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
  // A SINGLETON creates ITS one record (`CREATE config:default`) — a bare CREATE would mint a
  // random id, which the literal id type rejects.
  const target =
    table.singletonId !== undefined ? thingOf(table, undefined) : undefined;
  return new CreateQuery<TD, App<TD>>(
    table,
    undefined,
    "after",
    true,
    conn,
    target,
  );
}

/** Resolve a write factory's `[id?, conn?]` args to a target + connection. An omitted id means the
 *  SINGLETON's fixed record, or — for a normal table — a BULK target (`undefined`, the whole table). */
function writeTarget(
  table: AnyTableDef,
  rest: readonly unknown[],
): [RecordId | undefined, Queryable | undefined] {
  const [id, conn] = splitIdArgs(rest);
  const target =
    id !== undefined || table.singletonId !== undefined
      ? thingOf(table, id)
      : undefined;
  return [target, conn];
}

/** Start an `UPDATE` — `update(User, id).merge({ … })` for one record, or `update(User).set(…)
 *  [.where(…)]` for a BULK whole-table / filtered update (SurrealDB-faithful). `id` is the app-typed
 *  `RecordId` or its plain string id part. Returns the updated rows (array; `.only()` for single). */
export function update<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): UpdateQuery<TD, App<TD>> {
  const [target, conn] = writeTarget(table, rest);
  return new UpdateQuery<TD, App<TD>>(
    table,
    target,
    undefined,
    undefined,
    "after",
    true,
    conn,
  );
}

/** Start an `UPSERT` (create-or-update) — `upsert(User, id).merge({ … })` / `.content(row)` /
 *  `.set(patch)` upserts THAT record; `upsert(User)` (no id) mints a new row like `create`; a
 *  bulk `upsert(User).set(…).where(…)` upserts the matching rows. Same builder shape as `update`.
 *  Returns the upserted rows (array; `.only()` for single). */
export function upsert<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): UpdateQuery<TD, App<TD>> {
  const [target, conn] = writeTarget(table, rest);
  return new UpdateQuery<TD, App<TD>>(
    table,
    target,
    undefined,
    undefined,
    "after",
    true,
    conn,
    undefined,
    undefined,
    false,
    "UPSERT",
  );
}

/** Start a `DELETE` — `remove(User, id)` for one record, or `remove(User) [.where(…)]` for a BULK
 *  whole-table / filtered delete (named `remove` because `delete` is a reserved word; the bound
 *  client exposes it as `db.delete(…)`). Returns nothing by default; `.return("before")` hands back
 *  the deleted rows. */
export function remove<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): DeleteQuery<TD, undefined> {
  const [target, conn] = writeTarget(table, rest);
  return new DeleteQuery<TD, undefined>(table, target, "none", true, conn);
}
