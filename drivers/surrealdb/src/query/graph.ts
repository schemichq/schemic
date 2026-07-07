// Graph traversal for the SurrealDB query builder — the typed `->edge->node` surface.
//
// The atomic unit is `->edge->node` (bare `->edge->` is a parse error in SurrealQL). `.out(E)` /
// `.in(E)` / `.both(E)` emit that unit and carry the TARGET node's TableDef type forward, read from
// the endpoint types captured on `RelationDef` (`.from(X)/.to(Y)`). `.return(node => …)` projects the
// target's fields (flat `->…->node.name`, or a `.{…}` destructure with aliasing/computed/nested). A
// traversal is a `FRAGMENT`, so it drops into `.return({...})` and `surql` templates like a subquery.
// Empirical grammar backing every form: `docs/graph-syntax-map.md`.

import type { FieldRefBase } from "@schemic/core/query";
import { BoundQuery, escapeIdent } from "surrealdb";
import {
  type App,
  type Ctx,
  FRAGMENT,
  fragOf,
  mergeRaw,
  type RelationDef,
  refState,
  renderRef,
  type TableDef,
} from "../pure";
import { type Row, refsFor } from "./expr";
import type { Projected, ProjectionValue } from "./index";

// biome-ignore lint/suspicious/noExplicitAny: shape-agnostic node reference.
type AnyTableDef = TableDef<string, any>;
// biome-ignore lint/suspicious/noExplicitAny: shape-agnostic relation (endpoints via type params).
type AnyRelation = RelationDef<string, any, string, string, any, any>;
/** A target-narrowing argument: one node def, or an array (`->edge->(a, b)`). */
type TargetArg = AnyTableDef | readonly AnyTableDef[];

// --- endpoint type extraction ---------------------------------------------------------------------

/** The `TableDef` union a captured `.from()/.to()` ref carries — bare-name endpoints drop to `never`
 *  (they opted out of the type link, so the traversal target is untyped). */
type DefsOf<Ref> = Ref extends readonly (infer E)[]
  ? Extract<E, AnyTableDef>
  : Extract<Ref, AnyTableDef>;

type ToRefOf<E> =
  E extends RelationDef<
    infer _N,
    infer _S,
    infer _In,
    infer _Out,
    infer _From,
    infer T
  >
    ? T
    : never;
type FromRefOf<E> =
  E extends RelationDef<
    infer _N,
    infer _S,
    infer _In,
    infer _Out,
    infer F,
    infer _To
  >
    ? F
    : never;

/** Node def(s) reached by each direction. `.out` lands on the edge's `to`; `.in` on its `from`. */
type OutNodes<E> = DefsOf<ToRefOf<E>>;
type InNodes<E> = DefsOf<FromRefOf<E>>;
type BothNodes<E> = OutNodes<E> | InNodes<E>;
/** The node def(s) a narrowing target argument selects. */
type NarrowTo<T> = T extends readonly (infer E)[]
  ? Extract<E, AnyTableDef>
  : Extract<T, AnyTableDef>;

/** The projected value of a BARE traversal (no `.return`): the target nodes' record ids. */
export type TraversalIds<Cur extends AnyTableDef> =
  App<Cur> extends { id: infer I } ? I[] : unknown[];

/** The result of a FLAT `.return(node => value)`: a nested traversal keeps its own result; a field
 *  ref becomes an array of that field's values. */
type FlatResult<V> =
  // biome-ignore lint/suspicious/noExplicitAny: matching any node/result traversal.
  V extends NodeTraversal<any, infer R>
    ? R
    : V extends FieldRefBase<infer T>
      ? T[]
      : unknown[];

// --- the step surface (shared by the row ref and every NodeTraversal) -----------------------------

/** `.out` / `.in` / `.both` — hop along an edge to its target node(s). Without a target arg the
 *  edge's declared endpoint type flows through (a polymorphic edge yields a union); pass a `TableDef`
 *  or array to narrow (`->edge->user` / `->edge->(user, agent)`). */
export interface GraphSteps {
  out<E extends AnyRelation>(edge: E): NodeTraversal<OutNodes<E>>;
  out<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  in<E extends AnyRelation>(edge: E): NodeTraversal<InNodes<E>>;
  in<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  both<E extends AnyRelation>(edge: E): NodeTraversal<BothNodes<E>>;
  both<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
}

/** True only for the `any` type — used to keep the widened `NodeRef<any>` from imposing `Row<any>`'s
 *  string-index signature (which the graph-step methods would violate, breaking `Select<any, any>`). */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** The row handed to `.where`/`.return`/`.orderBy` callbacks: the table's field refs PLUS the graph
 *  steps, so `u.name` (a column) and `u.out(Owns)` (a traversal) coexist. At `TD = any` (the widened
 *  `Select<any, any>`) it collapses to `any` so the concrete row stays structurally assignable. */
