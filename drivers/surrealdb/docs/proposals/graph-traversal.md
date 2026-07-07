# Proposal: Graph traversal for `@schemic/surrealdb/query`

Status: **RATIFIED** (design signed off by Manuel). Grounded in the empirical grammar map at
`docs/graph-syntax-map.md` (every form live-probed against surreal 3.1.4).

## Implementation status (what's built vs pending)

Everything below is on branch `feat/surrealdb-graph-traversal`. The two showcase files in
`docs/examples/` only exercise SHIPPED rows.

| Feature | Status |
|---|---|
| `RelationDef` endpoint-type capture (foundation) | ✅ shipped |
| `.out` / `.in` / `.both` + chaining | ✅ shipped |
| Polymorphic union target emission `->edge->(a, b)` | ✅ shipped |
| Target narrowing `.out(E, Target)` / subset | ✅ shipped |
| `.return` projection (flat / destructure / alias / computed / nested) | ✅ shipped |
| `.all()` (`.*`) | ✅ shipped |
| Composition (traversals + columns + subqueries in one `.return`) | ✅ shipped |
| Edge steps `.outEdges`/`.inEdges`/`.bothEdges` + `.node()` bridge | ⬜ not built |
| Edge fields (`contains.amount`) + edge filters (`->(E WHERE …)->`) | ⬜ not built |
| Target filter `.out(E).where(n => …)` (`->E->(node WHERE …)`) | ⬜ not built |
| WHERE set-ops on a traversal (`u.out(Owns).contains(x)` → `x IN …`) | ⬜ not built |
| `select([A, B])` multi-table roots | ⬜ not built |
| `.match(Member, …)` member primitive (union `.where`/`.return`) | ⬜ not built |
| Recursion `.repeat("1..3", t => …)` (+collect/+path/+shortest) | ⬜ phase 2 |
| RELATE writes | ⬜ fast-follow |

Until `.match` ships, projecting a polymorphic/unconstrained target **throws** ("narrow first").

## Thesis

Graph traversal is the marquee query-builder feature. The design principle: **the traversal is
type-checked against the schema, and each step carries the endpoint type forward.** An edge that
does not connect to the current node is a *compile error*; a polymorphic edge becomes a *checked
union*. The authoring grammar mirrors `select`: `.where(...)` filters, `.return(...)` projects — so
once you know the query builder, you know graph traversal.

This is the whole reason to build it as a typed surface rather than a stringly escape hatch.

## The two atoms (from the grammar)

SurrealDB's grammar makes `->edge` (the edge records) and `->edge->node` (the target nodes) two
distinct productions; bare `->edge->` is a parse error. So the API has two verb families:

| Verb family | SurQL | Returns |
|---|---|---|
| `.out(E)` / `.in(E)` / `.both(E)` | `->E->node` / `<-E<-node` / `<->E<->node` | `NodeTraversal<E.to>` (chainable) |
| `.outEdges(E)` / `.inEdges(E)` / `.bothEdges(E)` | `->E` / `<-E` / `<->E` | `EdgeTraversal<E>` |
| `.node(Target?)` (on an EdgeTraversal) | `->node` | bridges an edge step back to nodes |

`.out`/`.in`/`.both` are the ~90% node case. `.outEdges` etc. are the home for **edge fields** and
**edge filtering**, and `.node()` continues from an edge to its target.

## Direction is schema-checked

Each `RelationDef` knows its endpoints. `.out(E)` is legal only when `E.from` includes the current
node type; its result is `NodeTraversal<E.to>`. `.in(E)` requires `E.to`, yields `E.from`. This
requires enriching `RelationDef` to carry endpoint **TableDef types** (today it carries only the
endpoint name strings — `pure.ts` `RelationDef<Name, S, In, Out>` where `In`/`Out` are `NamesOf<F>`).
This enrichment is the foundational build step.

## Filters

| SurQL | Schemic |
|---|---|
| `->E->(node WHERE …)` | `.out(E).where(n => …)` |
| `->(E WHERE …)->node` | `.outEdges(E).where(e => …).node()` |
| `->(E WHERE …)->(a, b)` | `.outEdges(E).where(e => …).node([A, B])` |

Edge filtering lives on the edge step; `.node()` bridges back. No overload collision with target
narrowing.

## Target narrowing & polymorphic unions

A polymorphic edge `DEFINE TABLE knows TYPE RELATION FROM user TO user|agent|topic` has
`out: record<user | agent | topic>`. So:

| SurQL | Schemic | Result type |
|---|---|---|
| `->knows->?` | `u.out(Knows)` | `NodeTraversal<User \| Agent \| Topic>` |
| `->knows->user` | `u.out(Knows, User)` | `NodeTraversal<User>` |
| `->knows->(user, agent)` | `u.out(Knows, [User, Agent])` | `NodeTraversal<User \| Agent>` |

The second positional arg of `.out(E, …)` (and `.node(…)`) is **target narrowing** — a `TableDef`
or array of them. It both filters the query and unlocks the member's fields at the type level.

## Projection: `.return(...)`, callback-only

