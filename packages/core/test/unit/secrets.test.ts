import { describe, expect, test } from "bun:test";
import { env, envSecretProvider, isSecretRef, secret } from "../../src/secrets";

describe("secret refs", () => {
  test("env / secret build a placeholder ref (never the value)", () => {
    expect(env("JWT_SECRET")).toEqual({ kind: "env", name: "JWT_SECRET" });
    expect(secret("jwt/signing-key")).toEqual({
      kind: "secret",
      name: "jwt/signing-key",
    });
  });

  test("isSecretRef distinguishes refs from raw literal keys", () => {
    expect(isSecretRef(env("X"))).toBe(true);
    expect(isSecretRef(secret("Y"))).toBe(true);
    expect(isSecretRef("a-literal-key")).toBe(false);
    expect(isSecretRef({ kind: "other", name: "x" })).toBe(false);
    expect(isSecretRef({ name: "x" })).toBe(false);
    expect(isSecretRef(null)).toBe(false);
  });

  test("envSecretProvider resolves from process.env, throws when unset", () => {
    process.env.__SCHEMIC_SECRET_TEST__ = "shh";
    expect(envSecretProvider.resolve(env("__SCHEMIC_SECRET_TEST__"))).toBe("shh");
    expect(envSecretProvider.resolve(secret("__SCHEMIC_SECRET_TEST__"))).toBe(
      "shh",
    );
    expect(() => envSecretProvider.resolve(env("__SCHEMIC_MISSING__"))).toThrow();
    delete process.env.__SCHEMIC_SECRET_TEST__;
  });
});
