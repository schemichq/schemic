/**
 * The predicate/expression layer of the SurrealDB query builder: field REFS (typed column
 * handles with operators + the per-kind stdlib families), the `Expr` node tree, and its
 * SurrealQL lowering. Split from `./index` so `block()` and the writes builder share it
 * without importing the SELECT machinery.
 *
 * Refs are DEFERRED (see `./render`): a ref renders at lowering time, in a context that knows
 * the current row scope — that's what makes `u.name.length()` compose (`string::len(name)`)
 * and an outer-row ref inside a subquery lower to `$parent.name` automatically.
 */

import { brandRef, type FieldRefBase } from "@schemic/core/query";
import { BoundQuery, escapeIdent, type RecordId } from "surrealdb";
import { type RefMethodSpec, refMethods } from "../fn";
import type { App, ParamDef, ParamRef, Range, TableDef } from "../pure";
import {
  argRenderer,
  type Ctx,
  FRAGMENT,
  fragOf,
  mergeRaw,
  operandText,
  REF_STATE,
  type RefKind,
  type RefState,
  refState,
  renderRef,
} from "./render";
import { SCHEMALESS } from "./schemaless";

// --- the Expr node tree ---------------------------------------------------------------------------

/** Binary operators lowered as `<lhs> <op> $bind` (spellings live-verified on 3.x). */
type BinOp =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "IN"
  | "NOT IN"
  | "CONTAINS"
  | "CONTAINSANY"
  | "CONTAINSALL";
type ExprNode =
  | {
      readonly kind: "cmp";
      readonly lhs: RefState;
      readonly op: BinOp;
      readonly value: unknown;
    }
  | {
      readonly kind: "strfn";
      readonly fn: "string::starts_with" | "string::ends_with";
      readonly lhs: RefState;
      readonly value: unknown;
    }
  | { readonly kind: "none"; readonly lhs: RefState; readonly negated: boolean }
  | {
      // LHS is a fragment (a graph traversal): `(<path>) CONTAINS $bind` etc. Lowered with ctx so
      // the traversal's own binds (edge/target filters) merge in.
      readonly kind: "fragcmp";
      readonly lhs: unknown;
      readonly op: BinOp;
      readonly value: unknown;
    }
  | { readonly kind: "and" | "or"; readonly parts: readonly Expr[] }
  | { readonly kind: "not"; readonly part: Expr }
  | { readonly kind: "raw"; readonly q: BoundQuery };

/** Chainable boolean combinators — every predicate carries them, so `u.age.gte(18).and(...)`
 *  needs no standalone import. A raw `surql` fragment (`Frag<boolean>`) is accepted anywhere an
 *  `Expr` is. */
interface ExprOps {
  and(...more: (Expr | BoundQuery)[]): Expr;
  or(...more: (Expr | BoundQuery)[]): Expr;
  not(): Expr;
}
export type Expr = ExprNode & ExprOps;

/** A raw predicate leaf: `where` (and every combinator) accepts a `surql` fragment directly. */
export type Predicate = Expr | BoundQuery;

/** The Expr brand (`Symbol.for` — readable across layers without importing this module). */
const EXPR_BRAND: unique symbol = Symbol.for("schemic.surrealdb.expr") as never;
/** Is this a builder predicate Expr? (`block().return((s) => s.res.id.isNotNone())`). */
export function isExpr(v: unknown): v is Expr {
  return (
    v !== null &&
    typeof v === "object" &&
    (v as Record<symbol, unknown>)[EXPR_BRAND] === true
  );
}

