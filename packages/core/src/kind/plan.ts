// The GENERIC migration spine over a {@link KindRegistry} — core's kind-blind orchestration. It
// classifies each portable object as add/change/remove, ORDERS them across kinds by a dependency
// graph, and emits up/down DDL + the display {@link Diff}. It never names a kind: every kind-specific
// decision is delegated to that kind's {@link KindEngine}.
//
// The spine works on PORTABLE objects (both sides already lowered), exactly like the fixed-slot
// `Driver.diff(prev, next)`: the stored snapshot IS portable, and the authoring side is lowered once
// via {@link lowerSchema}. So `prev` is a snapshot, `next` is `lowerSchema(registry, defs)`.
//
// Cross-kind ordering is the load-bearing part (docs/kind-registry.md §7.1). THREE layers:
//   1. dependency GRAPH + topological sort  -> CORRECTNESS (an object emits after everything it deps on)
//   2. kind ORDINAL (registration order)     -> stable TIE-BREAK among independent objects (layering)
//   3. OWNER clustering                       -> READABILITY (an index right after its table)
// A per-kind ordinal ALONE is wrong: a table's event can call a function, so the function must emit
// BEFORE the table — a function-before-table the graph handles and an ordinal cannot. Drops reverse it.

// NOTE: `Diff`/`DiffItem` are a type-only import (erased at compile — no runtime cli->kind coupling),
// the same arrangement as ./driver/portable-diff.ts.
import type { Diff, DiffItem } from "../cli/diff";
import type {
  Definable,
  KindEngine,
  KindRegistry,
  PortableObject,
  Ref,
} from "./registry";

const refKey = (r: Ref) => `${r.kind}:${r.name}`;

/** A node in the dependency graph: identity + the edges/owner used to order it. */
export interface OrderNode {
  readonly kind: string;
  readonly name: string;
  /** Objects this node must come AFTER (only intra-set refs constrain; external refs are ignored). */
  readonly deps: Ref[];
  /** Owning object to cluster next to (readability tie-break only; never overrides `deps`). */
  readonly owner?: Ref;
}

/**
 * Kahn's topological sort with two presentation tweaks among the nodes whose deps are all satisfied:
 * prefer one OWNED by the currently-open cluster (so a table's children follow it), then lowest
 * (kind-ordinal, then name). Correctness (deps) always wins — an owned/low-ordinal node can't jump a
 * dependency. A genuine cycle throws (a named error). Refs to nodes outside `nodes` are ignored (an
 * object may depend on something untouched by this diff — it already exists / isn't changing).
 */
export function orderObjects<T extends OrderNode>(
  nodes: T[],
  ordinalOf: (kind: string) => number,
): T[] {
  const byKey = new Map(nodes.map((n) => [refKey(n), n]));
  const indeg = new Map<string, number>(nodes.map((n) => [refKey(n), 0]));
  const dependents = new Map<string, string[]>();
  for (const n of nodes)
    for (const d of n.deps) {
      if (!byKey.has(refKey(d))) continue; // external dep -> not a constraint within this set
      indeg.set(refKey(n), (indeg.get(refKey(n)) ?? 0) + 1);
      const list = dependents.get(refKey(d)) ?? [];
      list.push(refKey(n));
      dependents.set(refKey(d), list);
    }

  const out: T[] = [];
  const done = new Set<string>();
  let group: string | undefined; // the last unowned node emitted == the open cluster
  while (out.length < nodes.length) {
    const ready = nodes.filter(
      (n) => !done.has(refKey(n)) && indeg.get(refKey(n)) === 0,
    );
    if (ready.length === 0)
      throw new Error(
        `dependency cycle among: ${nodes
          .filter((n) => !done.has(refKey(n)))
          .map(refKey)
          .join(", ")}`,
      );
    ready.sort((a, b) => {
      const ao = a.owner && refKey(a.owner) === group ? 0 : 1; // prefer the open cluster
      const bo = b.owner && refKey(b.owner) === group ? 0 : 1;
      return (
        ao - bo ||
        ordinalOf(a.kind) - ordinalOf(b.kind) ||
        refKey(a).localeCompare(refKey(b))
      );
    });
    const next = ready[0];
    out.push(next);
    done.add(refKey(next));
    if (!next.owner) group = refKey(next); // a top-level object opens a new cluster
    for (const dep of dependents.get(refKey(next)) ?? [])
      indeg.set(dep, (indeg.get(dep) ?? 1) - 1);
  }
  return out;
}

// --- lowering + snapshot ------------------------------------------------------------------------

/**
 * Author -> portable: lower each definable through its kind's engine (skipping unregistered kinds).
 * The single place authoring becomes portable; everything downstream (diff/emit/snapshot) is portable.
 */
export function lowerSchema(
  registry: KindRegistry,
  defs: Definable[],
): PortableObject[] {
  const out: PortableObject[] = [];
  for (const d of defs) {
    const engine = registry.engine(d.kind);
    if (engine) out.push(engine.lower(d));
  }
  return out;
}

/**
 * The registry SNAPSHOT — portable objects grouped by kind. The open, generic replacement for
 * `PortableDb`'s fixed slots; serializes as plain JSON (it is plain data). Pre-launch: the format is
 * free to change, no version migration.
 */
