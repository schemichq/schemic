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

import type { FieldRefBase } from "@schemic/core/query";
import {
  decodeProjection,
  type Project,
  type ProjectionField,
} from "@schemic/core/query";
import { BoundQuery, escapeIdent, RecordId, Table } from "surrealdb";
import type {
  App,
  Create,
  ParamDef,
  ParamRef,
  Range,
  RelationDef,
  TableDef,
  Update,
  Wire,
} from "../pure";
import { isParamRef, isRange } from "../pure";
import { type Expr, lowerExpr, type Predicate, toExpr } from "./expr";
import {
  type AnySelect,
  type FieldRefOps,
  FRAGMENT,
  type Operand,
  type Out,
  type Queryable,
  type Row,
  refCol,
  refsFor,
  type StatementKind,
  splitIdArgs,
  type TargetId,
  thingOf,
  toFragment,
} from "./index";
import {
  type Ctx,
  mergeRaw,
  operandText,
  paramDefName,
  refState,
  stripOuterParens,
} from "./render";
import {
  type SchemalessRelation,
  type SchemalessTable,
  schemaless,
  type UntypedTable,
} from "./schemaless";

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
  /** Runtime discriminant (`q.kind`) — also names the verb in teaching errors. */
  abstract readonly kind: StatementKind;

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
        `${this.kind}() is not bound to a connection — pass one to \`.run(conn)\`, or use a bound client (\`connect()\`).`,
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

/** How a BULK create names the records it makes: a literal id RANGE (`|t:1..=10|`) or a COUNT of
 *  records with random ids (`|t:5|`). Both are the `|…|` "record-id range" target. */
type IdSpan =
  | { readonly kind: "range"; readonly sql: string }
  | { readonly kind: "count"; readonly n: number };

/** The `|…|` parser takes a literal SIGNED INTEGER and nothing else (a `$param` or a string bound
 *  there is a parse error), so reject anything else here rather than shipping unparseable SQL. */
function idBound(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isInteger(v))
    throw new Error(
      `create().ids(): the ${what} must be a literal integer (SurrealDB's \`|table:a..=b|\` target takes signed integers only — a $param or a string bound is a parse error); got ${JSON.stringify(v)}.`,
    );
  return v;
}

/** Lower a `range()` to the `|table:<span>|` id-range span. BOTH bounds are required: an open-ended
 *  id range (`|t:1..|`) makes the DB try to create records forever — the query never returns
 *  (verified on 3.1.4: the bounded form answers in milliseconds, `|t:1..|` hangs). */
