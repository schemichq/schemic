/**
 * Graph traversal — real-world composite queries, modeled on actual product graphs (a skincare
 * catalog and a memory graph). Every query below combines MULTIPLE implemented features: deep
 * multi-level projection, multi-hop chains, narrowed polymorphic edges, traversal THROUGH a narrowed
 * edge, and columns + traversals + subqueries in one `.return`.
 *
 * Run it:  bun run docs/examples/graph-traversal-realworld.ts  — it prints the SurQL each lowers to.
 *
 * Implemented here: directions, chaining, narrowing, polymorphic unions, `.return` (flat / alias /
 * computed / nested), `.all()`, composition. STILL TO COME (next increments, see docs/proposals):
 * edge steps + fields (`.outEdges(E).node()`, `contains.amount`), target/edge WHERE filters
 * (`->contains->(ingredient WHERE ...)`), traversal set-ops in WHERE, recursion, RELATE writes.
 */
import { defineRelation, defineTable, s } from "../../src/index";
import { select } from "../../src/query";

const show = (label: string, q: { toSQL(): { sql: string } }) =>
  console.log(`\n### ${label}\n${q.toSQL().sql}`);

// ===================================================================================================
// DOMAIN 1 — a skincare catalog graph
// ===================================================================================================

const User = defineTable("user", { name: s.string(), tier: s.string() });
const Product = defineTable("product", { name: s.string(), price: s.number() });
const Brand = defineTable("brand", { name: s.string(), country: s.string() });
const Ingredient = defineTable("ingredient", {
  name: s.string(),
  sulfate: s.boolean(),
});
const Concern = defineTable("concern", { name: s.string() });
const Photo = defineTable("photo", { url: s.string() });
const Agent = defineTable("agent", { name: s.string() });

const Owns = defineRelation("owns").from(User).to(Product);
const MadeBy = defineRelation("made_by").from(Product).to(Brand);
const Contains = defineRelation("contains", { amount: s.string() })
  .from(Product)
  .to(Ingredient);
const Treats = defineRelation("treats", { strength: s.number() })
  .from(Ingredient)
  .to(Concern);
const PairsWith = defineRelation("pairs_with").from(Product).to(Product);
const Depicts = defineRelation("depicts").from(Photo).to(Product);
// polymorphic: a user can know another user OR an AI advisor agent
const Knows = defineRelation("knows").from(User).to([User, Agent]);

// --- A. Product "detail page" — three levels deep, mixing columns, hops and nested projections ------
// Brand, the ingredients and what each treats, and the products it pairs with — one round trip.
show(
  "A. product detail (3 levels deep)",
  select(Product)
    .where((p) => p.price.lte(50))
    .return((p) => ({
      product: p.name,
      price: p.price,
      brand: p.out(MadeBy).return((b) => ({ name: b.name, from: b.country })),
      ingredients: p.out(Contains).return((i) => ({
        ingredient: i.name,
        treats: i.out(Treats).return((c) => c.name),
      })),
      pairsWith: p
        .out(PairsWith)
        .return((x) => ({ name: x.name, price: x.price })),
    })),
);

// --- B. A user's shelf + social recommendations — traversal THROUGH a narrowed polymorphic edge -----
// `->knows->user->owns->product`: products owned by the people (not agents) this user knows.
show(
  "B. shelf + friends-of recommendations",
  select(User)
    .where((u) => u.tier.eq("pro"))
    .return((u) => ({
      user: u.name,
      shelf: u.out(Owns).return((p) => ({
        name: p.name,
        brand: p.out(MadeBy).return((b) => b.name),
      })),
      // narrow Knows to User, then hop to THEIR products — a 3-hop chain across a narrowed edge
      friendsUse: u
        .out(Knows, User)
        .out(Owns)
        .return((p) => ({ name: p.name, price: p.price })),
      // bare polymorphic traversal (ids across user | agent) needs no narrowing
      knows: u.out(Knows),
    })),
);

// --- C. Photo fan-out — `->depicts->product->made_by->brand`, plus a full-record materialization -----
show(
  "C. photo fan-out to products, brands, and full records",
  select(Photo).return((ph) => ({
    url: ph.url,
    products: ph.out(Depicts).return((p) => ({
      name: p.name,
      brand: p.out(MadeBy).return((b) => b.name),
    })),
    brands: ph
      .out(Depicts)
      .out(MadeBy)
      .return((b) => b.name), // direct 2-hop to brands
    productsFull: ph.out(Depicts).all(), // ->depicts->product.*
  })),
);

// --- D. Catalog roll-up — a computed field alongside a nested treats-graph ---------------------------
show(
  "D. catalog roll-up with a computed field",
  select(Brand).return((b) => ({
    brand: b.name,
    nameLen: b.name.length(), // computed -> string::len(name)
    // brand <- product <- (nothing here) ; go the other way: products of this brand and their ingredients
    products: b.in(MadeBy).return((p) => ({
      title: p.name,
      price: p.price,
      ingredients: p.out(Contains).return((i) => i.name),
    })),
  })),
);

// ===================================================================================================
// DOMAIN 2 — a memory graph (agent long-term memory / "recall")
// ===================================================================================================

const Memory = defineTable("memory", { text: s.string(), at: s.datetime() });
const Person = defineTable("person", { name: s.string() });
const Project = defineTable("project", { title: s.string() });
const Topic = defineTable("topic", { label: s.string() });

// a memory mentions people, projects, or topics (polymorphic), and follows up on earlier memories
const Mentions = defineRelation("mentions")
  .from(Memory)
  .to([Person, Project, Topic]);
const FollowsUp = defineRelation("follows_up").from(Memory).to(Memory);

// --- E. Recall a memory's neighborhood — narrow the polymorphic edge PER member, self-referential hop
show(
  "E. memory recall (per-member narrowing + follow-up chain)",
  select(Memory)
    .where((m) => m.text.includes("launch"))
    .return((m) => ({
      text: m.text,
      // same polymorphic edge, narrowed to each member to project that member's own fields
      people: m.out(Mentions, Person).return((p) => p.name),
      projects: m.out(Mentions, Project).return((p) => p.title),
      topics: m.out(Mentions, Topic).return((t) => t.label),
      // everything it mentions, as bare ids across the union (no narrowing needed)
      mentionsAny: m.out(Mentions),
      // self-referential edge: the immediate follow-up, and the 2-hop follow-up chain
      followUp: m.out(FollowsUp).return((f) => ({ text: f.text, at: f.at })),
      chain: m
        .out(FollowsUp)
        .out(FollowsUp)
        .return((f) => f.text),
    })),
);

// --- F. Cross-domain-style deep chain in one projection — a subset-narrowed union + a subquery -------
show(
  "F. subset narrowing + correlated subquery in one projection",
  select(Memory).return((m) => ({
    text: m.text,
    // narrow to a SUBSET of the union (person or project, not topic) -> ->mentions->(person, project)
    keyEntities: m.out(Mentions, [Person, Project]),
    // a correlated subquery sits right next to the traversals
    recent: select(Memory).where((x) => x.text.eq(m.text)),
  })),
);
