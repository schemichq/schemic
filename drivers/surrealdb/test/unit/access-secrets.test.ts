// Phase-2a: DEFINE ACCESS keys as env()/secret() references — emitted as bound `$param` placeholders
// (value never in the DDL), with the `$param -> SecretRef` bindings attached for apply-time resolution.
import { describe, expect, spyOn, test } from "bun:test";
import { emitDefStatement } from "../../src/driver";
// env/secret imported from the surrealdb index — verifies the side-effect-free re-export path too.
import { defineAccess, env, secret } from "../../src/index";

const st = (a: unknown) =>
  emitDefStatement(a as Parameters<typeof emitDefStatement>[0]);

describe("DEFINE ACCESS secret keys (env/secret -> $param)", () => {
  test("env() key emits a $param placeholder + attaches the binding (value never in DDL)", () => {
    const s = st(
      defineAccess("api")
        .onDatabase()
        .jwt({ alg: "HS512", key: env("JWT_SECRET") }),
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
      defineAccess("a")
        .onDatabase()
        .jwt({ key: env("K") }),
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

  test("inline-key lint: symmetric KEY warns; an asymmetric verify KEY is PUBLIC — no warning", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Asymmetric verify KEY = the public key: inline is fine, no lint.
      st(
        defineAccess("pubkey_ok")
          .onDatabase()
          .jwt({ alg: "RS256", key: "-----BEGIN PUBLIC KEY-----..." }),
      );
      expect(warn).not.toHaveBeenCalled();

      // ...but the asymmetric ISSUER KEY is the PRIVATE key: still lints.
      st(
        defineAccess("privkey_lints")
          .onDatabase()
          .jwt({
            alg: "RS256",
            key: "-----BEGIN PUBLIC KEY-----...",
            issuer: { key: "-----BEGIN PRIVATE KEY-----..." },
          }),
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("privkey_lints");

      // Symmetric (HS*) KEY is the shared secret: lints.
      st(
        defineAccess("hs_lints")
          .onDatabase()
          .jwt({ alg: "HS512", key: "shared-secret" }),
      );
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});