function idSpanOf(spec: Range<number> | { count: number }): IdSpan {
  if (isRange(spec)) {
    if (!spec.start || !spec.end)
      throw new Error(
        "create().ids(range): an id range needs BOTH bounds — an open-ended `|table:1..|` asks the DB to create records without end and the query never returns. Pass a start (`from`/`after`) AND an end (`to`/`until`).",
      );
    const a = idBound(spec.start.value, "start bound");
    const b = idBound(spec.end.value, "end bound");
    const gt = spec.start.exclusive ? ">" : "";
    const eq = spec.end.exclusive ? "" : "=";
    return { kind: "range", sql: `${a}${gt}..${eq}${b}` };
  }
  const n = idBound(spec.count, "count");
  if (n < 0)
    throw new Error(
      `create().ids({ count }): the count can't be negative; got ${n}.`,
    );
  return { kind: "count", n };
}

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
    /** A BULK `|table:…|` target — set by `.ids()`, mutually exclusive with `target`. */
    private readonly span?: IdSpan,
  ) {
    super(table, ret, decode, conn, only);
  }
  readonly kind = "create" as const;

  /**
   * Create MANY records in one statement, via SurrealDB's `|table:…|` record-id target:
   *
   *  - `.ids(range({ from: 1, to: 50 }))` -> `CREATE |user:1..=50|` — 50 rows with the ids `user:1`
   *    … `user:50`. Bounds are literal integers (the `|…|` parser takes nothing else) and BOTH ends
   *    are required — an open-ended range never returns.
   *  - `.ids({ count: 50 })` -> `CREATE |user:50|` — 50 rows with RANDOM ids. (Spelled `{ count }`
   *    on purpose: bare `.ids(50)` reads like the id `user:50`, which is not what `|user:50|` means.)
   *
   * Chain `.content(row)` to give every created record the same body.
   */
  ids(spec: Range<number> | { count: number }): CreateQuery<TD, Res, Single> {
    if (this.target)
      throw new Error(
        `create(${this.table.name}, id).ids(…) targets one record AND a range — drop the id to create many, or drop .ids() to create that one.`,
      );
    return new CreateQuery<TD, Res, Single>(
      this.table,
      this.payload,
      this.ret,
      this.decode,
      this.conn,
      this.target,
      this.onlyMode,
      idSpanOf(spec),
    );
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
      this.span,
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
      this.span,
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
      this.span,
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
      this.span,
    );
  }

  toSQL(): Lowered {
    // `.content()` is OPTIONAL — a contentless `CREATE t:id` makes an empty record (the schema's
    // defaults fill in; the DB still enforces any required-no-default field).
    // The `|table:…|` bulk target inlines LITERAL integers — the parser rejects a `$param` there.
    const span = this.span;
    const tgt = span
      ? `|${escapeIdent(this.table.name)}:${span.kind === "range" ? span.sql : span.n}|`
      : this.target
        ? "$__thing"
        : escapeIdent(this.table.name);
    const vars: Record<string, unknown> = {};
    if (this.target) vars.__thing = this.target;
    let content = "";
    if (this.payload) {
      vars.__content = this.payload;
      content = " CONTENT $__content";
    }
    return {
      sql: `CREATE ${this.onlyKw()}${tgt}${content} ${retClause(this.ret)}`,
      vars,
    };
  }
}

/** The keys of `T` that are REQUIRED (present, no `?`). */
type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

/** A CREATE that still needs `.content()` — the table has a required, non-defaulted field, so a
 *  contentless `CREATE` would be rejected by the DB. Deliberately NOT awaitable and without `toSQL`
 *  / `.raw()`: call `.content(data)` to get the runnable {@link CreateQuery}. Because of this, a
 *  pending create is (correctly) not an `AnyStatement` until content is supplied. */
export interface PendingCreate<TD extends AnyTableDef> {
  readonly kind: "create";
  content(data: Create<TD>): CreateQuery<TD, App<TD>>;
  /** Bulk-create many records ({@link CreateQuery.ids}) — still pending until `.content()` supplies
   *  the body every created record shares. */
  ids(spec: Range<number> | { count: number }): PendingCreate<TD>;
}

/** What `create(T)` returns: a ready {@link CreateQuery} when every field is optional/defaulted (a
 *  contentless `CREATE` is valid), else a {@link PendingCreate} that must be `.content()`-ed first —
 *  so forgetting the body on a table with a required field is a COMPILE error, not a DB error. */