Named to match the rest of the surface — `select(...).return(...)`, write `.return(...)`,
`block().return(...)` all already mean "reshape the output," and `.return` already nests (subqueries
drop into `.return` objects) and already handles bare-ref vs object. Traversal reuses it verbatim.

| You want | Schemic | Emits |
|---|---|---|
| one field (flat) | `.return(i => i.name)` | `->…->ingredient.name` |
| several / **alias** | `.return(i => ({ title: i.name }))` | `.{ title: name }` |
| **computed / extra** | `.return(i => ({ up: surql.fn.string.uppercase(i.name) }))` | `.{ up: string::uppercase(name) }` |
| **nested traversal** | `.return(i => ({ treats: i.out(Treats).return(c => c.name) }))` | `.{ treats: ->treats->concern.name }` |
| full record | `.return(i => i)` / `.all()` | `.*` |

**Callback-only** (no bare `u.out(Owns).name`): node/edge refs carry `.out`/`.in`/`.where`/`.node`
methods, and edge records have real `in`/`out`/`id` fields — property-style field access would
collide. The callback keeps fields and traversal-methods in separate namespaces.

Bare ref → flat projection; object literal → `.{…}` destructure. Same shape rule as `.return` today.

## In WHERE — reuse the ratified array ops

A traversal is a set. `x IN ->E->node` / `->E->node CONTAINS x` / `ANYINSIDE […]` map to our already
ratified array vocabulary:

| SurQL | Schemic |
|---|---|
| `x IN ->owns->product` | `u.out(Owns).contains(x)` |
| `->owns->product ANYINSIDE […]` | `u.out(Owns).containsAny([…])` |
| `count(->E->(n WHERE …)) > 0` | `u.out(E).where(…).count().gt(0)` |

## `select([A, B])` — multi-table roots share the union machinery

SurrealDB `SELECT * FROM user, agent` is a **union (concatenation)**, not a cross join (verified: 2
users + 1 agent = 3 rows), each row keeping its own shape and self-identifying by `id`. So
`select([User, Agent])` decodes to `(App<User> | App<Agent>)[]` — the *same union* the polymorphic
traversal yields. **One union-ref/union-row machinery serves both** `select([...])` roots and
`.out(polymorphicEdge)` targets.

### Member-only fields on a union — the `.match` primitive

A union ref exposes only **common** fields. Member-only access (in `.where` OR `.return`) goes
through one primitive:

```ts
r.match(User, u => u.email.eq("x"))   // -> record::tb(id) = 'user' AND email = 'x'
```

`.match(Member, ref => …)` unlocks the member's full field set in the callback and **always emits the
`record::tb(id)` table guard**. This is not sugar — it is correctness: a bare `WHERE email = 'x'` on
a union silently narrows via NONE-exclusion, but `WHERE email != 'x'` *leaks the other members
through* (`NONE != 'x'` is true). The table guard makes both directions correct. Composition:

```ts
.where(r => r.match(User, u => u.email.eq("x")).or(r.match(Agent, a => a.model.eq("gpt"))))
.where(r => r.match(User, u => u.email.eq("x")).or(r.isNot(User)))   // filter Users, keep Agents
.return(r => ({ name: r.name, email: r.match(User, u => u.email) })) // member field, NONE for others
```

## Recursion (PHASE 2)

`rec.{depth}(->E->node)` with `+collect`/`+path`/`+shortest=target`, depth ranges (`1..2`, `..2`,
`..`, `2`), reverse bodies, and the `@` self-ref SELECT form. Body must yield record ids (projection
inside errors). Proposed surface `p.repeat("1..3", t => t.out(PairsWith)).collect()/.shortest(x)`.
Designed-for but not in the first PR.

## RELATE writes (FAST-FOLLOW)

Read traversal is the marquee. `RELATE` write surface is a separate arc. `defineRelation` endpoint
enrichment (shared with reads) lands now; the write *builder* comes after.

## Core touchpoint

The union-ref/union-row typing rides on core's neutral `Row`/`Project` types (`@schemic/core/query`).
If exposing an `A | B` row ref needs a core-side change, that is a `core-dev` DM — not landed
unilaterally. Flagged during build; the surrealdb-local spine does not otherwise depend on it.

## Build order

1. **Enrich `RelationDef`** to carry endpoint `TableDef` types (foundational).
2. **Node spine**: `.out`/`.in`/`.both` + schema-checked direction + `NodeTraversal<T>` +
   target-type inference + chaining.
3. **`.where`** (target filter) + **`.return`** projection (flat/destructure/alias/computed/nested).
4. **Edge steps**: `.outEdges`/`.inEdges`/`.bothEdges` + `.node()` bridge + edge fields/filters.
5. **Target narrowing** `.out(E, Target)` + **polymorphic union** `NodeTraversal<A|B>`.
6. **WHERE set-ops** (reuse ratified `.contains*`).
7. **`select([...])`** multi-table roots + **`.match`** member primitive (shared union machinery).
8. Phase 2: recursion. Fast-follow: RELATE writes.
