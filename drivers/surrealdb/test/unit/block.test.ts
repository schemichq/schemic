// Typed-fragments PHASE 3 (2/3): block() — the typed statement-block builder. LET vars type
// through the chain (s.n is a real ref of the value's kind), IF/FOR/RETURN/THROW give statement
// parity, and the block is a fragment: it interpolates into surql templates and every authoring
// slot (event THEN, function body) via the Fragmentable (`toQuery()`) coercion.
import { describe, expect, test } from "bun:test";
import { emitDefStatement, emitTable } from "../../src/ddl";
import { defineFunction, defineTable, s, surql } from "../../src/index";
import { block, select } from "../../src/query";

const Post = defineTable("blk_post", {
  title: s.string(),
  author: s.string(),
  views: s.number(),
});

describe("lowering", () => {
  test("let + if + return: `{ LET $n = ...; IF ... { ... }; RETURN ...; }`", () => {
    const q = block()
      .let("n", select(Post).count())
      .if((sv) => sv.n.gt(100), surql`RETURN 'big'`)
      .return((sv) => sv.n)
      .toQuery();
    expect(q.query).toMatch(
      /^\{ LET \$n = \(SELECT count\(\) FROM blk_post GROUP ALL\)\[0\]\.count OR 0; IF \$n > \$sub__\d+_b0 \{ RETURN 'big' \}; RETURN \$n; \}$/,
    );
    expect(Object.values(q.bindings ?? {})).toEqual([100]);
  });

  test("typed let vars: a count() var is a NUMBER ref — .gt/.plus work; kind flows", () => {
    const q = block()
      .let("n", select(Post).count())
      .return((sv) => sv.n.plus(1))
      .toQuery();
    expect(q.query).toMatch(/RETURN \$n \+ \$sub__\d+_r\d+; \}$/);
  });

  test("literal lets bind; string vars get the string family", () => {
    const q = block()
      .let("greeting", "hello")
      .return((sv) => sv.greeting.uppercase())
      .toQuery();
    expect(q.query).toMatch(
      /^\{ LET \$greeting = \$sub__\d+_b0; RETURN string::uppercase\(\$greeting\); \}$/,
    );
    expect(Object.values(q.bindings ?? {})).toEqual(["hello"]);
  });

  test("for loops: FOR $item IN <iterable> { body } with a typed loop var", () => {
    const q = block()
      .let("names", ["a", "b"])
      .for(
        "name",
        (sv) => sv.names,
        (sv) => surql`CREATE ${Post} SET title = ${sv.name.uppercase()}`,
      )
      .toQuery();
    expect(q.query).toMatch(
      /FOR \$name IN \$names \{ CREATE blk_post SET title = string::uppercase\(\$name\) \}; \}$/,
    );
  });

  test("throw: a plain string binds", () => {
    const q = block().throw("nope").toQuery();
    expect(q.query).toMatch(/^\{ THROW \$sub__\d+_b0 \}$/);
    expect(Object.values(q.bindings ?? {})).toEqual(["nope"]);
  });

  test("do(): an arbitrary statement (builders self-parenthesize; fragments splice bare)", () => {
    const q = block()
      .do(surql`UPDATE ${Post} SET views += 1`)
      .do(select(Post).where((p) => p.views.gt(1)))
      .toQuery();
    expect(q.query).toMatch(
      /^\{ UPDATE blk_post SET views \+= 1; \(SELECT \* FROM blk_post WHERE views > \$\S*b0\); \}$/,
    );
  });

  test("if/else with nested block()s", () => {
    const q = block()
      .let("n", 5)
      .if(
        (sv) => sv.n.gte(10),
        block().return(surql`'big'`),
        block().return(surql`'small'`),
      )
      .toQuery();
    expect(q.query).toMatch(
      /IF \$n >= \$sub__\d+_b1 \{ RETURN 'big' \} ELSE \{ RETURN 'small' \}; \}$/,
    );
  });

  test("reserved/invalid let names are rejected with guidance", () => {
    expect(() => block().let("b0", 1)).toThrow(/reserved/);
    expect(() => block().let("no spaces", 1)).toThrow(/identifier/);
  });
});

describe("composition", () => {
  test("a block interpolates into a surql template", () => {
    const q = surql`${block().return(surql`1 + 1`)}`;
    expect(q.query).toBe("{ RETURN 1 + 1 }");
  });

  test("typed: the block's RETURN types the fragment (Frag<R> flows to .let)", () => {
    // n: number (count) -> RETURN s.n -> Block<..., number>; nesting keeps the type.
    const inner = block()
      .let("n", select(Post).count())
      .return((sv) => sv.n);
    const outer = block()
      .let("m", inner)
      .return((sv) => sv.m.plus(1));
    expect(outer.toQuery().query).toContain("LET $m = { LET $n =");
  });
});

