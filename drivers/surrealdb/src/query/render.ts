/**
 * INTERNAL lowering primitives shared by the query builder (`./index`), the stdlib catalog
 * (`../fn`), and `block()` (`./block`) — deferred field-ref rendering (row-token-aware
 * `$parent`), operand/argument lowering, and fragment bind merging. Side-effect-free and
 * dependency-light on purpose: the authoring index may import through here (via `../fn`)
 * without dragging the builder in. Nothing here is package-public.
 */

import { BoundQuery } from "surrealdb";
import {
  type Ctx,
  FRAGMENT,
  hasRefDeep,
  isParamRef,
  mergeRaw,
  paramDefName,
  refState,
  rejectDefValue,
  renderData,
  renderRef,
} from "../pure";

// The lowering PRIMITIVES live in ../pure (the authoring base needs them — e.g.
// `RecordIdField.for([e.after.id])` renders a fragment); re-exported here so the query layer
// keeps one import site.
export {
  type Ctx,
  FRAGMENT,
  fragOf,
  hasRefDeep,
  mergeRaw,
  operandText,
  REF_STATE,
  type RefKind,
  type RefState,
  refState,
  renderData,
  renderRef,
} from "../pure";

// --- fragments -----------------------------------------------------------------------------------

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

// --- operand / argument lowering -----------------------------------------------------------------

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
  if (hasRefDeep(v)) return (ctx) => renderData(v, ctx);
  const param = paramDefName(v);
  if (param !== undefined) return () => `$${param}`;
  rejectDefValue(v);
  const name = `r${++argCounter}`;
  return (ctx) => {
    ctx.vars[name] = v;
    return `$${name}`;
  };
}
