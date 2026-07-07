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
import {
  and,
  type Expr,
  lowerExpr,
  type Predicate,
  type Row,
  refsFor,
  toExpr,
} from "./expr";
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

/** The typed ref for an EDGE record — its own fields (`amount`, `since`) plus `in`/`out`/`id`. */
export type EdgeRef<E extends AnyRelation> = Row<E>;

/** `.out` / `.in` / `.both` — hop along an edge to its target NODE(s). `.outEdges` / `.inEdges` /
 *  `.bothEdges` stop AT the edge records (for edge fields / edge filters), then `.node()` continues.
 *  Without a target arg the edge's declared endpoint type flows through (a polymorphic edge yields a
 *  union); pass a `TableDef` or array to narrow (`->edge->user` / `->edge->(user, agent)`). */
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
  outEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, OutNodes<E>>;
  inEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, InNodes<E>>;
  bothEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, BothNodes<E>>;
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
    /** @internal path up to (not including) the target position. */
    private readonly head: (ctx: Ctx) => string,
    /** @internal target table name(s) — rendered as `node` / `(a, b)` / `?` / `(node WHERE …)`. */
    private readonly tNames: string[],
    /** @internal the target `TableDef`(s) — for `.where`/`.return` refs. */
    private readonly targets: AnyTableDef[],
    /** @internal a target filter (`->E->(node WHERE …)`). */
    private readonly filter?: Expr,
    /** @internal a projection / `.*` appended after the target (`->…->node.{ … }`). */
    private readonly projSeg?: (ctx: Ctx) => string,
    /** @internal the row anchor (the query row itself) — contributes an empty path. */
    private readonly isRoot: boolean = false,
  ) {}

  /** The target position, filter folded in. */
  private targetSeg(ctx: Ctx): string {
    if (!this.filter) return renderTarget(this.tNames);
    const name =
      this.tNames.length === 1
        ? escapeIdent(this.tNames[0])
        : renderTarget(this.tNames);
    return `(${name} WHERE ${lowerExpr(this.filter, ctx)})`;
  }

  /** Path through the target node (no projection) — the base for chaining another hop. */
  private nodePath(ctx: Ctx): string {
    return this.isRoot ? "" : this.head(ctx) + this.targetSeg(ctx);
  }

  /** Full render: node path + any projection. */
  private full(ctx: Ctx): string {
    return this.nodePath(ctx) + (this.projSeg?.(ctx) ?? "");
  }

  private base(): (ctx: Ctx) => string {
    return (ctx) => this.nodePath(ctx);
  }

  out<E extends AnyRelation>(edge: E): NodeTraversal<OutNodes<E>>;
  out<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  out(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return makeNode(this.base(), "out", edge, target);
  }

  in<E extends AnyRelation>(edge: E): NodeTraversal<InNodes<E>>;
  in<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  in(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return makeNode(this.base(), "in", edge, target);
  }

  both<E extends AnyRelation>(edge: E): NodeTraversal<BothNodes<E>>;
  both<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the typed overloads.
  both(edge: AnyRelation, target?: TargetArg): NodeTraversal<any, any> {
    return makeNode(this.base(), "both", edge, target);
  }

  outEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, OutNodes<E>> {
    return makeEdge(this.base(), "out", edge) as EdgeTraversal<E, OutNodes<E>>;
  }
  inEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, InNodes<E>> {
    return makeEdge(this.base(), "in", edge) as EdgeTraversal<E, InNodes<E>>;
  }
  bothEdges<E extends AnyRelation>(edge: E): EdgeTraversal<E, BothNodes<E>> {
    return makeEdge(this.base(), "both", edge) as EdgeTraversal<
      E,
      BothNodes<E>
    >;
  }

  /** Filter the target node (`->E->(node WHERE …)`); successive calls AND together. */
  where(fn: (node: NodeRef<Cur>) => Predicate): NodeTraversal<Cur, Res> {
    const target = this.soleTarget("where");
    const nodeRef = attachGraphSteps(refsFor(target)) as NodeRef<Cur>;
    const pred = toExpr(fn(nodeRef));
    const combined = this.filter ? and(this.filter, pred) : pred;
    return new NodeTraversal(
      this.head,
      this.tNames,
      this.targets,
      combined,
      this.projSeg,
    );
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
    return new NodeTraversal(
      this.head,
      this.tNames,
      this.targets,
      this.filter,
      (ctx) => projectSegment(shape, ctx),
    );
  }

  /** Materialize the full target record (`->…->node.*`). */
  all(): NodeTraversal<Cur, App<Cur>[]> {
    return new NodeTraversal(
      this.head,
      this.tNames,
      this.targets,
      this.filter,
      () => ".*",
    );
  }

  /** The single target def — `.where`/`.return`/`.all` need exactly one (narrow a polymorphic edge). */
  private soleTarget(op: string): AnyTableDef {
    if (this.targets.length === 1) return this.targets[0];
    throw new Error(
      `.${op}() over a ${this.targets.length === 0 ? "target-less" : "polymorphic"} traversal isn't supported yet — narrow the target first, e.g. .out(Edge, TargetTable).`,
    );
  }

  /** @internal render the full path (used to splice a nested traversal into a projection). */
  renderPath(ctx: Ctx): string {
    return this.full(ctx);
  }

  /** Fragment hook: renders the path in a fresh pass, collecting any binds. */
  [FRAGMENT](): BoundQuery {
    const ctx: Ctx = { vars: {} };
    return new BoundQuery(this.full(ctx), ctx.vars);
  }

  /** Projection decode — passthrough (record ids / shaped rows arrive as the SDK's native values). */
  decode(raw: unknown): unknown {
    return raw;
  }
}