export type CreateStart<TD extends AnyTableDef> = [
  RequiredKeys<Create<TD>>,
] extends [never]
  ? CreateQuery<TD, App<TD>>
  : PendingCreate<TD>;

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
    /** `.all()` acknowledgement — lets an UNSCOPED whole-table write run (see the bulk guard). */
    private readonly bulkAll = false,
  ) {
    super(table, ret, decode, conn, only);
  }
  /** `"update"` or `"upsert"` — the discriminant follows the verb (they share this builder). */
  get kind(): "update" | "upsert" {
    return this.verb === "UPSERT" ? "upsert" : "update";
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
      this.bulkAll,
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
      this.bulkAll,
    );
  }

  /** Acknowledge an UNSCOPED whole-table write — `update(T).all().set(…)` updates EVERY row (and
   *  `upsert(T).all()…`). Required (else the bulk guard throws) so a forgotten id can't silently
   *  rewrite the whole table. With a `.where(…)` scope you never need this. */
  all(): UpdateQuery<TD, Res, Single> {
    return new UpdateQuery<TD, Res, Single>(
      this.table,
      this.target,
      this.mode,
      this.payload,
      this.ret,
      this.decode,
      this.conn,
      this.exprSet,
      this.filter,
      this.onlyMode,
      this.verb,
      true,
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
      this.bulkAll,
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
      this.bulkAll,
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
      this.bulkAll,
    );
  }

  toSQL(): Lowered {
    if (!this.mode || !this.payload)
      throw new Error(
        `${this.kind}() has no patch yet — call \`.merge(patch)\`, \`.content(row)\`, or \`.set(patch)\` before running it.`,
      );
    // Footgun guard: an UNSCOPED table-target write (no id, no `.where`) needs an explicit `.all()`.
    if (!this.target && !this.filter && !this.bulkAll) {
      const t = this.table.name;
      throw new Error(
        this.verb === "UPSERT"
          ? `upsert(${t}) has no id and no \`.where(…)\` — with nothing to match it INSERTS a new row on every run. Use \`create(${t})\` to insert, add \`.where(…)\` to upsert matching rows, or \`.all()\` to confirm.`
          : `update(${t}) has no id and no \`.where(…)\` — it would rewrite EVERY row of the \`${t}\` table. Add \`.where(…)\` to scope it, or \`.all()\` to confirm you mean the whole table.`,
      );
    }
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
    /** `.all()` acknowledgement — lets an UNSCOPED whole-table delete run (see the bulk guard). */
    private readonly bulkAll = false,
  ) {
    super(table, ret, decode, conn, only);
  }
  readonly kind = "delete" as const;

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
      this.bulkAll,
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
      this.bulkAll,
    );
  }

  /** Acknowledge an UNSCOPED whole-table delete — `remove(T).all()` deletes EVERY row. Required
   *  (else the bulk guard throws) so a forgotten id can't wipe the table. A `.where(…)` scope
   *  removes the need for it. */
  all(): DeleteQuery<TD, Res, Single> {
    return new DeleteQuery<TD, Res, Single>(
      this.table,
      this.target,
      this.ret,
      this.decode,
      this.conn,
      this.filter,
      this.onlyMode,
      true,
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
      this.bulkAll,
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
      this.bulkAll,
    );
  }

  toSQL(): Lowered {
    // Footgun guard: an UNSCOPED whole-table delete (no id, no `.where`) needs an explicit `.all()`.
    if (!this.target && !this.filter && !this.bulkAll)
      throw new Error(
        `remove(${this.table.name}) has no id and no \`.where(…)\` — it would DELETE EVERY row of the \`${this.table.name}\` table. Add \`.where(…)\` to scope it, or \`.all()\` to confirm you mean the whole table.`,
      );
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

// --- RELATE --------------------------------------------------------------------------------------

/** Any graph relation (edge) def — the constraint for the `relate` builder. */
// biome-ignore lint/suspicious/noExplicitAny: any relation's endpoint captures + edge shape vary.
export type AnyRelation = RelationDef<string, any, string, string, any, any>;

/** The `TableDef` union a captured `.from()/.to()` ref carries (bare-name endpoints drop to `never`). */
type EndpointDefs<Ref> = Ref extends readonly (infer El)[]
  ? Extract<El, AnyTableDef>
  : Extract<Ref, AnyTableDef>;

/** The endpoint node def(s) for a direction — the edge's `.from()` (source) / `.to()` (target). */
type EndpointNodes<E, Dir extends "from" | "to"> = E extends RelationDef<
  infer _N,
  infer _S,
  infer _In,
  infer _Out,
  infer F,
  infer T
>
  ? EndpointDefs<Dir extends "from" ? F : T>
  : never;

/** The smart record id(s) accepted at an endpoint — the source/target tables' ids. Falls back to any
 *  `RecordId` when the edge left that side unrestricted (bare-name / no `.from`/`.to`). */
type EndpointId<E, Dir extends "from" | "to"> = [
  EndpointNodes<E, Dir>,
] extends [never]
  ? RecordId
  : App<EndpointNodes<E, Dir>> extends { id: infer I }
    ? I
    : RecordId;

/** A record the endpoint may name by REFERENCE: its id, or its whole row — SurrealDB coerces a record
 *  object back to its id at an endpoint (`RELATE $row->edge->…` stores `in: <row>.id`; verified on
 *  3.1.4), which is what makes a `FOR $b IN (SELECT * FROM buffalo)` loop var work directly. */
type EndpointRowOrId<E, Dir extends "from" | "to"> =
  | EndpointId<E, Dir>
  | App<EndpointNodes<E, Dir>>;

/** The value an endpoint REF may carry: one record (single edge) or an array of them (fan-out).
 *  An edge that left this side unrestricted carries `unknown` (any ref is accepted). */
type EndpointRefValue<E, Dir extends "from" | "to"> = [
  EndpointNodes<E, Dir>,
] extends [never]
  ? unknown
  : EndpointRowOrId<E, Dir> | readonly EndpointRowOrId<E, Dir>[];

/** An endpoint named by REFERENCE rather than by value — these splice as their `$name` TEXT, and must
 *  never bind or the DB would see the literal instead of the reference:
 *   - a typed block-var / field ref (`block().for({ b: select(Buffalo) }, (v) => relate(v.b, …))`),
 *     checked against the edge's node type — a ref of the wrong table is a compile error;
 *   - a bare `$param` (`surql.$.x`, or a `defineParam` def), the deliberate ESCAPE HATCH: it names a
 *     param bound in an outer scope whose type we can't see, so the DB checks it. Same call as
 *     `CallArgValue`. Type it with `surql.$.x.as<…>()` when you want the compile-time check back. */
type EndpointRef<E, Dir extends "from" | "to"> =
  | ParamRef
  | ParamDef
  | FieldRefBase<EndpointRefValue<E, Dir>>;

/** A RELATE endpoint: one record (single edge), an array of records (fan-out — one edge each), a
 *  `surql` subquery producing records, or a `$param`/block-var {@link EndpointRef}. NOT a bare table
 *  (SurrealDB rejects it). */
export type Endpoint<E, Dir extends "from" | "to"> =
  | EndpointId<E, Dir>
  | readonly EndpointId<E, Dir>[]
  | BoundQuery
  | EndpointRef<E, Dir>;

/** A RELATE endpoint on the UNTYPED (schemaless) `relate` — the same forms, but unconstrained: with
 *  no edge def there are no `.from()`/`.to()` node types to check the record against. */
export type UntypedEndpoint =
  | RecordId
  | readonly RecordId[]
  | BoundQuery
  | ParamRef
  | ParamDef
  | FieldRefBase<unknown>;

/** The edge body for RELATE `CONTENT` — the edge's create shape minus the `in`/`out` endpoints,
 *  which the RELATE path supplies (so you never pass them in the body). */
type EdgeContent<E extends AnyRelation> = Omit<Create<E>, "in" | "out">;

/** Relate-specific clause state (immutable; cloned via `RelateQuery.rel`). */
interface RelateExtra {
  readonly edgeId?: string;
  readonly mode?: "set" | "content";
  readonly payload?: Record<string, unknown>;
  readonly exprSet?: readonly { col: string; value: unknown }[];
  readonly timeout?: string;
}

/** Lower a RELATE endpoint: a `surql` subquery splices as `(…)`; a `$param` / block-var / field ref
 *  splices as its `$name` TEXT (binding it would hand the DB the literal instead of the reference);
 *  a plain record / record-array binds under the caller's key. */
function endpointSQL(
  ep: unknown,
  key: string,
  vars: Record<string, unknown>,
): string {
  if (ep instanceof BoundQuery) return `(${mergeRaw(ep, vars)})`;
  // Every reference form the operand vocabulary knows (`$param`, a `defineParam` def, a block-var /
  // field ref) — `operandText` renders each as text, row-token-aware, merging any bindings.
  if (isParamRef(ep) || paramDefName(ep) !== undefined || refState(ep))
    return operandText(ep, { vars });
  vars[key] = ep;
  return `$${key}`;
}

/** The RELATE write — `relate(from, Edge, to)` creates the edge record(s) linking the endpoints.
 *  Same execute/decode/thenable core as the other writes (array by default; `.only()` -> `RELATE ONLY`).
 *  Endpoints are type-checked against the edge's `.from()`/`.to()` (record / fan-out array / subquery). */
export class RelateQuery<
  E extends AnyRelation,
  Res = App<E>,
  Single extends boolean = false,
> extends WriteQuery<E, Res, Single> {
  constructor(
    edge: E,
    private readonly fromEp: unknown,
    private readonly toEp: unknown,
    ret: Ret = "after",
    decode = true,
    conn?: Queryable,
    only = false,
    private readonly x: RelateExtra = {},
  ) {
    super(edge, ret, decode, conn, only);
  }
  readonly kind = "relate" as const;

  /** Clone with a patched output mode + relate-specific state. */
  private rel<R, S extends boolean>(
    base: { ret?: Ret; decode?: boolean; onlyMode?: boolean },
    patch: Partial<RelateExtra>,
  ): RelateQuery<E, R, S> {
    return new RelateQuery<E, R, S>(
      this.table,
      this.fromEp,
      this.toEp,
      base.ret ?? this.ret,
      base.decode ?? this.decode,
      this.conn,
      base.onlyMode ?? this.onlyMode,
      { ...this.x, ...patch },
    );
  }

  /** Output mode — emit `RELATE ONLY …`, returning the single edge (not an array). */
  only(): RelateQuery<E, Res, true> {
    return this.rel<Res, true>({ onlyMode: true }, {});
  }

  /** Pin a custom edge record id — `-> edge:<id> ->` (unlike reads, RELATE lets you fix the edge id). */
  id(edgeId: string): RelateQuery<E, Res, Single> {
    return this.rel<Res, Single>({}, { edgeId });
  }

  /** Edge properties via `SET field = value, …`. The CALLBACK form takes typed edge refs (incl the
   *  `in`/`out` endpoints) for expressions; literals go through the edge's `Update` codec. */
  set(patch: Update<E>): RelateQuery<E, Res, Single>;
  set(fn: (edge: Row<E>) => SetSpec<E>): RelateQuery<E, Res, Single>;
  set(
    arg: Update<E> | ((edge: Row<E>) => SetSpec<E>),
  ): RelateQuery<E, Res, Single> {
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
      return this.rel<Res, Single>(
        {},
        { mode: "set", payload: encoded, exprSet: exprs },
      );
    }
    return this.rel<Res, Single>(
      {},
      {
        mode: "set",
        payload: this.table.encodePartial(arg) as Record<string, unknown>,
      },
    );
  }

  /** Edge properties via `CONTENT { … }` — the whole edge body, validated via the edge's `Create`
   *  codec. The `in`/`out` endpoints come from the RELATE path, so they are NOT part of the body. */
  content(data: EdgeContent<E>): RelateQuery<E, Res, Single> {
    return this.rel<Res, Single>(
      {},
      {
        mode: "content",
        payload: this.table.encode(data as Create<E>) as Record<
          string,
          unknown
        >,
      },
    );
  }

  /** What the statement returns: `after` (default — the edge), a projection callback, or the
   *  surreal-native `before`/`none`/`diff`. */
  return(mode: "none"): RelateQuery<E, undefined, Single>;
  return(mode: "before" | "after"): RelateQuery<E, App<E>, Single>;
  return(mode: "diff"): RelateQuery<E, unknown, Single>;
  return<P extends Record<string, FieldRefOps<unknown>>>(
    fn: (row: Row<E>) => P,
  ): RelateQuery<E, Project<P>, Single>;
  return(
    mode: WriteReturn | ((row: Row<E>) => Record<string, FieldRefOps<unknown>>),
  ): RelateQuery<E, unknown, Single> {
    const ret = typeof mode === "function" ? this.projOf(mode) : mode;
    return this.rel<unknown, Single>({ ret }, {});
  }

  /** Cap the statement's run time — `RELATE … TIMEOUT 5s` (a duration literal). */
  timeout(duration: string): RelateQuery<E, Res, Single> {
    return this.rel<Res, Single>({}, { timeout: duration });
  }

  /** Skip decode — return the raw wire edge. */
  raw(): RelateQuery<E, Wire<E>, Single> {
    return this.rel<Wire<E>, Single>({ decode: false }, {});
  }

  toSQL(): Lowered {
    const vars: Record<string, unknown> = {};
    const from = endpointSQL(this.fromEp, "__from", vars);
    const to = endpointSQL(this.toEp, "__to", vars);
    // The edge segment: `edge` or a pinned `edge:<id>` (RecordId escapes the id part correctly).
    const edgeSeg = this.x.edgeId
      ? new RecordId(this.table.name, this.x.edgeId).toString()
      : escapeIdent(this.table.name);
    let clause = "";
    if (this.x.mode === "content") {
      vars.__content = this.x.payload;
      clause = " CONTENT $__content";
    } else if (this.x.mode === "set") {
      const payload = this.x.payload ?? {};
      const parts = Object.keys(payload).map((k, i) => {
        vars[`__s${i}`] = payload[k];
        return `${escapeIdent(k)} = $__s${i}`;
      });
      if (this.x.exprSet?.length) {
        const ctx: Ctx = { vars };
        for (const e of this.x.exprSet)
          parts.push(`${escapeIdent(e.col)} = ${operandText(e.value, ctx)}`);
      }
      if (parts.length) clause = ` SET ${parts.join(", ")}`;
    }
    const timeout = this.x.timeout ? ` TIMEOUT ${this.x.timeout}` : "";
    return {
      sql: `RELATE ${this.onlyKw()}${from}->${edgeSeg}->${to}${clause} ${retClause(this.ret)}${timeout}`,
      vars,
    };
  }
}