export type NodeRef<TD extends AnyTableDef> =
  IsAny<TD> extends true
    ? // biome-ignore lint/suspicious/noExplicitAny: widened row is fully permissive by design.
      any
    : Row<TD> & GraphSteps;

// --- runtime --------------------------------------------------------------------------------------

const ARROWS = {
  out: ["->", "->"],
  in: ["<-", "<-"],
  both: ["<->", "<->"],
} as const;
type Dir = keyof typeof ARROWS;

/** Endpoint table names for a direction, read from the relation's runtime config. */
function endpointNames(edge: AnyRelation, dir: Dir): string[] {
  const rel = (edge.config as { relation?: { from?: string[]; to?: string[] } })
    .relation;
  if (dir === "out") return rel?.to ?? [];
  if (dir === "in") return rel?.from ?? [];
  return [...new Set([...(rel?.from ?? []), ...(rel?.to ?? [])])];
}

/** Endpoint `TableDef`s a step lands on — for `.return` to build the target's field refs. */
function endpointDefs(
  edge: AnyRelation,
  dir: Dir,
  target?: TargetArg,
): AnyTableDef[] {
  if (target !== undefined)
    return (Array.isArray(target) ? target : [target]) as AnyTableDef[];
  if (dir === "both")
    return [...edge.endpointDefs("from"), ...edge.endpointDefs("to")];
  return edge.endpointDefs(dir === "in" ? "from" : "to");
}

function targetNames(target: TargetArg): string[] {
  return (Array.isArray(target) ? target : [target]).map(
    (t: AnyTableDef) => t.name,
  );
}

/** Render the target node position: `product` (one) · `(a, b)` (union) · `?` (unconstrained). */
function renderTarget(names: string[]): string {
  if (names.length === 0) return "?";
  if (names.length === 1) return escapeIdent(names[0]);
  return `(${names.map(escapeIdent).join(", ")})`;
}

/** Escape a (possibly dotted) column path — `meta.author` -> `meta.author`. */
function escapeCol(col: string): string {
  return col.split(".").map(escapeIdent).join(".");
}

/** Lower one destructure entry (`{ key: value }`) to `key` (shorthand), `key: col`, or `key: <expr>`. */
function renderEntry(key: string, value: unknown, ctx: Ctx): string {
  const rs = refState(value);
  if (rs) {
    if (!rs.wrap && "col" in rs.root)
      return rs.root.col === key
        ? escapeIdent(key)
        : `${escapeIdent(key)}: ${escapeCol(rs.root.col)}`;
    return `${escapeIdent(key)}: ${renderRef(rs, ctx)}`;
  }
  if (isTraversal(value))
    return `${escapeIdent(key)}: ${value.renderPath(ctx)}`;
  const frag = fragOf(value);
  if (frag) return `${escapeIdent(key)}: ${mergeRaw(frag, ctx.vars)}`;
  throw new Error(
    `.return(): "${key}" is not a projectable value — pass a field ref, a nested traversal, a derived expression, or a fragment.`,
  );
}

/** Lower a `.return` projection to the segment appended to the traversal path: a flat field
 *  (`.name`), a nested traversal (`->…`), or a destructure (`.{ … }`). */
function projectSegment(shape: unknown, ctx: Ctx): string {
  const rs = refState(shape);
  if (rs) {
    if (rs.wrap || !("col" in rs.root))
      throw new Error(
        ".return(): a single derived/computed value needs an object with a key — .return(p => ({ x: <expr> })).",
      );
    return `.${escapeCol(rs.root.col)}`;
  }
  if (isTraversal(shape)) return shape.renderPath(ctx);
  if (shape && typeof shape === "object") {
    const entries = Object.entries(shape as Record<string, unknown>).map(
      ([k, v]) => renderEntry(k, v, ctx),
    );
    return `.{ ${entries.join(", ")} }`;
  }
  throw new Error(
    ".return(): expected a field ref, a nested traversal, or an object of them.",
  );
}

/**
 * A graph traversal expression — one or more `->edge->node` hops from an anchor (the query row).
 * Chainable (`u.out(A).out(B)`), and a `FRAGMENT` so it projects/interpolates like a subquery. Bare,
 * it yields the target nodes' record ids; `.return(node => …)` reshapes to a projection, `.all()` to
 * the full record (`.*`).
 */