const exprProto: ExprOps & { [EXPR_BRAND]: true } = {
  [EXPR_BRAND]: true,
  and(this: Expr, ...more: Predicate[]): Expr {
    return mkExpr({ kind: "and", parts: [this, ...more.map(toExpr)] });
  },
  or(this: Expr, ...more: Predicate[]): Expr {
    return mkExpr({ kind: "or", parts: [this, ...more.map(toExpr)] });
  },
  not(this: Expr): Expr {
    return mkExpr({ kind: "not", part: this });
  },
};
function mkExpr(node: ExprNode): Expr {
  return Object.assign(Object.create(exprProto), node) as Expr;
}
/** Coerce a raw `surql` fragment into an Expr leaf (an Expr passes through). */
export function toExpr(p: Predicate): Expr {
  return p instanceof BoundQuery ? mkExpr({ kind: "raw", q: p }) : p;
}

/** Build a fragment-LHS comparison — a graph traversal used as an array in WHERE
 *  (`(->owns->product) CONTAINS $x`). `op` is the containment spelling. */
export function fragCmp(
  lhs: unknown,
  op: "CONTAINS" | "CONTAINSANY" | "CONTAINSALL",
  value: unknown,
): Expr {
  return mkExpr({ kind: "fragcmp", lhs, op, value });
}

export const and = (...parts: Predicate[]): Expr =>
  mkExpr({ kind: "and", parts: parts.map(toExpr) });
export const or = (...parts: Predicate[]): Expr =>
  mkExpr({ kind: "or", parts: parts.map(toExpr) });

/** An operand: a literal (BOUND as a param), a typed `$param` ref from a contextual callback
 *  (`u.age.gte(a.adultThreshold)` splices `$adultThreshold`), another field ref (spliced —
 *  `$parent.<col>` when it belongs to an outer row), or a `surql` fragment / builder (spliced,
 *  bindings merged). */
export type Operand<T> =
  | T
  | ParamRef<T>
  | ParamDef<T>
  | FieldRefBase<T>
  | BoundQuery;

// --- the typed ref surface ------------------------------------------------------------------------

/** The operators every column carries (comparisons, set membership, NONE checks). */
export interface FieldRefOps<T> extends FieldRefBase<T> {
  eq(v: Operand<T>): Expr;
  neq(v: Operand<T>): Expr;
  lt(v: Operand<T>): Expr;
  lte(v: Operand<T>): Expr;
  gt(v: Operand<T>): Expr;
  gte(v: Operand<T>): Expr;
  /** `col IN [...]` — the value is one of a list, or falls inside a {@link Range}
   *  (`age.in(range({ from: 18, to: 65 }))` -> `age IN 18..=65`). */
  in(values: Operand<readonly T[]> | Range<NonNullable<T>>): Expr;
  /** `col NOT IN [...]` — likewise, list or {@link Range}. */
  notIn(values: Operand<readonly T[]> | Range<NonNullable<T>>): Expr;
  /** `col = NONE` — the field is absent (optional fields). */
  isNone(): Expr;
  /** `col != NONE` — the field is present. */
  isNotNone(): Expr;
}

/** String operators + the string stdlib (each derived method returns a ref again, so
 *  `u.name.length().gt(3)` and `u.name.lowercase().startsWith("a")` keep chaining). */
export interface StringRefOps {
  startsWith(prefix: Operand<string>): Expr;
  endsWith(suffix: Operand<string>): Expr;
  /** `col CONTAINS $substr` — CASE-SENSITIVE substring test (a NONE column doesn't match, like
   *  `startsWith`/`endsWith`). Named `.includes` to match `z.string().includes()` and the ratified
   *  cross-driver spelling — `.contains*` is reserved for ARRAY membership. Lowers to the native
   *  SurrealQL `CONTAINS`. */
  includes(substring: Operand<string>): Expr;
  /** `string::len(col)`. */
  length(): FieldRef<number>;
  lowercase(): FieldRef<string>;
  uppercase(): FieldRef<string>;
  trim(): FieldRef<string>;
  /** `string::slug(col)` — URL-safe slug. */
  slug(): FieldRef<string>;
  reverse(): FieldRef<string>;
  repeat(n: Operand<number>): FieldRef<string>;
  replace(
    search: Operand<string>,
    replacement: Operand<string>,
  ): FieldRef<string>;
  slice(start: Operand<number>, len?: Operand<number>): FieldRef<string>;
  split(separator: Operand<string>): FieldRef<string[]>;
  words(): FieldRef<string[]>;
}

