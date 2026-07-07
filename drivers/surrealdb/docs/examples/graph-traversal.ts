/**
 * Graph traversal showcase — the typed `->edge->node` surface of `@schemic/surrealdb/query`.
 *
 * Run it:  bun run docs/examples/graph-traversal.ts
 * Each query prints the SurQL it lowers to (shown inline as `// =>` comments, verified against a live
 * SurrealDB 3.1.4). The point: every hop is type-checked against your schema — an edge that doesn't
 * connect to the current node is a COMPILE error, and the traversed node's fields autocomplete.
 */
import { defineRelation, defineTable, s, surql } from "../../src/index";
import { select } from "../../src/query";

// ---------------------------------------------------------------------------------------------------
// Schema — a small skincare graph. Nodes are tables; edges are `defineRelation(...).from(X).to(Y)`.
// ---------------------------------------------------------------------------------------------------

const User = defineTable("user", { name: s.string() });
const Product = defineTable("product", { name: s.string(), price: s.number() });
const Brand = defineTable("brand", { name: s.string() });
const Ingredient = defineTable("ingredient", {
  name: s.string(),
  sulfate: s.boolean(),
});
const Concern = defineTable("concern", { name: s.string() });
const Agent = defineTable("agent", { name: s.string() }); // an AI skincare advisor

// Edges. `.from`/`.to` give each hop its endpoint types; edge fields go in the shape.
const Owns = defineRelation("owns").from(User).to(Product);
const MadeBy = defineRelation("made_by").from(Product).to(Brand);
const Contains = defineRelation("contains", { amount: s.string() })
  .from(Product)
  .to(Ingredient);
const Treats = defineRelation("treats", { strength: s.number() })
  .from(Ingredient)
  .to(Concern);
const PairsWith = defineRelation("pairs_with").from(Product).to(Product);
// A polymorphic edge: a user can "know" another user OR an AI agent.
const Knows = defineRelation("knows").from(User).to([User, Agent]);

const sql = (label: string, q: { toSQL(): { sql: string } }) =>
  console.log(`${label}\n  => ${q.toSQL().sql}\n`);

// ---------------------------------------------------------------------------------------------------
// 1. Directions — `.out` / `.in` / `.both`. The atomic `->edge->node`.
// ---------------------------------------------------------------------------------------------------

// The products a user owns. `.out(Owns)` is only legal because Owns.from === user.
sql(
  "1a. out",
  select(User).return((u) => ({ owned: u.out(Owns) })),
);
// => SELECT ->owns->product AS owned FROM user

// Who owns a given product — reverse direction.
sql(
  "1b. in",
  select(Product).return((p) => ({ owners: p.in(Owns) })),
);
// => SELECT <-owns<-user AS owners FROM product

// Products paired in either direction.
sql(
  "1c. both",
  select(Product).return((p) => ({ paired: p.both(PairsWith) })),
);
// => SELECT <->pairs_with<->product AS paired FROM product

// ---------------------------------------------------------------------------------------------------
// 2. Multi-hop — chain atoms; the type flows the whole way.
// ---------------------------------------------------------------------------------------------------

// user -> product -> brand. `u.out(Owns)` is a product, so `.out(MadeBy)` type-checks; the result is
// typed as Brand record ids.
sql(
  "2a. two hops (owned products' brands)",
  select(User).return((u) => ({ brands: u.out(Owns).out(MadeBy) })),
);
// => SELECT ->owns->product->made_by->brand AS brands FROM user

// A three-hop ingredient-to-concern path off a product.
sql(
  "2b. three hops (what a product's ingredients treat)",
  select(Product).return((p) => ({ treats: p.out(Contains).out(Treats) })),
);
// => SELECT ->contains->ingredient->treats->concern AS treats FROM product

// ---------------------------------------------------------------------------------------------------
// 3. Projection — `.return(node => ...)`. Typed fields, no strings.
// ---------------------------------------------------------------------------------------------------

// Flat: one field -> a flat array of that field.
sql(
  "3a. flat field",
  select(User).return((u) => ({ names: u.out(Owns).return((p) => p.name) })),
);
// => SELECT ->owns->product.name AS names FROM user

// Destructure with aliasing + a computed value. The KEY is the alias, the VALUE any typed expression.
sql(
  "3b. destructure (alias + computed)",
  select(User).return((u) => ({
    owned: u.out(Owns).return((p) => ({
      title: p.name, // alias: name -> title
      cost: p.price,
      shouting: p.name.length(), // computed -> string::len(name)
    })),
  })),
);
// => SELECT ->owns->product.{ title: name, cost: price, shouting: string::len(name) } AS owned FROM user

// Nested traversal inside a projection — a graph query, one level deeper.
sql(
  "3c. nested traversal",
  select(Product).return((p) => ({
    ingredients: p.out(Contains).return((i) => ({
      name: i.name,
      treats: i.out(Treats).return((c) => c.name),
    })),
  })),
);
// => SELECT ->contains->ingredient.{ name, treats: ->treats->concern.name } AS ingredients FROM product

// `.all()` materializes the full record.
sql(
  "3d. full record",
  select(User).return((u) => ({ owned: u.out(Owns).all() })),
);
// => SELECT ->owns->product.* AS owned FROM user

// ---------------------------------------------------------------------------------------------------
// 4. Polymorphic targets — a union edge, and narrowing.
// ---------------------------------------------------------------------------------------------------

// `Knows` points to user | agent, so a bare `.out(Knows)` traverses to BOTH (typed as the union).
sql(
  "4a. polymorphic (union target)",
  select(User).return((u) => ({ known: u.out(Knows) })),
);
// => SELECT ->knows->(user, agent) AS known FROM user

// Narrow to one member — the second arg both filters the query and unlocks that member's fields.
sql(
  "4b. narrowed to one member",
  select(User).return((u) => ({ people: u.out(Knows, User) })),
);
// => SELECT ->knows->user AS people FROM user

// Narrow to a subset.
sql(
  "4c. narrowed to a subset",
  select(User).return((u) => ({ some: u.out(Knows, [User, Agent]) })),
);
// => SELECT ->knows->(user, agent) AS some FROM user

// ---------------------------------------------------------------------------------------------------
// 5. Composition — a traversal is a fragment, so it sits alongside ordinary columns and subqueries in
//    the same projection, and drops into `surql` templates.
// ---------------------------------------------------------------------------------------------------

sql(
  "5. mixed projection (columns + traversals + subquery)",
  select(User)
    .where((u) => u.name.eq("Alice"))
    .return((u) => ({
      name: u.name,
      ownedNames: u.out(Owns).return((p) => p.name),
      brands: u
        .out(Owns)
        .out(MadeBy)
        .return((b) => b.name),
      recent: select(Product).where((p) => p.price.gt(20)),
    })),
);
// => SELECT name, ->owns->product.name AS ownedNames, ->owns->product->made_by->brand.name AS brands,
//    (SELECT * FROM product WHERE price > $b0) AS recent FROM user WHERE name = $b1

const frag = surql`RETURN ${select(User).where((u) => u.name.eq("Bob"))}`;
console.log("5b. surql interop =>", frag.query, "\n");
