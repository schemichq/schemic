// Def.call(...) args accept typed FIELD/BLOCK-VAR refs and builders, not just literals /
// fragments / $param refs — `SendEmail.call({ email: e.after.email, code: sv.code })` from a
// block chain. Simple param-path refs splice BARE (`fn::f($code)` — parens there are redundant
// and INFO's printer strips them, so emitting them would phantom-diff DDL round-trips).
import { describe, expect, test } from "bun:test";
import { defineFunction, defineTable, s, surql } from "../../src/index";
import { block, select } from "../../src/query";

const Audit = defineTable("cra_audit", {
  who: s.string(),
  code: s.string(),
});
const Stamp = defineFunction("cra_stamp", {
  who: s.string(),
  code: s.string(),
})
  .returns(s.boolean())
  .body(
    ({ who, code }) =>
      surql`{ CREATE ${Audit} SET who = ${who}, code = ${code}; RETURN true; }`,
  );

describe("call args — refs and builders", () => {
  test("a block-var ref splices BARE: fn::cra_stamp($who, $code)", () => {
    const b = block()
      .let({ code: surql`rand::string(6)`.as<string>() })
      .do((sv) => Stamp.call({ who: surql.$.after.email, code: sv.code }));
    expect(b.toQuery().query).toContain(
      "fn::cra_stamp($after.email, $code)",
    );
  });

  test("a builder as an arg splices parenthesized with its binds", () => {
    const q = Stamp.call({
      who: select(Audit)
        .where((a) => a.code.eq("x"))
        .one(),
      code: "y",
    });
    expect(q.query).toMatch(
      /^fn::cra_stamp\(\(\(SELECT \* FROM cra_audit WHERE code = \$sub__\d+_b0 LIMIT 1\)\[0\]\), \$call__\d+_code\)$/,
    );
    expect(Object.values(q.bindings)).toEqual(
      expect.arrayContaining(["x", "y"]),
    );
  });

  test("typed: a wrong-kinded ref is a compile error", () => {
    const N = defineTable("cra_n", { n: s.number() });
    const _bad = () =>
      block()
        .let({ n: select(N).count() })
        // @ts-expect-error — `who` is a string arg; sv.n is a number ref
        .do((sv) => Stamp.call({ who: sv.n, code: "x" }));
    expect(typeof _bad).toBe("function");
  });
});

// --- live (SURREAL_URL-gated): the event -> block -> fn::call flow, drift-free -------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("call-ref-args live", () => {
  test("event block passes $code + $after refs into the fn; DDL round-trips", async () => {
    const { Surreal } = await import("surrealdb");
    const { emitDefStatement, emitTable } = await import("../../src/ddl");
    const { explodeSchema, introspectAll } = await import(
      "../../src/kinds/explode"
    );
    const { deepEqual } = await import("../../src/cli/struct");

    const User = defineTable("cra_user", { email: s.string() });
    const UserV = User.event("cra_on_create", {
      when: (e) => e.event.eq("CREATE"),
      then: (e) =>
        block()
          .let({ code: surql`string::uppercase(rand::string(6))`.as<string>() })
          .do((sv) => Stamp.call({ who: e.after.email, code: sv.code })),
    });

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "cra", database: "cra" });
    await c.query(
      "REMOVE TABLE IF EXISTS cra_user; REMOVE TABLE IF EXISTS cra_audit; REMOVE FUNCTION IF EXISTS fn::cra_stamp;",
    );
    await c.query(emitTable(Audit, { exists: "overwrite" }));
    await c.query(emitDefStatement(Stamp, { exists: "overwrite" }).ddl);
    await c.query(emitTable(UserV, { exists: "overwrite" }));

    await c.query("CREATE cra_user:1 SET email = 'a@x.dev';");
    const [rows] = (await c.query(
      "SELECT who, code FROM cra_audit",
    )) as [{ who: string; code: string }[]];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.who).toBe("a@x.dev");
    expect(rows[0]?.code).toMatch(/^[A-Z0-9]{6}$/i);

    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
    const pick = (objs: { kind: string; name: string }[]) =>
      objs.find(
        (o) => o.kind === "table" && o.name === "cra_user",
      ) as unknown as { struct: unknown };
    const authored = pick(explodeSchema([UserV, Audit]));
    const live = pick(await introspectAll(c));
    expect(deepEqual(scrub(authored.struct), scrub(live.struct))).toBe(true);

    await c.query(
      "REMOVE TABLE IF EXISTS cra_user; REMOVE TABLE IF EXISTS cra_audit; REMOVE FUNCTION IF EXISTS fn::cra_stamp;",
    );
    await c.close();
  }, 60_000);
});
