// Typed-fragments PHASE 1: builders interpolate as fragments (namespaced binds), raw surql
// predicates inside `where` (with interpolatable FieldRefs), chainable Expr combinators
// (.and/.or/.not — no standalone import), and Def.call(args) — the one-object call: a typed
// BoundQuery<[R]> fragment that is also runnable (.run/.then) and client-bindable (db.call).
import { describe, expect, test } from "bun:test";
import { BoundQuery } from "surrealdb";
import {
  CallQuery,
  defineFunction,
  defineTable,
  s,
  surql,
} from "../../src/index";
import { create, select } from "../../src/query";

const SendMail = defineFunction("p1_send_mail", {
  email: s.string(),
  code: s.string(),
})
  .returns(s.string())
  .body(surql`RETURN $email + ":" + $code`);

const User = defineTable("p1_user", {
  name: s.string(),
  email: s.string(),
  age: s.int(),
});

// --- type-level assertions -----------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const callQ = SendMail.call({ email: "a@b.c", code: "X" });
type CallRes = Awaited<ReturnType<(typeof callQ)["run"]>>;
type _call = Expect<Equal<CallRes, string>>; // decoded via .returns(s.string())
type _frag = Expect<
  Equal<typeof callQ extends BoundQuery<[string]> ? true : false, true>
>;

const _argTyping = () => {
  // @ts-expect-error — unknown arg name
  SendMail.call({ email: "a", codee: "X" });
  // @ts-expect-error — missing required arg
  SendMail.call({ email: "a" });
};

describe("Expr combinators — no standalone and/or import needed", () => {
  test(".and/.or/.not chain and lower with correct grouping", () => {
    const { sql } = select(User)
      .where((u) =>
        u.age.gte(18).and(u.email.contains("@corp.com")).or(u.name.eq("root")),
      )
      .toSQL();
    expect(sql).toContain(
      "WHERE ((age >= $b0 AND email CONTAINS $b1) OR name = $b2)",
    );
  });

  test(".not() negates", () => {
    const { sql } = select(User)
      .where((u) => u.age.gte(18).not())
      .toSQL();
    expect(sql).toContain("WHERE !(age >= $b0)");
  });
});

describe("raw predicates in where — the escape hatch stays typed", () => {
  test("a surql fragment is a predicate leaf; FieldRefs splice as columns", () => {
    const { sql, vars } = select(User)
      .where((u) => u.age.gte(18).and(surql`${u.email} CONTAINS ${"@corp"}`))
      .toSQL();
    expect(sql).toContain("age >= $b0 AND (email CONTAINS $bind__");
    expect(Object.values(vars)).toContain("@corp");
    expect(Object.values(vars)).toContain(18);
  });

  test("where() accepts a bare fragment; hand-built bind names get collision-renamed", () => {
    const handmade = new BoundQuery("age > $b0", { b0: 99 });
    const { sql, vars } = select(User)
      .where((u) => u.name.eq("x").and(handmade))
      .toSQL();
    // The builder already used $b0 for "x" — the fragment's $b0 renames.
    expect(sql).toContain("name = $b0 AND (age > $b0_2)");
    expect(vars.b0).toBe("x");
    expect(vars.b0_2).toBe(99);
  });
});

describe("builders interpolate as fragments", () => {
  test("a Select splices as (SELECT ...) with namespaced binds", () => {
    const adults = select(User).where((u) => u.age.gte(18));
    const q = surql`LET $adults = ${adults}; RETURN array::len($adults);`;
    expect(q.query).toMatch(
      /LET \$adults = \(SELECT \* FROM p1_user WHERE age >= \$sub__\d+_b0\)/,
    );
    expect(Object.values(q.bindings ?? {})).toContain(18);
  });

  test("two builders in ONE template never collide", () => {
    const a = select(User).where((u) => u.age.gte(18));
    const b = select(User).where((u) => u.age.lt(13));
    const q = surql`RETURN [array::len(${a}), array::len(${b})];`;
    const names = Object.keys(q.bindings ?? {});
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(Object.values(q.bindings ?? {}).sort()).toEqual([13, 18]);
  });

  test("count() and one() splice as scalar/first-row expressions", () => {
    const n = select(User)
      .where((u) => u.age.gte(18))
      .count();
    expect(surql`RETURN ${n};`.query).toMatch(
      /\(\(SELECT count\(\).*GROUP ALL\)\[0\]\.count \|\| 0\)/,
    );
    const first = select(User).one();
    expect(surql`RETURN ${first};`.query).toMatch(
      /\(SELECT \* FROM p1_user LIMIT 1\)\[0\]/,
    );
  });

  test("a write builder splices too", () => {
    const mk = create(User).content({ name: "a", email: "e", age: 1 });
    const q = surql`LET $u = ${mk};`;
    expect(q.query).toMatch(
      /LET \$u = \(CREATE p1_user CONTENT \$sub__\d+___content RETURN AFTER\)/,
    );
  });
});