// --- factories -----------------------------------------------------------------------------------

/** Start a `CREATE` — `create(User).content({ … })` mints a fresh id; `create(User, id).content({ … })`
 *  creates THAT record (`CREATE user:id …`, which errors if it already exists — unlike `upsert`).
 *  `id` is the app-typed `RecordId` or its plain string id part. Returns the created row (decoded
 *  `App<TD>`). Pass a `conn` to pre-bind (the ORM client does); omit it for `.run(conn)`. */
export function create(
  table: UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
): CreateQuery<SchemalessTable, Record<string, unknown>>;
export function create<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): CreateStart<TD>;
export function create(
  table: AnyTableDef | UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): any {
  // A given id creates THAT record; omitted, a SINGLETON creates its fixed record (`CREATE
  // config:default`) and a normal table mints a random id (`target` stays undefined). Runtime is
  // always a CreateQuery; the typed overload narrows to PendingCreate / a schemaless CreateQuery.
  const src = asTable(table);
  const [target, conn] = writeTarget(src, rest);
  return new CreateQuery(src, undefined, "after", true, conn, target);
}

/** Coerce a factory's table arg: a plain name / SDK `Table` becomes the untyped adapter; a
 *  `TableDef` passes through. Lets every write factory accept `string | Table` (untyped). */
