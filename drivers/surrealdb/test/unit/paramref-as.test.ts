// ParamRef.as<T>() — the LEAF that types a `surql.$` param chain, so an out-of-band param
// (`DEFINE PARAM $resend_api_key`) drops into typed positions: operands, Def.call args, and
// surql.fn args. Type-only cast; `as` joins path/toText/then as reserved proxy names.
import { describe, expect, test } from "bun:test";
import { defineFunction, defineTable, ParamRef, s, surql } from "../../src/index";
import { select } from "../../src/query";

const User = defineTable("pa_user", { name: s.string(), age: s.number() });

describe("surql.$ leaf typing", () => {
  test("types a param chain and still splices as text", () => {
    const key = surql.$.resend_api_key.as<string>();
    expect(key.toText()).toBe("$resend_api_key");
    const q = surql.fn.string.concat("Bearer ", key);
    expect(q.query).toMatch(/^string::concat\(\$r\d+, \$resend_api_key\)$/);
  });

  test("nested paths type too: $.after.email.as<string>()", () => {
    const email = surql.$.after.email.as<string>();
    expect(email.toText()).toBe("$after.email");
    const { sql } = select(User)
      .where((u) => u.name.eq(email))
      .toSQL();
    expect(sql).toBe("SELECT * FROM pa_user WHERE name = $after.email");
  });

  test("typed: a mistyped leaf is rejected where the type matters", () => {
    const wrong = surql.$.resend_api_key.as<number>();
    const _bad = () =>
      // @ts-expect-error — name is a string column; a ParamRef<number> operand doesn't fit
      select(User).where((u) => u.name.eq(wrong));
    expect(typeof _bad).toBe("function");
  });

  test("typed Def.call args accept the leaf", () => {
    const F = defineFunction("pa_fn", { key: s.string() })
      .returns(s.boolean())
      .body(surql`RETURN $key != NONE`);
    const q = F.call({ key: surql.$.resend_api_key.as<string>() });
    expect(q.query).toBe("fn::pa_fn($resend_api_key)");
  });

  test("`as` is a reserved proxy name — an `as` path segment needs explicit ParamRef", () => {
    expect(new ParamRef(["after", "as"]).toText()).toBe("$after.as");
  });
});
