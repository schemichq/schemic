// kind-ordering.poc.ts — cross-kind dependency ordering for the kind registry. Three layers:
//   1. dependency GRAPH + topological sort  → CORRECTNESS (the load-bearing part)
//   2. kind ORDINAL                          → stable TIE-BREAK among independent objects
//   3. OWNER clustering                      → READABILITY (index right after its table)
//
// Why not just an ordinal? A table's EVENT can call a function, so the function must emit BEFORE the
// table — a FUNCTION before a TABLE, which any "tables-first" ordinal gets wrong. The graph handles it;
// the ordinal + owner are only presentation. Drops run the result in REVERSE.
//
// Typecheck: bunx tsc --noEmit --strict --target esnext --moduleResolution bundler --skipLibCheck \
//   packages/core/docs/poc/kind-ordering.poc.ts

type Ref = { kind: string; name: string };
const key = (r: Ref) => `${r.kind}:${r.name}`;

/** A lowered portable object: its deps (must emit AFTER these) + optional owner (cluster next to it). */
interface Obj {
  kind: string;
  name: string;
  deps: Ref[];
  owner?: Ref; // e.g. a field/index/event's table — readability clustering only
}

/** Kind ORDINAL = layering among INDEPENDENT objects only; never relied on for correctness. */
const ORDINAL: Record<string, number> = { table: 0, index: 1, function: 2 };
const rank = (o: Obj) => ORDINAL[o.kind] ?? 9;

/**
 * Kahn's topological sort with two presentation tweaks: among the objects whose deps are all satisfied,
 * prefer one OWNED by the currently-open cluster (so a table's children follow it), then lowest
 * (ordinal, name). Correctness (deps) always wins — an owned/low-ordinal object can't jump its deps.
 */
function order(objs: Obj[]): Obj[] {
  const byKey = new Map(objs.map((o) => [key(o), o]));
  const indeg = new Map<string, number>(objs.map((o) => [key(o), 0]));
  const dependents = new Map<string, string[]>();
  for (const o of objs)
    for (const d of o.deps) {
      if (!byKey.has(key(d))) continue; // external dep → ignore
      indeg.set(key(o), (indeg.get(key(o)) ?? 0) + 1);
      const list = dependents.get(key(d)) ?? [];
      list.push(key(o));
      dependents.set(key(d), list);
    }

  const out: Obj[] = [];
  const done = new Set<string>();
  let group: string | undefined; // the last unowned object emitted = the open cluster
  while (out.length < objs.length) {
    const ready = objs.filter((o) => !done.has(key(o)) && indeg.get(key(o)) === 0);
    if (!ready.length) throw new Error("dependency cycle");
    ready.sort((a, b) => {
      const ao = a.owner && key(a.owner) === group ? 0 : 1; // prefer the open cluster
      const bo = b.owner && key(b.owner) === group ? 0 : 1;
      return ao - bo || rank(a) - rank(b) || key(a).localeCompare(key(b));
    });
    const next = ready[0];
    out.push(next);
    done.add(key(next));
    if (!next.owner) group = key(next); // a top-level object opens a new cluster
    for (const dep of dependents.get(key(next)) ?? [])
      indeg.set(dep, (indeg.get(dep) ?? 1) - 1);
  }
  return out;
}

/* --- scenario: FK ordering + per-table grouping + the function-before-table case --- */
const T = (name: string, deps: Ref[] = []): Obj => ({ kind: "table", name, deps });
const I = (name: string, table: string): Obj => ({
  kind: "index",
  name,
  deps: [{ kind: "table", name: table }],
  owner: { kind: "table", name: table },
});
const F = (name: string, deps: Ref[] = []): Obj => ({ kind: "function", name, deps });

const objs: Obj[] = [
  T("user"),
  I("user_email", "user"),
  T("post", [{ kind: "table", name: "user" }]), // FK post.author → user
  I("post_author", "post"),
  F("fmt"),
  T("audit", [{ kind: "function", name: "fmt" }]), // audit's EVENT calls fn::fmt
];

export const created = order(objs).map(key);
// → ["table:user","index:user_email","table:post","index:post_author","function:fmt","table:audit"]
//   each index sits right after its table (owner grouping), post after user (FK), and fn::fmt BEFORE
//   table:audit (its event needs it) — exactly the layout you drew, with correctness intact.

export const dropped = [...created].reverse();
// → reverse for drops: audit, fmt, post_author, post, user_email, user.
