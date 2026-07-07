// Graph traversal — node spine (`.out`/`.in`/`.both`). Emission is asserted against the empirically
// verified 3.1.4 grammar (docs/graph-syntax-map.md): the atomic `->edge->node`, chaining, direction,
// polymorphic union targets `->edge->(a, b)`, narrowing `->edge->node`, unconstrained `->edge->?`.
import { describe, expect, test } from "bun:test";
import type { RecordId } from "surrealdb";
import { defineRelation, defineTable, s } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("g_user", { name: s.string() });
const Product = defineTable("g_product", {
  name: s.string(),
  price: s.number(),
});
const Brand = defineTable("g_brand", { name: s.string() });
const Agent = defineTable("g_agent", { name: s.string() });

const Owns = defineRelation("g_owns").from(User).to(Product);
const MadeBy = defineRelation("g_made_by").from(Product).to(Brand);
const Knows = defineRelation("g_knows").from(User).to([User, Agent]);
const Loose = defineRelation("g_loose"); // endpoints undeclared

const sqlOf = (q: { toSQL(): { sql: string } }) => q.toSQL().sql;

describe("graph traversal — node spine emission", () => {
  test("out lands on the edge's target node (->edge->node)", () => {
    expect(sqlOf(select(User).return((u) => ({ owned: u.out(Owns) })))).toBe(
      "SELECT ->g_owns->g_product AS owned FROM g_user",
    );
  });

  test("chaining composes atoms (->a->x->b->y)", () => {
    expect(
      sqlOf(select(User).return((u) => ({ b: u.out(Owns).out(MadeBy) }))),
    ).toBe("SELECT ->g_owns->g_product->g_made_by->g_brand AS b FROM g_user");
  });

  test("in reverses direction (<-edge<-node)", () => {
    expect(sqlOf(select(Product).return((p) => ({ owners: p.in(Owns) })))).toBe(
      "SELECT <-g_owns<-g_user AS owners FROM g_product",
    );
  });

  test("polymorphic target emits the union (->edge->(a, b))", () => {
    expect(sqlOf(select(User).return((u) => ({ k: u.out(Knows) })))).toBe(
      "SELECT ->g_knows->(g_user, g_agent) AS k FROM g_user",
    );
  });

  test("narrowing to one member (->edge->node)", () => {
    expect(sqlOf(select(User).return((u) => ({ k: u.out(Knows, User) })))).toBe(
      "SELECT ->g_knows->g_user AS k FROM g_user",
    );
  });

  test("narrowing to a subset (->edge->(a, b))", () => {
    expect(
      sqlOf(select(User).return((u) => ({ k: u.out(Knows, [User, Agent]) }))),
    ).toBe("SELECT ->g_knows->(g_user, g_agent) AS k FROM g_user");
  });

  test("unconstrained edge targets any record (->edge->?)", () => {
    expect(sqlOf(select(User).return((u) => ({ x: u.out(Loose) })))).toBe(
      "SELECT ->g_loose->? AS x FROM g_user",
    );
  });
});

describe("graph traversal — types", () => {
  test("a bare traversal projects to an array of the target's record ids", () => {
    const q = select(User).return((u) => ({
      owned: u.out(Owns),
      brands: u.out(Owns).out(MadeBy),
    }));
    type Res = Awaited<ReturnType<typeof q.run>>[number];
    // Positive: owned is an array of Product record ids; brands of Brand.
    const _owned: Res["owned"] = [] as RecordId<"g_product">[];
    const _brands: Res["brands"] = [] as RecordId<"g_brand">[];
    void _owned;
    void _brands;
    expect(true).toBe(true);
  });

  test("wrong-direction target types differ (in yields the from-node)", () => {
    const q = select(Product).return((p) => ({ owners: p.in(Owns) }));
    type Res = Awaited<ReturnType<typeof q.run>>[number];
    const _owners: Res["owners"] = [] as RecordId<"g_user">[];
    void _owners;
    expect(true).toBe(true);
  });
});
