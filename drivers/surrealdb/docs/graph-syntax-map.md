# SurrealDB graph traversal — empirical syntax map (server 3.1.4)

All rows below were **live-probed** against surreal 3.1.4 (ephemeral memory server), not inferred.
Schema used: skincare graph (`user`/`product`/`brand`/`ingredient`/`concern` nodes; `owns`/`bought_at`/
`made_by`/`contains`/`treats`/`pairs_with` RELATION edges). This is the ground truth the query-builder
graph surface must cover.

## 1. Directions & the atomic unit

| Form | Result | Notes |
|---|---|---|
| `rec->edge->node` | record ids of nodes | OUT. The **atomic valid unit**. |
| `rec<-edge<-node` | record ids | IN |
| `rec<->edge<->node` | record ids (both dirs, may dup) | BOTH |
| `rec->edge` | **edge** record ids | bare edge = the edge records themselves |
| `rec->edge->` | **PARSE ERROR** | trailing arrow invalid — "expected `?`, `(` or identifier" |

## 2. Edge record access

| Form | Result |
|---|---|
| `rec->edge.field` | `['2%','5%']` — projects a field off the edge records |
| `rec->edge.{ f1, out }` | `[{amount,out}, …]` — destructure edge |
| `rec->edge->node.field` | node field values |
| `rec->edge->node.{ f1, f2 }` | destructure the **node** |

## 3. Filters

| Form | Meaning |
|---|---|
| `rec->edge->(node WHERE …)` | filter on the **target node** |
| `rec->(edge WHERE …)->node` | filter on the **edge** |
| `rec->edge->(node WHERE …).field` | filter then project |

## 4. Target unions & any-target

| Form | Meaning |
|---|---|
| `rec->(edgeA, edgeB)->node` | union over **multiple edge** tables |
| `rec->edge->(nodeA, nodeB)` | union over **multiple target node** tables (memory-graph `->mentions->(person,project,topic)`) |
| `rec->edge->?` | any target |
| `rec->edge->?.*` | any target, full records |

## 5. Multi-hop (fixed length)

`rec->contains->ingredient->treats->concern` — chain atoms; `.field` at the end projects. Mixed
directions chain too: `rec<-owns<-user->owns->product`.

## 6. Recursive traversal (3.x) — `start.{depth}(path)`

| Form | Meaning |
|---|---|
| `rec.{1..2}(->edge->node)` | depth range 1..2 |
| `rec.{..2}(->edge->node)` | up to 2 |
| `rec.{..}(->edge->node)` | unbounded |
| `rec.{2}(->edge->node)` | **exactly** 2 |
| `rec.{..+collect}(->edge->node)` | collect all visited |
| `rec.{..3+collect}(->edge->node)` | bounded + collect |
| `rec.{..+path}(->edge->node)` | return the paths (array of arrays) |
| `rec.{..+shortest=target}(->edge->node)` | shortest path to `target` |
| `<-` inside body | reverse recursion valid: `rec.{..}(<-edge<-node)` |
| `SELECT @.{1..2}->edge->node FROM rec` | `@` self-reference form inside SELECT |

**Invalid recursion forms:** `rec.{range}.{ ->… }` (block body — parse error); projecting inside the
body `rec.{..}(->edge->node.{id,name})` → runtime "Expected a record ID during recursive graph
traversal" (body must yield record ids; project *outside*). `->edge->@` as a body target → parse error
(`@` is only the SELECT-position self-ref).

## 7. Invalid — specific-record pins (design-critical)

| Form | Result |
|---|---|
| `rec->edge->node:id` | **PARSE ERROR** — cannot pin a specific target record |
| `rec->edge:id->node` | **PARSE ERROR** — cannot pin a specific edge record |

There is **no spelling to target a specific record** in a traversal. Pin via filter:
`->edge->(node WHERE id = $x)` or membership in WHERE (`$x IN rec->edge->node`).

## 8. Starting points (expression position)

| Start | Works? |
|---|---|
| record id `rec->…` | yes |
| variable `$u->…` (bound to record id) | yes |
| array of record ids `[a,b]->…` | yes (nested per-source) |
| subquery `(SELECT VALUE id FROM …)->…` | yes |
| **bare table name** `user->owns->product` | **NO — returns NONE** |

Bare-table traversal only works inside `SELECT ->… FROM table` (the row is the implicit anchor).
Standalone traversal fragments need a concrete record / variable / array anchor.

## 9. Traversal in clauses

- **SELECT projection**, aliased: `SELECT ->owns->product AS owned FROM user:alice`
- **FETCH** materializes ids to rows: `… FETCH owned`
- **WHERE** as a set: `->owns->product CONTAINS x` · `x IN ->owns->product` ·
  `->owns->product ANYINSIDE [ … ]` · `count(->edge->(node WHERE …)) > 0`
- **count()** / `array::len()` over a traversal both work.
