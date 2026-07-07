// Graph traversal — node spine (`.out`/`.in`/`.both`). Emission is asserted against the empirically
// verified 3.1.4 grammar (docs/graph-syntax-map.md): the atomic `->edge->node`, chaining, direction,
// polymorphic union targets `->edge->(a, b)`, narrowing `->edge->node`, unconstrained `->edge->?`.
import { describe, expect, test } from "bun:test";
import type { RecordId } from "surrealdb";
import { defineRelation, defineTable, s, surql } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("g_user", { name: s.string() });
const Product = defineTable("g_product", {
  name: s.string(),
  price: s.number(),
});
const Brand = defineTable("g_brand", { name: s.string() });
const Agent = defineTable("g_agent", { name: s.string() });

const Ingredient = defineTable("g_ingredient", {
  name: s.string(),
  sulfate: s.boolean(),
});
const Concern = defineTable("g_concern", { name: s.string() });

const Owns = defineRelation("g_owns").from(User).to(Product);
const MadeBy = defineRelation("g_made_by").from(Product).to(Brand);
const Knows = defineRelation("g_knows").from(User).to([User, Agent]);
const Contains = defineRelation("g_contains", { amount: s.string() })
  .from(Product)
  .to(Ingredient);
const Treats = defineRelation("g_treats").from(Ingredient).to(Concern);
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

describe("graph traversal — .return projection", () => {
  test("flat single field appends .col", () => {
    expect(
      sqlOf(
        select(User).return((u) => ({
          names: u.out(Owns).return((p) => p.name),
        })),
      ),
    ).toBe("SELECT ->g_owns->g_product.name AS names FROM g_user");
  });

  test("object destructure with aliasing", () => {
    expect(
      sqlOf(
        select(User).return((u) => ({
          owned: u.out(Owns).return((p) => ({ title: p.name, cost: p.price })),
        })),
      ),
    ).toBe(
      "SELECT ->g_owns->g_product.{ title: name, cost: price } AS owned FROM g_user",
    );
  });

  test("key === column emits the shorthand", () => {
    expect(
      sqlOf(
        select(User).return((u) => ({
          owned: u.out(Owns).return((p) => ({ name: p.name })),
        })),
      ),
    ).toBe("SELECT ->g_owns->g_product.{ name } AS owned FROM g_user");
  });

  test("computed/derived value in a destructure", () => {
    expect(
      sqlOf(
        select(User).return((u) => ({
          owned: u.out(Owns).return((p) => ({ up: p.name.length() })),
        })),
      ),
    ).toBe(
      "SELECT ->g_owns->g_product.{ up: string::len(name) } AS owned FROM g_user",
    );
  });

  test("nested traversal inside a destructure", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          ings: p.out(Contains).return((i) => ({
            name: i.name,
            treats: i.out(Treats).return((c) => c.name),
          })),
        })),
      ),
    ).toBe(
      "SELECT ->g_contains->g_ingredient.{ name, treats: ->g_treats->g_concern.name } AS ings FROM g_product",
    );
  });

  test(".all() materializes the full record (.*)", () => {
    expect(
      sqlOf(select(User).return((u) => ({ owned: u.out(Owns).all() }))),
    ).toBe("SELECT ->g_owns->g_product.* AS owned FROM g_user");
  });

  test("projecting a polymorphic/unconstrained target throws (narrow first)", () => {
    // `.return` throws in soleTarget() before the callback runs — the body just needs to typecheck.
    expect(() =>
      select(User).return((u) => ({
        k: u.out(Knows).return(() => surql`name`),
      })),
    ).toThrow(/narrow the target first/);
  });

  test("types: destructure infers the projected shape; flat infers the field array", () => {
    const q = select(Product).return((p) => ({
      detail: p.out(Contains).return((i) => ({ n: i.name, s: i.sulfate })),
      names: p.out(Contains).return((i) => i.name),
    }));
    type Res = Awaited<ReturnType<typeof q.run>>[number];
    const _detail: Res["detail"] = [] as { n: string; s: boolean }[];
    const _names: Res["names"] = [] as string[];
    void _detail;
    void _names;
    expect(true).toBe(true);
  });
});