/** Build a node hop from a base path (`base->edge->target`). */
function makeNode(
  base: (ctx: Ctx) => string,
  dir: Dir,
  edge: AnyRelation,
  target?: TargetArg,
  // biome-ignore lint/suspicious/noExplicitAny: shape-agnostic; callers narrow via overloads.
): NodeTraversal<any, any> {
  const [a1, a2] = ARROWS[dir];
  const head = (ctx: Ctx) => `${base(ctx)}${a1}${escapeIdent(edge.name)}${a2}`;
  const names =
    target !== undefined ? targetNames(target) : endpointNames(edge, dir);
  return new NodeTraversal(head, names, endpointDefs(edge, dir, target));
}

/** The record ids of a BARE edge traversal (no `.return`). */
export type EdgeIds<E extends AnyRelation> =
  App<E> extends { id: infer I } ? I[] : unknown[];

/** Build an edge step from a base path (`base->edge`) — used by the row anchor and NodeTraversal. */
function makeEdge(
  base: (ctx: Ctx) => string,
  dir: Dir,
  edge: AnyRelation,
  // biome-ignore lint/suspicious/noExplicitAny: shape-agnostic edge step; callers narrow.
): EdgeTraversal<any, AnyTableDef> {
  return new EdgeTraversal(base, dir, edge, undefined, undefined);
}

/**
 * An EDGE traversal — `->edge` (the edge records themselves). `.where(e => …)` filters them
 * (`->(edge WHERE …)`), `.node()` continues to the target node (`->edge->node`), and `.return`/`.all`
 * project the edge's own fields (`->edge.since` / `->edge.{ … }`). A `FRAGMENT`, like NodeTraversal.
 */
export class EdgeTraversal<
  E extends AnyRelation,
  NodeSide extends AnyTableDef,
  Res = EdgeIds<E>,
