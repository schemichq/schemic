/**
 * INTERNAL lowering primitives shared by the query builder (`./index`), the stdlib catalog
 * (`../fn`), and `block()` (`./block`) — deferred field-ref rendering (row-token-aware
 * `$parent`), operand/argument lowering, and fragment bind merging. Side-effect-free and
 * dependency-light on purpose: the authoring index may import through here (via `../fn`)
 * without dragging the builder in. Nothing here is package-public.
 */

import { BoundQuery, escapeIdent } from "surrealdb";
import { isParamRef } from "../pure";

// --- lowering context ----------------------------------------------------------------------------

/** A lowering pass: the bind map being assembled, plus the row token of the CURRENT row scope.
 *  A field ref from a DIFFERENT row scope renders as `$parent.<col>` (correlated subquery); with
 *  no current scope (`row` undefined — tag splices, block statements) every ref renders bare. */
export interface Ctx {
  readonly vars: Record<string, unknown>;
  readonly row?: symbol;
}

// --- the deferred ref state ----------------------------------------------------------------------

/** The value KIND a ref carries at runtime — picks which stdlib method family is callable
 *  (`string::len` vs `array::len` under one `.length()`). `other` = kind unknown/uncovered. */
export type RefKind = "string" | "number" | "array" | "date" | "other";

/**
 * What a field ref defers until lowering: its base (a COLUMN of some row scope, or pre-rendered
 * TEXT like a block's `$var`), plus an optional composed decoration added by derived stdlib
 * methods (`.length()` wraps the base in `string::len(…)`). The base renders row-token-aware —
 * that ONE mechanism gives both derived expressions and `$parent` detection.
 */
export interface RefState {
  readonly root:
    | { readonly col: string; readonly row?: symbol }
    | { readonly text: string };
  readonly wrap?: (inner: string, ctx: Ctx) => string;
  readonly kind: RefKind;
  /** For `array` kind: the ELEMENT kind (so `.at(0)`/`.first()` chain with the right family). */
  readonly elem?: RefKind;
  /** When the outermost decoration is an ARITHMETIC operator: its precedence. Drives minimal
   *  parenthesization — SurrealDB's printer strips redundant parens, so emitting them would
   *  phantom-diff DDL round-trips; parens appear only where precedence requires them. */
  readonly opPrec?: number;
}

/** The ref-state brand (`Symbol.for` — survives package-split dual instances). */
export const REF_STATE: unique symbol = Symbol.for(
  "schemic.surrealdb.refstate",
) as never;

/** Read a value's ref state (undefined if it isn't a field ref). */
export function refState(v: unknown): RefState | undefined {
  return (v as Record<symbol, RefState> | null)?.[REF_STATE];
}

/** Render a ref in a lowering context: the base column escapes (and swaps to `$parent.<col>`
 *  when its row token differs from the context's), then derived decorations apply outward. */
export function renderRef(s: RefState, ctx: Ctx): string {
  let base: string;
  if ("col" in s.root) {
    const col = s.root.col
      .split(".")
      .map((p) => escapeIdent(p))
      .join(".");
    base =
      s.root.row !== undefined &&
      ctx.row !== undefined &&
      s.root.row !== ctx.row
        ? `$parent.${col}`
        : col;
  } else {
    base = s.root.text;
  }
  return s.wrap ? s.wrap(base, ctx) : base;
}

// --- fragments -----------------------------------------------------------------------------------

/** The fragment brand the `surql` tag reads (`Symbol.for` -> shared without importing this
 *  module): a value carrying it interpolates as its lowered `(subquery)` with bindings merged. */
export const FRAGMENT: unique symbol = Symbol.for(
  "schemic.surrealdb.fragment",
) as never;

/** Coerce a fragment-able value to its `BoundQuery` (a `BoundQuery` passes through; a builder /
 *  block via its `FRAGMENT` hook). Undefined if it's neither. */
export function fragOf(v: unknown): BoundQuery | undefined {
  if (v instanceof BoundQuery) return v;
  const make = (v as Record<symbol, unknown> | null)?.[FRAGMENT];
  return typeof make === "function" ? (make.call(v) as BoundQuery) : undefined;
}

let subCounter = 0;
/** Lower a builder to an interpolatable fragment: parenthesize the sql and NAMESPACE its binds
 *  (`$b0` -> `$sub__<n>_b0`, boundary-aware) so several builder fragments compose in one template
 *  without colliding (the SDK throws on duplicate bind names rather than renaming). */