describe("authoring slots take blocks directly (Fragmentable)", () => {
  test("event THEN: block() emits as the braced body", () => {
    const T = Post.event("blk_notify", {
      when: (e) => e.event.eq("CREATE"),
      then: (e) =>
        block()
          .let("who", e.after.author)
          .do(surql`UPDATE ${Post} SET views += 1 WHERE author = $who`),
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain("THEN { LET $who = $after.author;");
    expect(ddl).toContain(
      "UPDATE blk_post SET views += 1 WHERE author = $who; }",
    );
  });

  test("function body: block() with typed args", () => {
    const F = defineFunction("blk_bump", { by: s.number() })
      .returns(s.number())
      .body((a) =>
        block()
          .let("n", select(Post).count())
          .return((sv) => surql`${sv.n} + ${a.by}`),
      );
    const { ddl } = emitDefStatement(F);
    expect(ddl).toContain(
      "{ LET $n = (SELECT count() FROM blk_post GROUP ALL)[0].count OR 0; RETURN $n + $by; }",
    );
  });
});

// --- live (SURREAL_URL-gated): block-built event + function apply, fire, and round-trip ----------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("block live", () => {
  test("block event THEN fires and is drift-free vs INFO; block function body runs", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitDefStatement, emitTable } = await import("../../src/ddl");
    const { explodeSchema, introspectAll } = await import(
      "../../src/kinds/explode"
    );
    const { deepEqual } = await import("../../src/cli/struct");
    const { defineFunction } = await import("../../src/index");
    const { connect } = await import("../../src/client");

    // An audit-counter flow: every post CREATE bumps a per-author tally via a block THEN.
    const Tally = defineTable("blk_tally", {
      author: s.string(),
      total: s.number(),
    });
    const PostV = Post.event("blk_tally_bump", {
      when: (e) => e.event.eq("CREATE"),
      then: (e) =>
        block()
          .let(
            "existing",
            select(Tally)
              .where((t) => t.author.eq(e.after.author))
              .one(),
          )
          .if(
            (sv) => sv.existing.isNone(),
            surql`CREATE ${Tally} SET author = $after.author, total = 1`,
            surql`UPDATE ${Tally} SET total += 1 WHERE author = $after.author`,
          ),
    });

    const Bump = defineFunction("blk_bump_live", { by: s.number() })
      .returns(s.number())
      .body((a) =>
        block()
          .let("n", select(Post).count())
          .return((sv) => surql`${sv.n} + ${a.by}`),
      );

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "blk", database: "blk" });
    await c.query(
      "REMOVE TABLE IF EXISTS blk_post; REMOVE TABLE IF EXISTS blk_tally; REMOVE FUNCTION IF EXISTS fn::blk_bump_live;",
    );
    await c.query(emitTable(Tally, { exists: "overwrite" }));
    await c.query(emitDefStatement(Bump, { exists: "overwrite" }).ddl);
    await c.query(emitTable(PostV, { exists: "overwrite" }));

    // Fire twice for one author: CREATE branch then UPDATE branch.
    await c.query(
      "CREATE blk_post:1 SET title = 'a', author = 'ada', views = 0;" +
        "CREATE blk_post:2 SET title = 'b', author = 'ada', views = 0;",
    );
    const [tally] = (await c.query("SELECT author, total FROM blk_tally")) as [
      { author: string; total: number }[],
    ];
    expect(tally).toEqual([{ author: "ada", total: 2 }]);

    // The block-bodied function runs through db.call.
    const db = connect(c);
    expect(await db.call(Bump, { by: 10 })).toBe(12);

    // Drift check: the block-built THEN round-trips through INFO unchanged.
    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
    const pick = (objs: { kind: string; name: string }[], name: string) =>
      objs.find((o) => o.kind === "table" && o.name === name) as unknown as {
        struct: unknown;
      };
    const authored = pick(explodeSchema([PostV, Tally]), "blk_post");
    const live = pick(await introspectAll(c), "blk_post");
    expect(deepEqual(scrub(authored.struct), scrub(live.struct))).toBe(true);

    await c.query(
      "REMOVE TABLE IF EXISTS blk_post; REMOVE TABLE IF EXISTS blk_tally; REMOVE FUNCTION IF EXISTS fn::blk_bump_live;",
    );
    await c.close();
  }, 60_000);
});