/** Numeric arithmetic + `math::*` stdlib — results chain (`p.views.plus(1)`, `u.score.round().gte(5)`). */
export interface NumberRefOps {
  /** `(col + n)`. */
  plus(n: Operand<number>): FieldRef<number>;
  /** `(col - n)`. */
  minus(n: Operand<number>): FieldRef<number>;
  /** `(col * n)`. */
  times(n: Operand<number>): FieldRef<number>;
  /** `(col / n)`. */
  div(n: Operand<number>): FieldRef<number>;
  abs(): FieldRef<number>;
  ceil(): FieldRef<number>;
  floor(): FieldRef<number>;
  round(): FieldRef<number>;
  sqrt(): FieldRef<number>;
  pow(exp: Operand<number>): FieldRef<number>;
  /** `math::fixed(col, places)`. */
  fixed(places: Operand<number>): FieldRef<number>;
}

/** Array operators (`CONTAINS*`) + the `array::*` stdlib. */
export interface ArrayRefOps<E> {
  /** `col CONTAINS $v` — the array holds the element. */
  contains(v: Operand<E>): Expr;
  containsAny(vs: Operand<readonly E[]>): Expr;
  containsAll(vs: Operand<readonly E[]>): Expr;
  /** `array::len(col)`. */
  length(): FieldRef<number>;
  at(index: Operand<number>): FieldRef<E>;
  first(): FieldRef<E>;
  last(): FieldRef<E>;
  distinct(): FieldRef<E[]>;
  sort(): FieldRef<E[]>;
  reverse(): FieldRef<E[]>;
  slice(start: Operand<number>, len?: Operand<number>): FieldRef<E[]>;
  flatten(): FieldRef<unknown[]>;
  /** `array::join(col, separator)`. */
  join(separator: Operand<string>): FieldRef<string>;
}

/** Datetime decomposition (`time::*`) — each part is a chainable number ref. */
export interface DateRefOps {
  year(): FieldRef<number>;
  month(): FieldRef<number>;
  day(): FieldRef<number>;
  hour(): FieldRef<number>;
  minute(): FieldRef<number>;
  second(): FieldRef<number>;
  /** Day of week (1–7). */
  wday(): FieldRef<number>;
  week(): FieldRef<number>;
  /** Day of year. */
  yday(): FieldRef<number>;
  /** Seconds since the epoch. */
  unix(): FieldRef<number>;
  /** `time::format(col, fmt)` — strftime-style. */
  format(fmt: Operand<string>): FieldRef<string>;
}

type IsAny<T> = 0 extends 1 & T ? true : false;

/** A reference to a column (or a derived expression over one) inside a builder callback.
 *  Extends the neutral `FieldRefBase<T>` (so core's projection inference can read its app type);
 *  the operator + stdlib set narrows by the value's app type — string methods on strings,
 *  `array::*` on arrays, `math::*` on numbers, `time::*` on datetimes. The `IsAny` guard keeps
 *  the shape-agnostic `TableDef<string, any>` row assignable (an `any` column gets just the base
 *  ops). */
export type FieldRef<T> = FieldRefOps<T> &
  (IsAny<T> extends true
    ? unknown
    : ([NonNullable<T>] extends [string] ? StringRefOps : unknown) &
        ([NonNullable<T>] extends [number] ? NumberRefOps : unknown) &
        ([NonNullable<T>] extends [Date] ? DateRefOps : unknown) &
        ([NonNullable<T>] extends [readonly (infer E)[]]
          ? ArrayRefOps<E>
          : unknown) &
        // PLAIN objects expose their properties as child refs (`sv.res.id.isNotNone()`,
        // `u.meta.tags`); leaf/value classes (RecordId, dates, bytes, …) don't.
        ([NonNullable<T>] extends [
          | string
          | number
          | boolean
          | bigint
          | Date
          | readonly unknown[]
          | RecordId
          | Uint8Array,
        ]
          ? unknown
          : [NonNullable<T>] extends [object]
            ? { [K in keyof NonNullable<T>]-?: FieldRef<NonNullable<T>[K]> }
            : unknown));