export function toFragment(
  lowered: { sql: string; vars: Record<string, unknown> },
  wrap = (sql: string) => `(${sql})`,
): BoundQuery {
  const prefix = `sub__${++subCounter}_`;
  let text = lowered.sql;
  const binds: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(lowered.vars)) {
    text = text.replace(
      new RegExp(`\\$${name}(?![A-Za-z0-9_])`, "g"),
      `$${prefix}${name}`,
    );
    binds[`${prefix}${name}`] = value;
  }
  return new BoundQuery(wrap(text), binds);
}

/** Merge a raw fragment's bindings into the pass's vars, renaming on collision (boundary-aware
 *  rewrite in the fragment text — `$b1` must not touch `$b10`). SDK-tagged fragments use globally
 *  countered names, so renames only fire for hand-built BoundQuery bindings. */
export function mergeRaw(q: BoundQuery, vars: Record<string, unknown>): string {
  let text = q.query;
  for (const [name, value] of Object.entries(q.bindings ?? {})) {
    let use = name;
    if (use in vars) {
      let n = 2;
      while (`${name}_${n}` in vars) n++;
      use = `${name}_${n}`;
      text = text.replace(
        new RegExp(`\\$${name}(?![A-Za-z0-9_])`, "g"),
        `$${use}`,
      );
    }
    vars[use] = value;
  }
  return text;
}

// --- operand / argument lowering -----------------------------------------------------------------

/** Render an operand in a lowering pass: a `$param` ref splices as text, a field ref renders
 *  token-aware, a fragment splices with bindings merged (builders self-parenthesize; a raw
 *  `BoundQuery` gets parens), anything else BINDS as a fresh `$b<n>` param. */
export function operandText(v: unknown, ctx: Ctx): string {
  if (isParamRef(v)) return v.toText();
  const rs = refState(v);
  if (rs) return renderRef(rs, ctx);
  if (v instanceof BoundQuery) return `(${mergeRaw(v, ctx.vars)})`;
  const frag = fragOf(v);
  if (frag) return mergeRaw(frag, ctx.vars);
  const bind = `b${Object.keys(ctx.vars).length}`;
  ctx.vars[bind] = v;
  return `$${bind}`;
}

/** Value-position statements that must KEEP their parens (a bare subquery in `LET`/`RETURN`
 *  requires them; SurrealDB's printer keeps them too). */
const KEEP_PARENS =
  /^(SELECT|CREATE|UPDATE|DELETE|INSERT|RELATE|UPSERT|DEFINE|IF|FOR|RETURN)\b/i;

/**
 * Strip a redundant WHOLE-EXPRESSION paren wrap (quote-aware) — for VALUE positions
 * (`LET $x = …` / `RETURN …` / `IF <cond>`), where SurrealDB's canonical printer strips them
 * and keeping ours would phantom-diff DDL round-trips. Subquery parens stay (required syntax).
 */
export function stripOuterParens(text: string): string {
  let t = text.trim();
  while (t.startsWith("(") && t.endsWith(")")) {
    let depth = 0;
    let quote: '"' | "'" | null = null;
    let whole = true;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i] as string;
      if (quote) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0 && i < t.length - 1) {
          whole = false;
          break;
        }
      }
    }
    if (!whole) break;
    const inner = t.slice(1, -1).trim();
    if (KEEP_PARENS.test(inner)) break;
    t = inner;
  }
  return t;
}

let argCounter = 0;
/**
 * Capture a derived-method / catalog-call ARGUMENT for deferred rendering. Refs and `$param`
 * refs stay deferred (so an outer-row ref inside `.replace(other, …)` still `$parent`-detects at
 * lowering); a literal binds under a globally-unique `$r<n>` name captured NOW (stable across
 * however many passes render the ref).
 */
export function argRenderer(v: unknown): (ctx: Ctx) => string {
  if (isParamRef(v)) return () => v.toText();
  const rs = refState(v);
  if (rs) return (ctx) => renderRef(rs, ctx);
  if (v instanceof BoundQuery) return (ctx) => `(${mergeRaw(v, ctx.vars)})`;
  const frag = (v as Record<symbol, unknown> | null)?.[FRAGMENT];
  if (typeof frag === "function")
    return (ctx) => mergeRaw(frag.call(v) as BoundQuery, ctx.vars);
  const name = `r${++argCounter}`;
  return (ctx) => {
    ctx.vars[name] = v;
    return `$${name}`;
  };
}
