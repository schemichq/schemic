// Phase-2a: DEFINE ACCESS keys as env()/secret() references — emitted as bound `$param` placeholders
// (value never in the DDL), with the `$param -> SecretRef` bindings attached for apply-time resolution.
import { describe, expect, test } from "bun:test";
import { env, secret } from "@schemic/core";
import { emitDefStatement } from "../../src/driver";
import { defineAccess } from "../../src/index";

const st = (a: unknown) =>
  emitDefStatement(a as Parameters<typeof emitDefStatement>[0]);

describe("DEFINE ACCESS secret keys (env/secret -> $param)", () => {
  test("env() key emits a $param placeholder + attaches the binding (value never in DDL)", () => {
    const s = st(
      defineAccess("api").onDatabase().jwt({ alg: "HS512", key: env("JWT_SECRET") }),
    );
    expect(s.ddl).toBe(
      "DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM HS512 KEY $env_JWT_SECRET;",
    );
    expect(s.bindings).toEqual({
      env_JWT_SECRET: { kind: "env", name: "JWT_SECRET" },
    });
  });

  test("secret() key — deterministic, sanitized $param name", () => {
    const s = st(
      defineAccess("svc")
        .onDatabase()
        .jwt({ alg: "RS256", key: secret("jwt/signing-key") }),
    );
    expect(s.ddl).toContain("KEY $secret_jwt_signing_key;");
    expect(s.bindings).toEqual({
      secret_jwt_signing_key: { kind: "secret", name: "jwt/signing-key" },
    });
  });

  test("identical refs collapse to one $param; the value is never emitted", () => {
    const s = st(
      defineAccess("a").onDatabase().jwt({ key: env("K") }),
    );
    expect(s.ddl).not.toContain('"'); // no quoted literal key
    expect(Object.keys(s.bindings ?? {})).toEqual(["env_K"]);
  });

  test("inline literal key: still emits (quoted), no bindings (the lint nudges to env/secret)", () => {
    const s = st(
      defineAccess("legacy").onDatabase().jwt({ alg: "HS512", key: "inline" }),
    );
    expect(s.ddl).toContain('KEY "inline";');
    expect(s.bindings).toBeUndefined();
  });

  test("a URL/JWKS access (secret-free) carries no bindings", () => {
    const s = st(
      defineAccess("ext").onDatabase().jwt({ url: "https://x/jwks.json" }),
    );
    expect(s.ddl).toContain("TYPE JWT URL");
    expect(s.bindings).toBeUndefined();
  });
});
