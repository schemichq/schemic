// TYPE-INSTANTIATION BUDGETS for the SurrealDB query builder (@ark/attest `bench().types()`).
// Run under node/tsx (NOT bun — see packages/core/docs/TYPE-PERF-TESTING.md):
//   bun run --cwd drivers/surrealdb test:types
//
// The number is the instantiations the expression's TYPE triggers; the budget guards REGRESSION — a
// change that makes inference materially more expensive blows the +20% threshold and fails. Absolute
// counts for zod-coupled generics include the imported type surface (~76k floor), so watch the DELTA,
// not the magnitude. Targets are the query builder's highest instantiation-depth risks: Row/FieldRef
// inference, graph-traversal chains, and graph RECURSION (200k+ — the sharpest). Re-baseline
// intentionally (ATTEST_updateSnapshots=1) when a change's added cost is known and justified.
import { bench } from "@ark/attest";
import { defineRelation, defineTable, s, surql } from "../../src/index";
import type { App, Create } from "../../src/pure";
import type { Row } from "../../src/query";
import { block, create, relate, select } from "../../src/query";

const User = defineTable("user", {
  name: s.string(),
  age: s.int(),
  bio: s.string().optional(),
  views: s.int().$default(surql`0`),
});
type U = typeof User;

const Product = defineTable("product", { title: s.string(), price: s.int() });
const Owns = defineRelation("owns", { since: s.datetime() })
  .from(User)
  .to(Product);
const PairsWith = defineRelation("pairs_with", { strength: s.int() })
  .from(Product)
  .to(Product);

// --- core generics (the inference every read/write pays) ------------------------------------------
bench("App<User> — decode-row inference", () => ({}) as App<U>).types([
  889,
  "instantiations",
]);
bench("Row<User> — ref-proxy inference", () => ({}) as Row<U>).types([
  1726,
  "instantiations",
]);
bench("Create<User> — content shape", () => ({}) as Create<U>).types([
  11344,
  "instantiations",
]);

// --- real builder call sites (what a user actually pays typing a query) ---------------------------
bench("select(User).where().orderBy() chain", () =>
  select(User)
    .where((u) => u.age.gt(18))
    .orderBy((u) => u.name),
).types([2296, "instantiations"]);

bench("create(User).content()", () =>
  create(User).content({ name: "a", age: 1 }),
).types([12644, "instantiations"]);

bench("schemaless select().where()", () =>
  select("user").where((r) => r.age.gt(18)),
).types([2419, "instantiations"]);

// --- graph traversal (multi-hop) + RECURSION — the instantiation-depth risks ----------------------
bench("graph: two-hop u.out(Owns).out(PairsWith) projection", () =>
  select(User).return((u) => ({
    paired: u
      .out(Owns)
      .out(PairsWith)
      .return((p) => ({ t: p.title })),
  })),
).types([202545, "instantiations"]);

bench("graph: recursion p.repeat({min,max}, t => t.out(E))", () =>
  select(Product).return((p) => ({
    net: p.repeat({ min: 1, max: 3 }, (t) => t.out(PairsWith)),
  })),
).types([110416, "instantiations"]);

// --- RELATE endpoints — the `Endpoint` union resolves the edge's .from()/.to() node types, and now
// also admits `$param`/block-var refs. Guards that the ref branch stays cheap.
bench("relate(record, Edge, record)", () =>
  relate(User.record().for("u1"), Owns, Product.record().for("p1")),
).types([109972, "instantiations"]);

bench("relate(blockVar, Edge, record) — ref endpoint", () =>
  block().for({ u: select(User) }, (v) =>
    relate(v.u, Owns, Product.record().for("p1")),
  ),
).types([116235, "instantiations"]);