describe("graph traversal — edge steps (.outEdges/.node/edge fields/filters)", () => {
  test("bare edge -> the edge records", () => {
    expect(
      sqlOf(select(Product).return((p) => ({ e: p.outEdges(Contains) }))),
    ).toBe("SELECT ->g_contains AS e FROM g_product");
  });

  test("edge field (flat) -> ->edge.field", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          amt: p.outEdges(Contains).return((e) => e.amount),
        })),
      ),
    ).toBe("SELECT ->g_contains.amount AS amt FROM g_product");
  });

  test("edge destructure with the endpoint (->edge.{ field, out })", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          e: p
            .outEdges(Contains)
            .return((e) => ({ amount: e.amount, ing: e.out })),
        })),
      ),
    ).toBe("SELECT ->g_contains.{ amount, ing: out } AS e FROM g_product");
  });

  test(".node() bridges the edge to its target node (->edge->node)", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({ ings: p.outEdges(Contains).node() })),
      ),
    ).toBe("SELECT ->g_contains->g_ingredient AS ings FROM g_product");
  });

  test("edge filter then node (->(edge WHERE …)->node) with a bound value", () => {
    const q = select(Product).return((p) => ({
      ings: p
        .outEdges(Contains)
        .where((e) => e.amount.eq("5%"))
        .node(),
    }));
    const { sql, vars } = q.toSQL();
    expect(sql).toBe(
      "SELECT ->(g_contains WHERE amount = $b0)->g_ingredient AS ings FROM g_product",
    );
    expect(Object.values(vars)).toContain("5%");
  });

  test("edge filter -> node -> project the node field", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          ings: p
            .outEdges(Contains)
            .where((e) => e.amount.eq("5%"))
            .node()
            .return((i) => i.name),
        })),
      ),
    ).toBe(
      "SELECT ->(g_contains WHERE amount = $b0)->g_ingredient.name AS ings FROM g_product",
    );
  });

  test("edge .all() materializes the full edge record", () => {
    expect(
      sqlOf(select(Product).return((p) => ({ e: p.outEdges(Contains).all() }))),
    ).toBe("SELECT ->g_contains.* AS e FROM g_product");
  });

  test("types: edge projection infers the shape; the node bridge keeps the target type", () => {
    const q = select(Product).return((p) => ({
      amounts: p.outEdges(Contains).return((e) => e.amount),
      ings: p
        .outEdges(Contains)
        .node()
        .return((i) => i.name),
    }));
    type Res = Awaited<ReturnType<typeof q.run>>[number];
    const _amounts: Res["amounts"] = [] as string[];
    const _ings: Res["ings"] = [] as string[];
    void _amounts;
    void _ings;
    expect(true).toBe(true);
  });
});

describe("graph traversal — target filter (.out(E).where(node => …))", () => {
  test("filters the target node (->E->(node WHERE …)) and binds the value", () => {
    const q = select(Product).return((p) => ({
      x: p.out(Contains).where((i) => i.sulfate.eq(true)),
    }));
    const { sql, vars } = q.toSQL();
    expect(sql).toBe(
      "SELECT ->g_contains->(g_ingredient WHERE sulfate = $b0) AS x FROM g_product",
    );
    expect(Object.values(vars)).toContain(true);
  });

  test("filter then project the (filtered) target", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          x: p
            .out(Contains)
            .where((i) => i.sulfate.eq(true))
            .return((i) => i.name),
        })),
      ),
    ).toBe(
      "SELECT ->g_contains->(g_ingredient WHERE sulfate = $b0).name AS x FROM g_product",
    );
  });

  test("edge filter + target filter compose (->(E WHERE …)->(node WHERE …))", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          x: p
            .outEdges(Contains)
            .where((e) => e.amount.eq("5%"))
            .node()
            .where((i) => i.sulfate.eq(true)),
        })),
      ),
    ).toBe(
      "SELECT ->(g_contains WHERE amount = $b0)->(g_ingredient WHERE sulfate = $b1) AS x FROM g_product",
    );
  });

  test("a filtered target is still chainable", () => {
    expect(
      sqlOf(
        select(Product).return((p) => ({
          x: p
            .out(Contains)
            .where((i) => i.sulfate.eq(true))
            .out(Treats),
        })),
      ),
    ).toBe(
      "SELECT ->g_contains->(g_ingredient WHERE sulfate = $b0)->g_treats->g_concern AS x FROM g_product",
    );
  });
});