> {
  declare readonly _edge: E;
  declare readonly _side: NodeSide;
  declare readonly _res: Res;

  constructor(
    private readonly prev: (ctx: Ctx) => string,
    private readonly dir: Dir,
    private readonly edge: AnyRelation,
    /** @internal accumulated edge filter (`->(edge WHERE …)`). */
    private readonly filter: Expr | undefined,
    /** @internal an edge-field projection segment appended after the edge (`.since` / `.{ … }`). */
    private readonly projSeg: ((ctx: Ctx) => string) | undefined,
  ) {}

  /** `->edge` or `->(edge WHERE …)` — the edge segment, filter folded in. */
  private edgeSeg(ctx: Ctx): string {
    const a1 = ARROWS[this.dir][0];
    const name = escapeIdent(this.edge.name);
    return this.filter
      ? `${a1}(${name} WHERE ${lowerExpr(this.filter, ctx)})`
      : `${a1}${name}`;
  }

  /** prefix + edge segment, WITHOUT the edge-field projection (the `.node()` bridge point). */
  private renderEdge(ctx: Ctx): string {
    return this.prev(ctx) + this.edgeSeg(ctx);
  }

  private edgeRef(): EdgeRef<E> {
    return refsFor(this.edge) as EdgeRef<E>;
  }

  /** Filter the edge records (`->(edge WHERE …)`); successive calls AND together. */
  where(fn: (edge: EdgeRef<E>) => Predicate): EdgeTraversal<E, NodeSide, Res> {
    const pred = toExpr(fn(this.edgeRef()));
    const combined = this.filter ? and(this.filter, pred) : pred;
    return new EdgeTraversal(
      this.prev,
      this.dir,
      this.edge,
      combined,
      undefined,
    );
  }

  /** Continue to the target node(s) (`->edge->node`). A target arg narrows (`->edge->user`). */
  node(): NodeTraversal<NodeSide>;
  node<T extends TargetArg>(target: T): NodeTraversal<NarrowTo<T>>;
  // biome-ignore lint/suspicious/noExplicitAny: overload impl signature; callers see the overloads.
  node(target?: TargetArg): NodeTraversal<any, any> {
    const a2 = ARROWS[this.dir][1];
    const names =
      target !== undefined
        ? targetNames(target)
        : endpointNames(this.edge, this.dir);
    const head = (ctx: Ctx) => `${this.renderEdge(ctx)}${a2}`;
    return new NodeTraversal(
      head,
      names,
      endpointDefs(this.edge, this.dir, target),
    );
  }

  /** Project the edge's own fields — flat (`->edge.since`) or a destructure (`->edge.{ since, out }`). */
  return<P extends Record<string, ProjectionValue>>(
    fn: (edge: EdgeRef<E>) => P,
  ): EdgeTraversal<E, NodeSide, Projected<P>[]>;
  return<V extends ProjectionValue>(
    fn: (edge: EdgeRef<E>) => V,
  ): EdgeTraversal<E, NodeSide, FlatResult<V>>;
  return(
    fn: (edge: EdgeRef<E>) => unknown,
  ): EdgeTraversal<E, NodeSide, unknown> {
    const shape = fn(this.edgeRef());
    return new EdgeTraversal(
      this.prev,
      this.dir,
      this.edge,
      this.filter,
      (ctx) => projectSegment(shape, ctx),
    );
  }

  /** Materialize the full edge record (`->edge.*`). */
  all(): EdgeTraversal<E, NodeSide, App<E>[]> {
    return new EdgeTraversal(
      this.prev,
      this.dir,
      this.edge,
      this.filter,
      () => ".*",
    );
  }

  /** Fragment hook: prefix + edge + any edge-field projection. */
  [FRAGMENT](): BoundQuery {
    const ctx: Ctx = { vars: {} };
    const text = this.renderEdge(ctx) + (this.projSeg?.(ctx) ?? "");
    return new BoundQuery(text, ctx.vars);
  }

  /** Projection decode — passthrough. */
  decode(raw: unknown): unknown {
    return raw;
  }
}

/** Is this value a NODE traversal? (projection/where dispatch). */
export function isTraversal(v: unknown): v is NodeTraversal<AnyTableDef> {
  return v instanceof NodeTraversal;
}

/** Is this value an EDGE traversal? */
// biome-ignore lint/suspicious/noExplicitAny: shape-agnostic guard.
export function isEdgeTraversal(
  v: unknown,
): v is EdgeTraversal<any, AnyTableDef> {
  return v instanceof EdgeTraversal;
}

/** Augment a table's row refs with the graph steps, anchored at the row (empty path prefix). */
export function attachGraphSteps<TD extends AnyTableDef>(
  row: Row<TD>,
): NodeRef<TD> {
  const anchor = new NodeTraversal<TD>(
    () => "",
    [],
    [],
    undefined,
    undefined,
    true,
  );
  return Object.assign(row as object, {
    out: anchor.out.bind(anchor),
    in: anchor.in.bind(anchor),
    both: anchor.both.bind(anchor),
    outEdges: anchor.outEdges.bind(anchor),
    inEdges: anchor.inEdges.bind(anchor),
    bothEdges: anchor.bothEdges.bind(anchor),
  }) as NodeRef<TD>;
}
