// kind-ordering.poc.ts — cross-kind dependency ordering for the kind registry.
//
// The question: is a per-kind ORDINAL ("tables, then indexes, then functions") enough? No. A table's
// EVENT can call a FUNCTION, so that function must be emitted BEFORE the table — a FUNCTION before a
// TABLE, which any "tables-first" ordinal gets wrong. Dependencies don't respect kind layers, so you
// need a dependency GRAPH + topological sort. The ordinal survives only as a STABLE TIE-BREAK among
// objects with no dependency relation. Drops run the order in REVERSE.
//
// Typecheck: bunx tsc --noEmit --strict --target esnext --moduleResolution bundler --skipLibCheck \
//   packages/core/docs/poc/kind-ordering.poc.ts

type Ref = { kind: string; name: string };
const key = (r: Ref) => `${r.kind}:${r.name}`;

/** A lowered portable object + the specific objects it must be emitted AFTER (its kind engine's `deps`). */
interface Obj {
  kind: string;
  name: string;
  deps: Ref[];
}

/** Kind ORDINAL = readability layering among INDEPENDENT objects only — never relied on for correctness. */
const ORDINAL: Record<string, number> = { table: 0, index: 1, function: 2 };

/** Topological sort (DFS post-order). Forward = create order; reverse for drops. Cycle → throw. */
function order(objs: Obj[]): Obj[] {
  const byKey = new Map(objs.map((o) => [key(o), o]));
  const done = new Set<string>();
  const onStack = new Set<string>();
  const out: Obj[] = [];
  const visit = (k: string) => {
    if (done.has(k)) return;
    if (onStack.has(k)) throw new Error(`dependency cycle through ${k}`);
    const o = byKey.get(k);
    if (!o) return; // a ref to something outside this set → external, skip
    onStack.add(k);
    for (const d of o.deps) visit(key(d));
    onStack.delete(k);
    done.add(k);
    out.push(o);
  };
  // Visit roots in (ordinal, name) order so INDEPENDENT objects come out stable + layered.
  const roots = [...objs].sort(
    (a, b) =>
      (ORDINAL[a.kind] ?? 9) - (ORDINAL[b.kind] ?? 9) ||
      key(a).localeCompare(key(b)),
  );
  for (const r of roots) visit(key(r));
  return out;
}

/* --- the scenario a bare ordinal gets WRONG --- */
const user: Obj = { kind: "table", name: "user", deps: [] };
const post: Obj = {
  kind: "table",
  name: "post",
  deps: [{ kind: "table", name: "user" }], // FK: post.author → user
};
const fmt: Obj = { kind: "function", name: "fmt", deps: [] };
const audit: Obj = {
  kind: "table",
  name: "audit",
  deps: [{ kind: "function", name: "fmt" }], // audit's EVENT calls fn::fmt → must exist first
};

export const created = order([user, post, fmt, audit]).map(key);
// → ["function:fmt", "table:audit", "table:user", "table:post"]
//   fn::fmt is emitted BEFORE table:audit (audit's event needs it). A "tables-before-functions"
//   ordinal would have put fmt LAST and broken audit's event. The graph fixes it; the ordinal only
//   orders the independent {user, post} pair stably.

export const dropped = [...created].reverse();
// → drops in reverse: audit before fmt (you can't drop a function an event still calls);
//   post before user (drop the FK side first).