export class NodeTraversal<Cur extends AnyTableDef, Res = TraversalIds<Cur>> {
  /** Phantom: carries the current node type + result so projection inference can read them
   *  (`NodeTraversal<infer C, infer R>` in `ProjectedValue`). Type-only — never present at runtime. */
  declare readonly _node: Cur;
  declare readonly _res: Res;

  constructor(
    /** @internal renders the accumulated path in a lowering pass (binds go into `ctx.vars`). */
    private readonly renderFn: (ctx: Ctx) => string,
    /** @internal the target `TableDef`(s) this traversal lands on — for `.return` refs. */
    private readonly targets: AnyTableDef[],
  ) {}

  private step(
    dir: Dir,
    edge: AnyRelation,
    target?: TargetArg,
  ): NodeTraversal<AnyTableDef> {
    const [a1, a2] = ARROWS[dir];
    const names =
      target !== undefined ? targetNames(target) : endpointNames(edge, dir);
    const seg = `${a1}${escapeIdent(edge.name)}${a2}${renderTarget(names)}`;
    const prev = this.renderFn;
    return new NodeTraversal(
      (ctx) => prev(ctx) + seg,
      endpointDefs(edge, dir, target),
    );
  }

  out<E extends AnyRelation>(edge: E): NodeTraversal<OutNodes<E>>;
  out<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  out(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return this.step("out", edge, target);
  }

  in<E extends AnyRelation>(edge: E): NodeTraversal<InNodes<E>>;
  in<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  in(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return this.step("in", edge, target);
  }

  both<E extends AnyRelation>(edge: E): NodeTraversal<BothNodes<E>>;
  both<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  both(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return this.step("both", edge, target);
  }

  /** Project the target node's fields — flat (`.return(p => p.name)` -> `->…->node.name`) or a
   *  destructure (`.return(p => ({ title: p.name, treats: p.out(Treats).return(c => c.name) }))`). */
  return<P extends Record<string, ProjectionValue>>(
    fn: (node: NodeRef<Cur>) => P,
  ): NodeTraversal<Cur, Projected<P>[]>;
  return<V extends ProjectionValue>(
    fn: (node: NodeRef<Cur>) => V,
  ): NodeTraversal<Cur, FlatResult<V>>;
  return(fn: (node: NodeRef<Cur>) => unknown): NodeTraversal<Cur, unknown> {
    const target = this.soleTarget("project");
    const nodeRef = attachGraphSteps(refsFor(target)) as NodeRef<Cur>;
    const shape = fn(nodeRef);
    const prev = this.renderFn;
    return new NodeTraversal(
      (ctx) => prev(ctx) + projectSegment(shape, ctx),
      this.targets,
    );
  }

  /** Materialize the full target record (`->…->node.*`). */
  all(): NodeTraversal<Cur, App<Cur>[]> {
    const prev = this.renderFn;
    return new NodeTraversal((ctx) => `${prev(ctx)}.*`, this.targets);
  }

  /** The single target def — `.return`/`.all` need exactly one (narrow a polymorphic edge first). */
  private soleTarget(op: string): AnyTableDef {
    if (this.targets.length === 1) return this.targets[0];
    throw new Error(
      `.${op}() over a ${this.targets.length === 0 ? "target-less" : "polymorphic"} traversal isn't supported yet — narrow the target first, e.g. .out(Edge, TargetTable).`,
    );
  }

  /** @internal render the accumulated path (used to splice a nested traversal into a projection). */
  renderPath(ctx: Ctx): string {
    return this.renderFn(ctx);
  }

  /** Fragment hook: renders the path in a fresh pass, collecting any binds. */
  [FRAGMENT](): BoundQuery {
    const ctx: Ctx = { vars: {} };
    return new BoundQuery(this.renderFn(ctx), ctx.vars);
  }

  /** Projection decode — passthrough (record ids / shaped rows arrive as the SDK's native values). */
  decode(raw: unknown): unknown {
    return raw;
  }
}

/** Is this value a graph traversal? (projection/where dispatch). */
export function isTraversal(v: unknown): v is NodeTraversal<AnyTableDef> {
  return v instanceof NodeTraversal;
}

/** Augment a table's row refs with the graph steps, anchored at the row (empty path prefix). */
export function attachGraphSteps<TD extends AnyTableDef>(
  row: Row<TD>,
): NodeRef<TD> {
  const anchor = new NodeTraversal<TD>(() => "", []);
  return Object.assign(row as object, {
    out: anchor.out.bind(anchor),
    in: anchor.in.bind(anchor),
    both: anchor.both.bind(anchor),
  }) as NodeRef<TD>;
}
