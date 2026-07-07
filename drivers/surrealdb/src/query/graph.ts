// Graph traversal for the SurrealDB query builder — the typed `->edge->node` surface.
//
// The atomic unit is `->edge->node` (bare `->edge->` is a parse error in SurrealQL). `.out(E)` /
// `.in(E)` / `.both(E)` emit that unit and carry the TARGET node's TableDef type forward, read from
// the endpoint types captured on `RelationDef` (`.from(X)/.to(Y)`). A traversal is a `FRAGMENT`, so it
// drops into `.return({...})` projections, `surql` templates, and (later) WHERE — like a nested
// subquery. Empirical grammar backing every form: `docs/graph-syntax-map.md`.

import { BoundQuery, escapeIdent } from "surrealdb";
import { type App, FRAGMENT, type RelationDef, type TableDef } from "../pure";
import type { Row } from "./expr";

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

/** Endpoint table names for a direction, read from the relation's runtime config. */
function endpointNames(edge: AnyRelation, dir: keyof typeof ARROWS): string[] {
  const rel = (edge.config as { relation?: { from?: string[]; to?: string[] } })
    .relation;
  if (dir === "out") return rel?.to ?? [];
  if (dir === "in") return rel?.from ?? [];
  return [...new Set([...(rel?.from ?? []), ...(rel?.to ?? [])])];
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

function step(
  prefix: string,
  dir: keyof typeof ARROWS,
  edge: AnyRelation,
  target?: TargetArg,
): NodeTraversal<AnyTableDef> {
  const [a1, a2] = ARROWS[dir];
  const names =
    target !== undefined ? targetNames(target) : endpointNames(edge, dir);
  return new NodeTraversal(
    `${prefix}${a1}${escapeIdent(edge.name)}${a2}${renderTarget(names)}`,
  );
}

/**
 * A graph traversal expression — one or more `->edge->node` hops from an anchor (the query row).
 * Chainable (`u.out(A).out(B)`), and a `FRAGMENT` so it projects/interpolates like a subquery. Bare,
 * it yields the target nodes' record ids; `.return(...)` (a later step) reshapes to a projection.
 */
export class NodeTraversal<Cur extends AnyTableDef> {
  /** Phantom: carries the current node type so projection inference can read it
   *  (`NodeTraversal<infer C>` in `ProjectedValue`). Type-only — never present at runtime. */
  declare readonly _node: Cur;
  /** @internal the accumulated SurQL path (`->owns->product->made_by->brand`), anchor-relative. */
  constructor(private readonly path: string) {}

  out<E extends AnyRelation>(edge: E): NodeTraversal<OutNodes<E>>;
  out<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  out(edge: AnyRelation, target?: TargetArg): NodeTraversal<AnyTableDef> {
    return step(this.path, "out", edge, target);
  }

  in<E extends AnyRelation>(edge: E): NodeTraversal<InNodes<E>>;
  in<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  in(edge: AnyRelation, target?: TargetArg): NodeTraversal<AnyTableDef> {
    return step(this.path, "in", edge, target);
  }

  both<E extends AnyRelation>(edge: E): NodeTraversal<BothNodes<E>>;
  both<E extends AnyRelation, T extends TargetArg>(
    edge: E,
    target: T,
  ): NodeTraversal<NarrowTo<T>>;
  both(edge: AnyRelation, target?: TargetArg): NodeTraversal<AnyTableDef> {
    return step(this.path, "both", edge, target);
  }

  /** Fragment hook: the bare path splices as-is (no binds yet — filters add them later). */
  [FRAGMENT](): BoundQuery {
    return new BoundQuery(this.path, {});
  }

  /** Projection decode for a bare traversal — record ids pass through untouched. */
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
  const anchor = new NodeTraversal<TD>("");
  return Object.assign(row as object, {
    out: anchor.out.bind(anchor),
    in: anchor.in.bind(anchor),
    both: anchor.both.bind(anchor),
  }) as NodeRef<TD>;
}
