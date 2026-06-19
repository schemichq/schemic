// The KIND REGISTRY — core-v2's generic, open replacement for the fixed object-kind slots.
//
// Today `PortableDb` hard-codes the object kinds a schema may contain (`tables`/`functions`/
// `accesses`/`natives`) and the Driver's whole-DB methods switch on those slots. The kind registry
// turns the slots into a REGISTRY a driver populates: each driver registers KINDS, and every kind
// brings (a) its OWN authoring builder — any shape/chain it likes, fully typed — and (b) its engine
// behavior (`lower`/`emit`/`remove`/`overwrite`/`deps`/`owner`/`introspect`) over THAT kind's objects.
// Core orchestrates generically over the registry (see ./plan.ts) and never names a kind.
//
// What stays in core is the field/type VOCABULARY (`SFieldBase`, the Zod-drop-in `s.*`, `PortableType`,
// codecs) — the substrate every kind builds on. Fields/types are NOT a kind: a table HAS fields, a
// function's args ARE fields, an index REFERENCES fields. See docs/kind-registry.md.
//
// The registry is PER-DRIVER, not a module global: multiple drivers (`@schemic/surrealdb`,
// `@schemic/postgres`) are registered at once and each defines its own `"table"`/`"function"`, so a
// shared global map would collide. A driver builds one `KindRegistry` and registers its kinds into it.

/**
 * An authored definable, tagged with the KIND that owns it. Core dispatches on `kind` alone — every
 * other field is the kind's own business, handed straight to {@link KindEngine.lower}. This is the
 * neutral upper bound for a kind's authoring-object type (a driver's concrete `TableDef`/`FnDef` is a
 * structural subtype).
 */
export interface Definable {
  readonly kind: string;
  readonly name: string;
}

/**
 * A kind's PORTABLE object — the dialect-independent data shape core stores + diffs. A kind chooses
 * how structured this is: a table's portable form carries fields/indexes (so core can field-level
 * diff it); an opaque kind (function/access) carries a neutral identity + a `native` payload it
 * round-trips. Either way it is tagged with `kind`/`name` for cross-kind dispatch + ordering.
 */
export interface PortableObject {
  readonly kind: string;
  readonly name: string;
}

/** A reference to another object in the schema graph — the unit of cross-kind dependency ordering. */
export interface Ref {
  readonly kind: string;
  readonly name: string;
}

// `DiffItem` is a type-only import (erased at compile) — the display contract the `displayItems` hook
// produces; no runtime cli->kind coupling, same arrangement as ./plan.ts.
import type { DiffItem } from "../cli-kit/diff";

/**
 * What core needs to orchestrate ONE kind generically — it never inspects the specifics. The
 * change-vocabulary (`emit`/`remove`/`overwrite`) mirrors the Driver contract's, so a kind's behavior
 * is parity-checkable against the fixed-slot engine. `A` is the kind's authoring object, `P` its
 * portable object; both are opaque to core beyond the {@link Definable}/{@link PortableObject} bounds.
 */
export interface KindEngine<
  A extends Definable = Definable,
  P extends PortableObject = PortableObject,
