/**
 * `block()` — the typed SurrealQL statement-block builder (`{ LET …; IF …; RETURN …; }`).
 * Statement parity for the places SurrealDB takes a block: event `THEN`s, function bodies, and
 * any `surql` interpolation. `LET` vars type through the chain — the refs handed to every later
 * callback carry the value's kind, so `s.n.gt(100)` works and `$n` splices correctly:
 *
 * ```ts
 * block()
 *   .let({ n: select(Post).where((p) => p.author.eq(e.after.id)).count() })
 *   .if((s) => s.n.gt(100), NotifyPowerUser.call({ user: e.after.id }))
 * ```
 *
 * Bindings are OBJECTS (`.let({ n: … })`, `.for({ item: … }, body)`) — the var name is a real
 * property, so TypeScript rename/go-to-reference connects the declaration to every `s.n` usage.
 *
 * A block is a fragment like every builder (`toQuery()` / interpolation), typed by its `RETURN`
 * (`Frag<R>` — the `[T]` rule).
 */

import type { FieldRefBase } from "@schemic/core/query";
import { BoundQuery } from "surrealdb";
import type { ParamRef } from "../pure";
import {
  type Expr,
  type FieldRef,
  lowerExpr,
  mkRef,
  type Predicate,
  toExpr,
} from "./expr";
import { CountQuery, Select, type SelectOne } from "./index";
import {
  type Ctx,
  FRAGMENT,
  fragOf,
  mergeRaw,
  operandText,
  type RefKind,
  refState,
  stripOuterParens,
  toFragment,
} from "./render";

/** Does `text` contain a top-level `;` (outside strings/braces/parens)? Decides the canonical
 *  block form: single statement `{ stmt }`, multi `{ s1; s2; }` — matching INFO's printer. */
function hasTopLevelSemi(text: string): boolean {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === ";" && depth === 0) return true;
  }
  return false;
}

/** Anything that lowers to a composable fragment (builders, blocks, `Def.call(...)`). */
interface ToQuery {
  toQuery(): BoundQuery;
}

/** The app-value type a `LET` binds: builders unwrap to their result, typed fragments to their
 *  `[T]`, refs/`$param`s to their carried type; a literal is itself. */
export type ValueOf<X> = X extends CountQuery
  ? number
  : X extends SelectOne<infer R>
    ? R | undefined
    : // biome-ignore lint/suspicious/noExplicitAny: matching any table's builder.
      X extends Select<any, infer R>
      ? R[]
      : // biome-ignore lint/suspicious/noExplicitAny: matching any block.
        X extends Block<any, infer R>
        ? R
        : X extends BoundQuery<[infer T]>
          ? T
          : X extends ParamRef<infer T>
            ? T
            : X extends FieldRefBase<infer T>
              ? T
              : X;

/** The element type a `FOR` iterates. */
type ElemOf<X> =
  // biome-ignore lint/suspicious/noExplicitAny: matching any table's builder.
  X extends Select<any, infer R>
    ? R
    : X extends BoundQuery<[infer T]>
      ? T extends readonly (infer E)[]
        ? E
        : unknown
      : X extends ParamRef<infer T>
        ? T extends readonly (infer E)[]
          ? E
          : unknown
        : X extends FieldRefBase<infer T>
          ? T extends readonly (infer E)[]
            ? E
            : unknown
          : X extends readonly (infer E)[]
            ? E
            : unknown;

/** The typed refs a block callback receives: every `LET` var (and `FOR` loop var) as a
 *  `FieldRef` splicing `$name`. */
export type BlockRefs<V> = { readonly [K in keyof V]: FieldRef<V[K]> };

/** What an `IF`/`FOR` body accepts: a fragment, a builder/block, or a callback of the block's
 *  typed refs returning one. */
type Body<V> =
  | BoundQuery
  | ToQuery
  | ((s: BlockRefs<V>) => BoundQuery | ToQuery);

type VarMeta = { name: string; kind: RefKind; elem?: RefKind };

/** Runtime KIND of a `LET` value — picks the stdlib family its ref exposes. Builders/literals
 *  carry it; an untyped fragment is `other` (stdlib names on it throw with guidance). */