// --- the runtime ref ------------------------------------------------------------------------------

/** Every stdlib method name across families — attached as a GUIDANCE thrower when a ref's runtime
 *  kind is unknown (`other`): the name is ambiguous (`length` = `string::len` vs `array::len`)
 *  without a kind, so the error explains the escape hatch instead of a bare "not a function". */
const allMethodNames: readonly string[] = [
  ...new Set(
    Object.values(refMethods).flatMap((family) => Object.keys(family)),
  ),
];

/** Arithmetic precedence (SurrealQL: `*`/`/` bind over `+`/`-`; comparisons sit below both) —
 *  parens are emitted ONLY where precedence requires them, matching the DB's canonical printer
 *  (redundant parens would phantom-diff DDL round-trips). */
const OP_PREC: Record<string, number> = { "+": 6, "-": 6, "*": 7, "/": 7 };

function derivedMethod(state: RefState, spec: RefMethodSpec) {
  return (...args: unknown[]): FieldRef<unknown> => {
    const present = args.filter((a) => a !== undefined);
    const rends = present.map((a) => argRenderer(a));
    const prev = state.wrap;
    const base = (inner: string, ctx: Ctx) => (prev ? prev(inner, ctx) : inner);
    let wrap: RefState["wrap"];
    let opPrec: number | undefined;
    if (spec.fn.startsWith("op:")) {
      const op = spec.fn.slice(3);
      const prec = OP_PREC[op] as number;
      opPrec = prec;
      // lhs needs parens when it's a LOWER-precedence op chain; rhs also when EQUAL (`a - (b - c)`).
      const lhsParen = state.opPrec !== undefined && state.opPrec < prec;
      const rhsState = refState(present[0]);
      const rhsParen =
        rhsState?.opPrec !== undefined && rhsState.opPrec <= prec;
      wrap = (inner, ctx) => {
        const lhs = lhsParen ? `(${base(inner, ctx)})` : base(inner, ctx);
        const rhsText = rends[0] ? rends[0](ctx) : "";
        return `${lhs} ${op} ${rhsParen ? `(${rhsText})` : rhsText}`;
      };
    } else {
      wrap = (inner, ctx) =>
        `${spec.fn}(${[base(inner, ctx), ...rends.map((r) => r(ctx))].join(", ")})`;
    }
    const kind: RefKind =
      spec.returns === "element" ? (state.elem ?? "other") : spec.returns;
    const elem =
      spec.returns === "array" ? (spec.elem ?? state.elem) : undefined;
    return mkRef({ root: state.root, wrap, kind, elem, opPrec });
  };
}

/** Build the runtime ref for a {@link RefState}: comparison ops + the stdlib family for its kind.
 *  Kind `other` gets guidance throwers on the stdlib names (see {@link allMethodNames}). */