export interface KindSnapshot {
  kinds: Record<string, PortableObject[]>;
}

/** Group a flat portable schema into a snapshot (by kind). */
export function snapshotKinds(schema: PortableObject[]): KindSnapshot {
  const kinds: Record<string, PortableObject[]> = {};
  for (const o of schema) {
    const bucket = kinds[o.kind] ?? [];
    bucket.push(o);
    kinds[o.kind] = bucket;
  }
  return { kinds };
}

/** Flatten a snapshot back into a portable schema (the inverse of {@link snapshotKinds}). */
export function snapshotObjects(snap: KindSnapshot): PortableObject[] {
  return Object.values(snap.kinds).flat();
}

// --- diff / plan --------------------------------------------------------------------------------

/** One classified object change, carrying its ordering metadata + the portable sides for DDL. */
interface Change extends OrderNode {
  readonly op: "add" | "change" | "remove";
  readonly prev?: PortableObject;
  readonly next?: PortableObject;
}

/** An up/down DDL program (each a list of statements). */
export interface KindPlan {
  up: string[];
  down: string[];
}

/** The canonical change-detection key for an object — the kind's `canonical`, else its emitted DDL. */
const canonicalOf = (engine: KindEngine, p: PortableObject): string =>
  engine.canonical?.(p) ?? engine.emit(p).join("\n");

const orderNodeOf = (
  engine: KindEngine,
  portable: PortableObject,
): OrderNode => ({
  kind: portable.kind,
  name: portable.name,
  deps: engine.deps?.(portable) ?? [],
  owner: engine.owner?.(portable),
});

/** Display identity: `kind:owner:name` (owner blank for a top-level object) + the display owner. */
const itemKey = (n: OrderNode) => `${n.kind}:${n.owner?.name ?? ""}:${n.name}`;
const itemTable = (n: OrderNode) => n.owner?.name ?? n.name;

const byKey = (schema: PortableObject[]) =>
  new Map(schema.map((o) => [refKey(o), o]));

/**
 * Classify both sides into ordered add/change/remove sets — the shared core of plan + diff. A `change`
 * is two objects of the same key whose emitted DDL differs (same test as the fixed-slot engine). Each
 * class is topologically ordered parent-first; the caller reverses one class for drops/inversion.
 */
function orderedChanges(
  registry: KindRegistry,
  prev: PortableObject[],
  next: PortableObject[],
): { nonRemoves: Change[]; removes: Change[] } {
  const prevByKey = byKey(prev);
  const nextByKey = byKey(next);
  const changes: Change[] = [];
  for (const k of new Set([...prevByKey.keys(), ...nextByKey.keys()])) {
    const p = prevByKey.get(k);
    const n = nextByKey.get(k);
    const portable = n ?? p;
    if (!portable) continue;
    const engine = registry.engine(portable.kind);
    if (!engine) continue;
    const node = orderNodeOf(engine, portable);
    if (p && !n) changes.push({ op: "remove", prev: p, ...node });
    else if (!p && n) changes.push({ op: "add", next: n, ...node });
    else if (p && n && canonicalOf(engine, p) !== canonicalOf(engine, n))
      changes.push({ op: "change", prev: p, next: n, ...node });
  }
  const ord = (kind: string) => registry.ordinal(kind);
  return {
    nonRemoves: orderObjects(
      changes.filter((c) => c.op !== "remove"),
      ord,
    ),
    removes: orderObjects(
      changes.filter((c) => c.op === "remove"),
      ord,
    ),
  };
}

const overwriteUp = (
  engine: KindEngine,
  a: PortableObject,
  b: PortableObject,
): string[] =>
  engine.overwrite?.(a, b) ?? [...engine.remove(a), ...engine.emit(b)];

/**
 * Diff two portable schema states into an executable up/down program, generically over the registry.
 *
 * `up` runs creates/changes parent-first (the dependency graph) then drops child-first; `down` is the
 * mirror: recreate drops parent-first, then undo creates/changes child-first. We invert PER OBJECT (not
 * by reversing the flat DDL list) so a kind's multi-line block — a table emitted with its fields —
 * keeps its internal order in both directions.
 */
export function planKinds(
  registry: KindRegistry,
  prev: PortableObject[],
  next: PortableObject[],
): KindPlan {
  const { nonRemoves, removes } = orderedChanges(registry, prev, next);
  const up: string[] = [];
  const down: string[] = [];
  for (const c of nonRemoves) {
    const e = registry.engine(c.kind);
    if (!e) continue;
    if (c.op === "add" && c.next) up.push(...e.emit(c.next));
    else if (c.op === "change" && c.prev && c.next)
      up.push(...overwriteUp(e, c.prev, c.next));
  }
  for (const c of [...removes].reverse()) {
    const e = registry.engine(c.kind); // drops child-first
    if (e && c.prev) up.push(...e.remove(c.prev));
  }
  for (const c of removes) {
    const e = registry.engine(c.kind); // recreate dropped objects parent-first
    if (e && c.prev) down.push(...e.emit(c.prev));
  }
  for (const c of [...nonRemoves].reverse()) {
    const e = registry.engine(c.kind); // undo creates/changes child-first
    if (!e) continue;
    if (c.op === "add" && c.next) down.push(...e.remove(c.next));
    else if (c.op === "change" && c.prev && c.next)
      down.push(...overwriteUp(e, c.next, c.prev));
  }
  return { up, down };
}