function asTable(table: AnyTableDef | UntypedTable): AnyTableDef {
  return typeof table === "string" || table instanceof Table
    ? (schemaless(table) as unknown as AnyTableDef)
    : table;
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
export function update(
  table: UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
): UpdateQuery<SchemalessTable, Record<string, unknown>>;
export function update<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): UpdateQuery<TD, App<TD>>;
export function update(
  table: AnyTableDef | UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): UpdateQuery<any, any> {
  const src = asTable(table);
  const [target, conn] = writeTarget(src, rest);
  return new UpdateQuery(
    src,
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
export function upsert(
  table: UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
): UpdateQuery<SchemalessTable, Record<string, unknown>>;
export function upsert<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): UpdateQuery<TD, App<TD>>;
export function upsert(
  table: AnyTableDef | UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): UpdateQuery<any, any> {
  const src = asTable(table);
  const [target, conn] = writeTarget(src, rest);
  return new UpdateQuery(
    src,
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
export function remove(
  table: UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
): DeleteQuery<SchemalessTable, undefined>;
export function remove<TD extends AnyTableDef>(
  table: TD,
  ...rest: [id?: TargetId<TD>, conn?: Queryable]
): DeleteQuery<TD, undefined>;
export function remove(
  table: AnyTableDef | UntypedTable,
  ...rest: [id?: RecordId | string, conn?: Queryable]
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): DeleteQuery<any, undefined> {
  const src = asTable(table);
  const [target, conn] = writeTarget(src, rest);
  return new DeleteQuery(src, target, "none", true, conn);
}

/** Start a `RELATE` — `relate(alice, Likes, post).set({ rating: 5 })` links the endpoints with an
 *  edge record. `from`/`to` are the app-typed records (or an array to fan out one edge each, a
 *  `surql` subquery, or a `$param`/block-var ref — see {@link Endpoint}) — type-checked against the
 *  edge's `.from()`/`.to()`. Returns the edge rows (array; `.only()` for single). Pass a `conn` to
 *  pre-bind (the ORM client does). */
export function relate(
  from: UntypedEndpoint,
  edge: UntypedTable,
  to: UntypedEndpoint,
  conn?: Queryable,
): RelateQuery<SchemalessRelation, Record<string, unknown>>;
export function relate<E extends AnyRelation>(
  from: Endpoint<E, "from">,
  edge: E,
  to: Endpoint<E, "to">,
  conn?: Queryable,
): RelateQuery<E, App<E>>;
export function relate(
  // The impl accepts every endpoint form both overloads admit; callers only see the overloads.
  from: unknown,
  edge: AnyRelation | UntypedTable,
  to: unknown,
  conn?: Queryable,
  // biome-ignore lint/suspicious/noExplicitAny: impl signature; callers see the typed overloads.
): RelateQuery<any, any> {
  // A plain name / SDK `Table` edge becomes the untyped adapter; RelateQuery only reads TableDef
  // members off the edge (name + codec), so the schemaless adapter works as the edge.
  const e = asTable(edge) as unknown as AnyRelation;
  return new RelateQuery(e, from, to, "after", true, conn);
}

// --- widened write aliases + the statement union --------------------------------------------------
// "Any*" helpers for functions that receive a WRITE builder regardless of row type / output mode
// (see the reads' `AnySelect`/`AnyCount` in `./index` for the rationale). `AnyUpdate` also covers
// `upsert()` — they share the `UpdateQuery` builder.

/** Any CREATE builder — any row type, any output mode. */
// biome-ignore lint/suspicious/noExplicitAny: a widened alias — every type param is intentionally open.
export type AnyCreate = CreateQuery<any, any, any>;

/** Any UPDATE or UPSERT builder (they share the builder) — any row type, any output mode. */
// biome-ignore lint/suspicious/noExplicitAny: a widened alias — every type param is intentionally open.
export type AnyUpdate = UpdateQuery<any, any, any>;

/** Any DELETE builder — any row type, any output mode. */
// biome-ignore lint/suspicious/noExplicitAny: a widened alias — every type param is intentionally open.
export type AnyDelete = DeleteQuery<any, any, any>;

/** Any RELATE builder — any edge, any output mode. */
// biome-ignore lint/suspicious/noExplicitAny: a widened alias — every type param is intentionally open.
export type AnyRelate = RelateQuery<any, any, any>;

/** Any ROW-RETURNING statement builder — select or a write. Its common surface is `.toQuery()`
 *  (composable), `.raw()` (undecoded rows), and awaitability. `count()` is scalar (no `.raw()`), so
 *  it is intentionally NOT in this union — use `AnyCount` for it. */
export type AnyStatement =
  | AnySelect
  | AnyCreate
  | AnyUpdate
  | AnyDelete
  | AnyRelate;