export function mkRef(state: RefState): FieldRef<unknown> {
  const cmp =
    (op: BinOp) =>
    (value: unknown): Expr =>
      mkExpr({ kind: "cmp", lhs: state, op, value });
  const strfn =
    (fn: "string::starts_with" | "string::ends_with") =>
    (value: unknown): Expr =>
      mkExpr({ kind: "strfn", fn, lhs: state, value });
  const impl: Record<string | symbol, unknown> = {
    [REF_STATE]: state,
    eq: cmp("="),
    neq: cmp("!="),
    lt: cmp("<"),
    lte: cmp("<="),
    gt: cmp(">"),
    gte: cmp(">="),
    in: cmp("IN"),
    notIn: cmp("NOT IN"),
    // `.includes` (string substring) and `.contains`/`Any`/`All` (array membership) both lower to
    // the native `CONTAINS`; the neutral builder names split by the ratified cross-driver
    // vocabulary while the emit stays dialect-faithful. The TYPE surface (StringRefOps vs
    // ArrayRefOps) gates which name is visible per column kind.
    includes: cmp("CONTAINS"),
    contains: cmp("CONTAINS"),
    containsAny: cmp("CONTAINSANY"),
    containsAll: cmp("CONTAINSALL"),
    startsWith: strfn("string::starts_with"),
    endsWith: strfn("string::ends_with"),
    isNone: (): Expr => mkExpr({ kind: "none", lhs: state, negated: false }),
    isNotNone: (): Expr => mkExpr({ kind: "none", lhs: state, negated: true }),
  };
  // Interpolation: a PLAIN column ref splices as its escaped column path (the tag's colref
  // brand); a derived/`$var` ref splices as its rendered fragment.
  if (!state.wrap && "col" in state.root)
    impl[Symbol.for("schemic.surrealdb.colref")] = state.root.col;
  impl[FRAGMENT] = (): BoundQuery => {
    const ctx: Ctx = { vars: {} };
    const text = renderRef(state, ctx);
    return new BoundQuery(text, ctx.vars);
  };
  if (state.kind !== "other") {
    for (const [name, spec] of Object.entries(refMethods[state.kind]))
      impl[name] = derivedMethod(state, spec);
  } else {
    for (const name of allMethodNames) {
      if (name in impl) continue;
      impl[name] = () => {
        throw new Error(
          `.${name}() needs the value's runtime kind (string/number/array/datetime), which is unknown here — call the builtin explicitly instead: surql.fn.<ns>.<fn>(...).`,
        );
      };
    }
  }
  const ref = brandRef(impl);
  // PROPERTY PATHS: an unknown string key on a PLAIN ref (no derived wrap) is a child ref —
  // `sv.res.id` renders `$res.id`, `u.meta.tags` renders `meta.tags`. Names already on the ref
  // (ops, stdlib, `then`) are reserved and shadow same-named columns (escape hatch: surql
  // fragments). Derived expressions (`.length()`, arithmetic) have no property paths.
  if (state.wrap) return ref as unknown as FieldRef<unknown>;
  return new Proxy(ref as Record<string | symbol, unknown>, {
    get(t, key, recv) {
      if (typeof key !== "string" || key in t || key === "then")
        return Reflect.get(t, key, recv);
      const root =
        "col" in state.root
          ? { col: `${state.root.col}.${key}`, row: state.root.row }
          : { text: `${state.root.text}.${escapeIdent(key)}` };
      return mkRef({ root, kind: "other" });
    },
  }) as unknown as FieldRef<unknown>;
}

// --- refs for a table row -------------------------------------------------------------------------

/** The typed row handed to a callback: every column as a `FieldRef`. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export type Row<TD extends TableDef<string, any>> = {
  [K in keyof App<TD>]-?: FieldRef<App<TD>[K]>;
};

/** Resolve a column schema's runtime KIND (drives the stdlib family) by unwrapping Zod wrapper
 *  types to the base — codecs/pipes resolve to their APP (output) side. Unknown -> `other`. */