/**
 * Display items for a change set, in up order (creates/changes parent-first, drops child-first). A kind
 * with `displayItems` decomposes into FINE-grained sub-items (per-field, each carrying its `table` so
 * the display groups them under it); otherwise it falls back to ONE whole-object item.
 */
function diffItems(
  registry: KindRegistry,
  nonRemoves: Change[],
  removes: Change[],
): DiffItem[] {
  const items: DiffItem[] = [];
  const push = (c: Change) => {
    const e = registry.engine(c.kind);
    if (!e) return;
    if (e.displayItems) {
      items.push(...e.displayItems(c.prev, c.next));
      return;
    }
    const base = { key: itemKey(c), table: itemTable(c), kind: c.kind };
    if (c.op === "add" && c.next)
      items.push({ ...base, op: "add", ddl: e.emit(c.next).join("\n") });
    else if (c.op === "remove" && c.prev)
      items.push({
        ...base,
        op: "remove",
        ddl: e.remove(c.prev).join("\n"),
        old: e.emit(c.prev).join("\n"),
      });
    else if (c.op === "change" && c.prev && c.next)
      items.push({
        ...base,
        op: "change",
        before: e.emit(c.prev).join("\n"),
        after: e.emit(c.next).join("\n"),
      });
  };
  for (const c of nonRemoves) push(c);
  for (const c of [...removes].reverse()) push(c);
  return items;
}

/**
 * The full {@link Diff} the CLI + migration model consume — up/down DDL + per-object display items +
 * the whole desired schema (`full`, for `--full`). This is what a driver's `Driver.diff` returns once
 * its kinds are on the registry (the generic counterpart of the fixed-slot `buildDiff`). Source-file
 * linkage on the items is attached by the caller (the snapshot's `files` map), so `file` is left unset.
 */
export function buildKindDiff(
  registry: KindRegistry,
  prev: PortableObject[],
  next: PortableObject[],
): Diff {
  const { nonRemoves, removes } = orderedChanges(registry, prev, next);
  const { up, down } = planKinds(registry, prev, next);
  // `full` mirrors the items' granularity: a kind with `displayItems` projects its object as per-
  // sub-object adds (displayItems(undefined, portable)); otherwise one whole-object entry.
  const full = orderedSchema(registry, next).flatMap(
    ({ engine, portable, node }) => {
      if (engine.displayItems)
        return engine.displayItems(undefined, portable).map((it) => ({
          key: it.key,
          table: it.table,
          ddl: it.op === "add" ? it.ddl : "",
        }));
      return [
        {
          key: itemKey(node),
          table: itemTable(node),
          ddl: engine.emit(portable).join("\n"),
        },
      ];
    },
  );
  return { up, down, items: diffItems(registry, nonRemoves, removes), full };
}

/** Lower-already portable schema, topologically ordered, paired with each object's engine + node. */
function orderedSchema(
  registry: KindRegistry,
  schema: PortableObject[],
): { engine: KindEngine; portable: PortableObject; node: OrderNode }[] {
  const items = schema.flatMap((portable) => {
    const engine = registry.engine(portable.kind);
    return engine
      ? [{ engine, portable, node: orderNodeOf(engine, portable) }]
      : [];
  });
  const pos = new Map(
    orderObjects(
      items.map((i) => i.node),
      (k) => registry.ordinal(k),
    ).map((n, i) => [itemKey(n), i]),
  );
  return items.sort(
    (a, b) => (pos.get(itemKey(a.node)) ?? 0) - (pos.get(itemKey(b.node)) ?? 0),
  );
}

/**
 * Fresh-apply DDL for a portable schema: every object created, ordered across kinds by the graph.
 * (The `up` of a diff from an empty state.) Lower authoring first via {@link lowerSchema}.
 */
export function emitKinds(
  registry: KindRegistry,
  schema: PortableObject[],
): string[] {
  return orderedSchema(registry, schema).flatMap(({ engine, portable }) =>
    engine.emit(portable),
  );
}

/**
 * Reverse direction, fanned out across kinds: introspect every introspectable kind off one live
 * connection and flatten into portable objects. The RESOLUTION of "per-kind vs one driver read":
 * the contract is per-kind ({@link KindEngine.introspect}), but a driver backs all of its kinds with
 * ONE shared (memoized) read of `conn` and slices out each kind's objects — so the fan-out here costs
 * a single round-trip, not N. A kind without `introspect` contributes nothing (not introspectable).
 */
export async function introspectKinds(
  registry: KindRegistry,
  conn: unknown,
): Promise<PortableObject[]> {
  const out: PortableObject[] = [];
  for (const [, engine] of registry.entries()) {
    if (!engine.introspect) continue;
    out.push(...(await engine.introspect(conn)));
  }
  return out;
}