function kindOfValue(v: unknown): { kind: RefKind; elem?: RefKind } {
  const rs = refState(v);
  if (rs) return { kind: rs.kind, elem: rs.elem };
  if (v instanceof CountQuery) return { kind: "number" };
  if (v instanceof Select) return { kind: "array" };
  if (v instanceof Block) return v.out ?? { kind: "other" };
  if (typeof v === "string") return { kind: "string" };
  if (typeof v === "number") return { kind: "number" };
  if (v instanceof Date) return { kind: "date" };
  if (Array.isArray(v))
    return {
      kind: "array",
      elem: v.length ? kindOfValue(v[0]).kind : undefined,
    };
  return { kind: "other" };
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class Block<V extends Record<string, unknown>, R> {
  /** INTERNAL — start with {@link block}. */
  constructor(
    private readonly stmts: readonly ((ctx: Ctx) => string)[] = [],
    private readonly meta: readonly VarMeta[] = [],
    /** INTERNAL — the RETURN value's runtime kind (flows into `.let("x", thisBlock)` refs). */
    readonly out?: { kind: RefKind; elem?: RefKind },
  ) {}

  private refs(): BlockRefs<V> {
    const out: Record<string, unknown> = {};
    for (const m of this.meta)
      out[m.name] = mkRef({
        root: { text: `$${m.name}` },
        kind: m.kind,
        elem: m.elem,
      });
    return out as BlockRefs<V>;
  }

  private resolve<X>(v: X | ((s: BlockRefs<V>) => X)): X {
    return typeof v === "function"
      ? (v as (s: BlockRefs<V>) => X)(this.refs())
      : v;
  }

  private next<V2 extends Record<string, unknown>, R2>(
    stmt: (ctx: Ctx) => string,
    meta?: VarMeta,
    out?: { kind: RefKind; elem?: RefKind },
  ): Block<V2, R2> {
    return new Block<V2, R2>(
      [...this.stmts, stmt],
      meta ? [...this.meta, meta] : this.meta,
      out ?? this.out,
    );
  }

  /** Render a body as a braced `{ … }` block (a `block()`/`surql\`{ … }\`` passes through).
   *  Canonical form (matches INFO's printer): single statement `{ stmt }`, multi `{ s1; s2; }`. */
  private bodyText(v: Body<V>, ctx: Ctx): string {
    const resolved = this.resolve(v as never) as BoundQuery | ToQuery;
    const q =
      resolved instanceof BoundQuery
        ? resolved
        : (fragOf(resolved) ?? resolved.toQuery());
    const text = mergeRaw(q, ctx.vars).trim();
    if (text.startsWith("{")) return text;
    const bare = text.replace(/;\s*$/, "");
    return hasTopLevelSemi(bare) ? `{ ${bare}; }` : `{ ${bare} }`;
  }

  /** Validate a `$param` binding name (object key) — shared by `.let`/`.for`. */
  private static checkName(method: string, name: string): void {
    if (!VAR_NAME.test(name) || /^(?:b|r)\d+$/.test(name))
      throw new Error(
        `block().${method}(): "${name}" is not a usable $param name (identifier required; "b<n>"/"r<n>" are reserved for generated binds).`,
      );
  }

  /** `LET $<key> = <value>` per entry — the binding is an OBJECT (`.let({ n: … })`), so the var
   *  name is a real property: renaming `n` renames every `s.n` usage (refactor/go-to-reference
   *  safe). Each var joins the chain TYPED: later callbacks get `s.<key>` as a ref of the
   *  value's kind. Values: literals (bound), builders/blocks/fragments (spliced), or a callback
   *  of the vars so far (`.let((s) => ({ next: s.n.plus(1) }))`). Several keys emit several
   *  `LET`s in order; keys of the SAME call can't see each other — chain another `.let` for
   *  that. */
  let<O extends Record<string, unknown>>(
    vars: O | ((s: BlockRefs<V>) => O),
  ): Block<V & { [K in keyof O]: ValueOf<O[K]> }, R> {
    const resolved = this.resolve(vars as never) as Record<string, unknown>;
    const entries = Object.entries(resolved);
    if (!entries.length)
      throw new Error(
        "block().let() got an empty object — bind at least one var: .let({ name: value }).",
      );
    // biome-ignore lint/suspicious/noExplicitAny: accumulating across per-key next() steps.
    let out: Block<any, R> = this;
    for (const [name, v] of entries) {
      Block.checkName("let", name);
      const { kind, elem } = kindOfValue(v);
      out = out.next(
        (ctx) => `LET $${name} = ${stripOuterParens(operandText(v, ctx))}`,
        { name, kind, elem },
      );
    }
    return out as Block<V & { [K in keyof O]: ValueOf<O[K]> }, R>;
  }

  /** An arbitrary statement — a fragment, a builder, or a callback returning one
   *  (`.do((s) => SendEmail.call({ to: s.email }))`). */
  do(stmt: Body<V>): Block<V, R> {
    return this.next<V, R>((ctx) => {
      const resolved = this.resolve(stmt as never) as BoundQuery | ToQuery;
      const q =
        resolved instanceof BoundQuery
          ? resolved
          : (fragOf(resolved) ?? resolved.toQuery());
      return mergeRaw(q, ctx.vars).trim().replace(/;\s*$/, "");
    });
  }

  /** `IF <cond> { <then> } [ELSE { <else> }]` — cond is a predicate (`s.n.gt(100)`) or a
   *  `Frag<boolean>`; branches are fragments, builders, or nested `block()`s. */
  if(
    cond: Predicate | ((s: BlockRefs<V>) => Predicate),
    then: Body<V>,
    otherwise?: Body<V>,
  ): Block<V, R> {
    const c = toExpr(this.resolve(cond) as Predicate) as Expr;
    return this.next<V, R>((ctx) => {
      let sql = `IF ${stripOuterParens(lowerExpr(c, ctx))} ${this.bodyText(then, ctx)}`;
      if (otherwise !== undefined)
        sql += ` ELSE ${this.bodyText(otherwise, ctx)}`;
      return sql;
    });
  }

  /** `FOR $<key> IN <iterable> { <body> }` — the loop binding is a ONE-KEY object
   *  (`.for({ item: iterable }, (s) => …s.item…)`), same refactor-safe shape as `.let`; the
   *  loop var is typed to the iterable's element inside the body callback. */
  for<O extends Record<string, unknown>>(
    binding: O | ((s: BlockRefs<V>) => O),
    body:
      | BoundQuery
      | ToQuery
      | ((
          s: BlockRefs<V & { [K in keyof O]: ElemOf<O[K]> }>,
        ) => BoundQuery | ToQuery),
  ): Block<V, R> {
    const resolved = this.resolve(binding as never) as Record<string, unknown>;
    const entries = Object.entries(resolved);
    if (entries.length !== 1)
      throw new Error(
        `block().for() takes exactly ONE loop binding — .for({ item: iterable }, body); got ${entries.length} keys.`,
      );
    const [name, iter] = entries[0] as [string, unknown];
    Block.checkName("for", name);
    const { kind, elem } = kindOfValue(iter);
    const elemKind: RefKind = kind === "array" ? (elem ?? "other") : "other";
    // The body sees the loop var too — a one-off child block scope carries it.
    const inner = new Block<V & { [K in keyof O]: ElemOf<O[K]> }, never>(
      [],
      [...this.meta, { name, kind: elemKind }],
    );
    return this.next<V, R>(
      (ctx) =>
        `FOR $${name} IN ${operandText(iter, ctx)} ${inner.bodyText(body as Body<V & { [K in keyof O]: ElemOf<O[K]> }>, ctx)}`,
    );
  }

  /** `RETURN <value>` — types the whole block (`Frag<ValueOf<X>>`). */
  return<X>(value: X | ((s: BlockRefs<V>) => X)): Block<V, ValueOf<X>> {
    const v = this.resolve(value);
    return this.next<V, ValueOf<X>>(
      (ctx) => `RETURN ${stripOuterParens(operandText(v, ctx))}`,
      undefined,
      kindOfValue(v),
    );
  }

  /** `THROW <value>` — abort with an error (a plain string binds as a param). */
  throw(
    value: string | BoundQuery | ((s: BlockRefs<V>) => string | BoundQuery),
  ): Block<V, R> {
    const v = this.resolve(value);
    return this.next<V, R>(
      (ctx) => `THROW ${stripOuterParens(operandText(v, ctx))}`,
    );
  }

  /** Interpolate this block into a `surql` template / authoring slot. */
  [FRAGMENT](): BoundQuery {
    return this.toQuery();
  }

  /** This block as a composable fragment: `{ stmt; …; }` with namespaced binds, typed by the
   *  `RETURN` (`Frag<R>`). */
  toQuery(): BoundQuery<[R]> {
    const ctx: Ctx = { vars: {} };
    const texts = this.stmts.map((f) => f(ctx));
    const body =
      texts.length === 1 ? `{ ${texts[0]} }` : `{ ${texts.join("; ")}; }`;
    return toFragment(
      { sql: body, vars: ctx.vars },
      (sql) => sql,
    ) as BoundQuery<[R]>;
  }
}

/** Start a typed statement block — `block().let("n", …).if((s) => s.n.gt(100), …)`. */
// biome-ignore lint/complexity/noBannedTypes: {} is the honest "no vars yet" seed.
export function block(): Block<{}, never> {
  return new Block();
}