> {
  /** Authoring object -> this kind's portable object (normalized; both lowerings must converge here). */
  lower(authored: A): P;
  /** CREATE DDL for one portable object (a fresh apply / migration `up` for an added object). */
  emit(portable: P): string[];
  /** DROP DDL for one portable object (`up` for a removed object, `down` for an added one). */
  remove(portable: P): string[];
  /**
   * In-place CHANGE DDL taking `prev` to `next` (the dialect's ALTER/OVERWRITE). The spine calls
   * `overwrite(next, prev)` to roll a change back. A kind with no in-place form recreates: implement
   * as `[...remove(prev), ...emit(next)]`. Default (omitted) = recreate via emit(next).
   */
  overwrite?(prev: P, next: P): string[];
  /**
   * The CANONICAL change-detection key: the spine treats prev/next of the same object as a CHANGE iff
   * their `canonical` differs. Default (omitted) = `emit(portable).join("\n")` — so a kind whose `emit`
   * is already its canonical form needs nothing. Override when `emit` is FAITHFUL but some clauses must
   * be EXCLUDED from equality — because the DB rewrites them on read (PG `'x'` -> `'x'::text`, `a>0` ->
   * `(a>0)`) or never introspects them (a COMMENT, an index) — so a faithful `emit` would phantom-diff a
   * freshly-applied schema against `introspect`. Return `emit` MINUS those clauses: they stay create-time
   * faithful in `emit`, but don't count as changes. `canonical(a) === canonical(b)` MUST mean "no
   * migration needed". Affects ONLY classification; `emit`/`overwrite` (the DDL) are unaffected.
   */
  canonical?(portable: P): string;
  /**
   * Fine-grained DISPLAY items for a change of this object — so `schemic diff` shows per-SUB-OBJECT
   * changes (a table decomposes into per-FIELD items: `field:user:name` changed), each carrying its
   * owner `table` so the display GROUPS them hierarchically under it, instead of one coarse whole-object
   * item. Called `(prev, next)`: a change diffs the two; `(undefined, next)` lists the object's
   * sub-items as adds — the `--full` projection core uses for the full desired-state view. Default
   * (omitted) = ONE whole-object item. DISPLAY ONLY — never affects up/down DDL (that is
   * `emit`/`overwrite`); a structured driver reuses the per-field diff it already computes. Leave
   * `DiffItem.file` unset (the caller attaches source linkage).
   */
  displayItems?(prev: P | undefined, next: P | undefined): DiffItem[];
  /**
   * Objects this one must be emitted AFTER — the cross-kind dependency edges (a field/index -> its
   * table; an edge table -> its in/out tables; an event -> its table + any function it calls). Drives
   * the topological sort in ./plan.ts. Omitted = no dependencies.
   */
  deps?(portable: P): Ref[];
  /**
   * The owning object to CLUSTER next to in the emitted order (an index's table) — readability only,
   * never overrides {@link deps}. Omitted = a top-level object.
   */
  owner?(portable: P): Ref | undefined;
  /**
   * Live connection -> all portable objects of THIS kind (the reverse direction). Introspection is
   * often one `INFO`/`pg_catalog` read yielding every kind at once; a driver backs all of its kinds'
   * `introspect` with one shared (memoized) read and slices out this kind's objects. Omitted -> this
   * kind isn't introspectable (diff/emit still work from authored state).
   */
  introspect?(conn: unknown): Promise<P[]>;
}

/** A kind's full spec: its `name`, its `build` (the driver's authoring entry), and its engine. */
export type KindSpec<
  Build extends (...args: never[]) => unknown,
  A extends Definable,
  P extends PortableObject,
> = { name: string; build: Build } & KindEngine<A, P>;

/**
 * A driver's set of registered kinds + the generic behavior the spine reads off them. Built once per
 * driver; `define` registers a kind and returns the driver's OWN `build` function UNCHANGED — so the
 * driver writes `export const defineTable = registry.define({ name: "table", build, ...engine })` and
 * keeps full type-safety + DX (TS preserves a generic `build`'s parameters across the passthrough).
 */
export class KindRegistry {
  // Heterogeneous kinds erase at the engine seam (engine ops are structural); the AUTHORING side
  // keeps full types via `define`'s `Build` passthrough.
  // biome-ignore lint/suspicious/noExplicitAny: the engine seam is intentionally type-erased.
  private readonly kinds = new Map<string, KindEngine<any, any>>();

  /**
   * Register a KIND. `build` is the driver's own authoring entry — ANY shape/chain — and its type
   * flows through unchanged (type-safety + DX are the driver's to design). The engine fns give core
   * the generic behavior. Registration ORDER is the kind's ordinal (the stable tie-break among
   * independent objects in {@link orderObjects}), so register coarse-to-fine (table before index).
   */
  define<
    Build extends (...args: never[]) => unknown,
    A extends Definable,
    P extends PortableObject,
  >(spec: KindSpec<Build, A, P>): Build {
    this.kinds.set(spec.name, spec);
    return spec.build;
  }

  /** The engine for `kind`, or undefined if no such kind is registered. */
  // biome-ignore lint/suspicious/noExplicitAny: the engine erases at this seam (see `kinds`).
  engine(kind: string): KindEngine<any, any> | undefined {
    return this.kinds.get(kind);
  }

  /** Registered kind names, in registration order (== ordinal order). */
  names(): string[] {
    return [...this.kinds.keys()];
  }

  /**
   * A kind's ORDINAL = its registration index. Used ONLY as a tie-break among objects with no
   * dependency relation, so independent objects come out stably layered (readability); it never
   * overrides the dependency graph. An unknown kind sorts last.
   */
  ordinal(kind: string): number {
    const i = this.names().indexOf(kind);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  }

  /** [name, engine] pairs in registration order — the spine iterates these. */
  // biome-ignore lint/suspicious/noExplicitAny: the engine erases at this seam (see `kinds`).
  entries(): [string, KindEngine<any, any>][] {
    return [...this.kinds.entries()];
  }
}