describe("Def.call(args) — fragment + runnable, one object", () => {
  test("literals encode + bind; the text is fn::name(...)", () => {
    const q = SendMail.call({ email: "a@b.c", code: "XYZ" });
    expect(q).toBeInstanceOf(CallQuery);
    expect(q).toBeInstanceOf(BoundQuery);
    expect(q.query).toMatch(
      /^fn::p1_send_mail\(\$call__\d+_email, \$call__\d+_code\)$/,
    );
    expect(Object.values(q.bindings ?? {}).sort()).toEqual(["XYZ", "a@b.c"]);
  });

  test("fragment and surql.$ args splice instead of binding", () => {
    const q = SendMail.call({
      email: surql.$.after.email,
      code: surql`string::uppercase(${"abc"})`,
    });
    expect(q.query).toContain(
      "fn::p1_send_mail($after.email, (string::uppercase($bind__",
    );
  });

  test("the call interpolates into a template like any fragment", () => {
    const q = surql`RETURN ${SendMail.call({ email: surql.$.after.email, code: surql.$.code })};`;
    expect(q.query).toBe("RETURN fn::p1_send_mail($after.email, $code);");
  });

  test("an unbound run() rejects with clear guidance", async () => {
    await expect(
      SendMail.call({ email: "a", code: "b" }).run(),
    ).rejects.toThrow(/not bound to a connection/);
  });
});

// --- live (SURREAL_URL-gated) ---------------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("phase-1 live", () => {
  test("db.call decodes; builder-in-raw and raw-in-builder run end to end", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitDefStatement, emitTable } = await import("../../src/ddl");
    const { connect } = await import("../../src/client");

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "frag_p1", database: "frag_p1" });
    await c.query(
      "REMOVE TABLE IF EXISTS p1_user; REMOVE FUNCTION IF EXISTS fn::p1_send_mail;",
    );
    await c.query(emitDefStatement(SendMail, { exists: "overwrite" }).ddl);
    await c.query(emitTable(User, { exists: "overwrite" }));
    await c.query(
      "CREATE p1_user:1 SET name = 'ada', email = 'ada@corp.com', age = 36;" +
        "CREATE p1_user:2 SET name = 'kid', email = 'kid@home.net', age = 9;",
    );
    const db = connect(c);

    // BOUND call — decoded through .returns.
    expect(await db.call(SendMail, { email: "a@b.c", code: "X" })).toBe(
      "a@b.c:X",
    );
    // STANDALONE run.
    expect(await SendMail.call({ email: "z", code: "9" }).run(c)).toBe("z:9");

    // Builder inside raw: count adults via a spliced subquery.
    const adults = select(User).where((u) => u.age.gte(18));
    const [n] = await db.query(surql`RETURN array::len(${adults});`);
    expect(n).toBe(1);
    // The count() fragment as a scalar.
    const [n2] = await db.query(surql`RETURN ${select(User).count()};`);
    expect(n2).toBe(2);

    // Raw inside builder: typed column ref + combinators, no and() import.
    const corp = await db
      .select(User)
      .where((u) => u.age.gte(18).and(surql`${u.email} CONTAINS ${"@corp"}`))
      .run(c);
    expect(corp.map((r) => r.name)).toEqual(["ada"]);

    await c.query(
      "REMOVE TABLE IF EXISTS p1_user; REMOVE FUNCTION IF EXISTS fn::p1_send_mail;",
    );
    await c.close();
  });
});

describe("surql``.as<T>() — typed fragment retype (replaces surql.expr)", () => {
  test("type-only: same runtime object, still a BoundQuery (composable)", () => {
    const frag = surql`age >= ${18}`;
    const typed = frag.as<boolean>();
    expect(typed as unknown).toBe(frag as unknown); // the SAME object — .as is a cast
    expect(typed).toBeInstanceOf(BoundQuery);
    const outer = surql`SELECT * FROM p1_user WHERE ${typed}`;
    expect(outer.query).toContain("WHERE age >= $bind__");
  });
});

// Type-level: .as<T> produces BoundQuery<[T]> (the [T] rule).
const _asTyped = surql`age >= 18`.as<boolean>();
type _asRule = Expect<
  Equal<typeof _asTyped extends BoundQuery<[boolean]> ? true : false, true>
>;