function kindOf(schema: unknown): { kind: RefKind; elem?: RefKind } {
  let cur = schema as
    | { _zod?: { def?: Record<string, unknown> & { type?: string } } }
    | undefined;
  for (let i = 0; i < 24; i++) {
    const def = cur?._zod?.def;
    if (!def?.type) break;
    if (
      def.type === "optional" ||
      def.type === "nullable" ||
      def.type === "default" ||
      def.type === "prefault" ||
      def.type === "readonly" ||
      def.type === "nonoptional" ||
      def.type === "catch"
    ) {
      cur = def.innerType as typeof cur;
    } else if (def.type === "pipe") {
      cur = def.out as typeof cur;
    } else if (def.type === "lazy") {
      cur = (def.getter as () => typeof cur)();
    } else {
      break;
    }
  }
  const t = cur?._zod?.def?.type;
  if (t === "string" || t === "enum" || t === "template_literal")
    return { kind: "string" };
  if (t === "number" || t === "int" || t === "bigint")
    return { kind: "number" };
  if (t === "date") return { kind: "date" };
  if (t === "array") {
    const elem = kindOf(
      (cur?._zod?.def as { element?: unknown } | undefined)?.element,
    ).kind;
    return { kind: "array", elem: elem === "other" ? undefined : elem };
  }
  return { kind: "other" };
}

/** INTERNAL (shared with `./write`): the typed callback row for a table, every column a ref.
 *  `row` is the builder's row-scope token — a ref carried into a DIFFERENT builder's lowering
 *  renders as `$parent.<col>` (correlated subquery). Omit it (writes projections) and refs
 *  always render bare. */
// biome-ignore lint/suspicious/noExplicitAny: TableDef's Shape varies per call site.
export function refsFor<TD extends TableDef<string, any>>(
  table: TD,
  row?: symbol,
): Row<TD> {
  // SCHEMALESS (untyped) table: any field name resolves to a generic ref via a proxy.
  if ((table as Record<symbol, unknown>)[SCHEMALESS] === true) {
    const { kind, elem } = kindOf(undefined); // -> { kind: "other" } (base ref ops)
    return new Proxy(
      {},
      {
        get: (_t, key) =>
          typeof key === "string"
            ? mkRef({ root: { col: key, row }, kind, elem })
            : undefined,
      },
    ) as unknown as Row<TD>;
  }
  const refs: Record<string, FieldRef<unknown>> = {};
  for (const key of Object.keys(table.object.shape)) {
    const { kind, elem } = kindOf(table.object.shape[key]);
    refs[key] = mkRef({ root: { col: key, row }, kind, elem });
  }
  return refs as unknown as Row<TD>;
}

/** INTERNAL (shared with `./write`): a PLAIN ref's column name. Derived expressions have no
 *  single column — positions that need one (ORDER BY, write projections) reject them. */
export function refCol(ref: unknown): string {
  const s = refState(ref);
  if (!s || s.wrap || !("col" in s.root))
    throw new Error(
      "expected a plain column ref — a derived expression (e.g. `.length()`) has no column name here (ORDER BY and write projections take bare columns).",
    );
  return s.root.col;
}

// --- lowering -------------------------------------------------------------------------------------

/** Lower an Expr tree in a context (bind map + current row scope). */
export function lowerExpr(e: Expr, ctx: Ctx): string {
  if (e.kind === "cmp")
    return `${renderRef(e.lhs, ctx)} ${e.op} ${operandText(e.value, ctx)}`;
  if (e.kind === "strfn")
    return `${e.fn}(${renderRef(e.lhs, ctx)}, ${operandText(e.value, ctx)})`;
  if (e.kind === "none")
    return `${renderRef(e.lhs, ctx)} ${e.negated ? "!=" : "="} NONE`;
  if (e.kind === "fragcmp") {
    const frag = fragOf(e.lhs);
    const lhs = frag ? mergeRaw(frag, ctx.vars) : String(e.lhs);
    return `(${lhs}) ${e.op} ${operandText(e.value, ctx)}`;
  }
  if (e.kind === "raw") return `(${mergeRaw(e.q, ctx.vars)})`;
  if (e.kind === "not") return `!(${lowerExpr(e.part, ctx)})`;
  const joined = e.parts
    .map((p) => lowerExpr(p, ctx))
    .join(e.kind === "and" ? " AND " : " OR ");
  return `(${joined})`;
}
