// RecordIdField.for with REFS returns the `type::record(...)` fragment (a symbolic id can't be a
// concrete RecordId) — `EmailVerification.record().for([e.after.id])` — typed against the
// DECLARED id value shape. And `.use(preset)` no longer widens a declared id type (the tuple /
// singleton-literal survives presets), which is what made `.for` look untyped.
import { describe, expect, test } from "bun:test";
import { emitTable } from "../../src/ddl";
import { defineSingleton, defineTable, s, surql } from "../../src/index";
import { get } from "../../src/query";

const timestamps = () =>
  defineTable.preset({
    columns: { createdAt: s.datetime().$default(surql`time::now()`) },
  });

const User = defineTable("rfr_user", { email: s.string() });
const EmailVerification = defineTable("rfr_verification", {
  id: s.tuple([User.record()]),
  codeHash: s.string(),
}).use(timestamps());

describe(".use preserves the declared id type", () => {
  test("tuple id survives a preset: .for demands the tuple shape", () => {
    const ok = EmailVerification.record().for([User.record().for("ada")]);
    expect(String(ok)).toContain("rfr_verification:");
    // @ts-expect-error — the id is a TUPLE [RecordId<"rfr_user">], not a bare string
    const _bad = () => EmailVerification.record().for("not-a-tuple");
    expect(typeof _bad).toBe("function");
  });

  test("singleton literal id survives a preset: get(Config) stays id-optional", () => {
    const Config = defineSingleton("rfr_config", {
      motd: s.string().optional(),
    }).use(timestamps());
    const { vars } = get(Config).toSQL();
    expect(String(vars.__thing)).toBe("rfr_config:default");
  });
});

describe(".for with refs returns the type::record fragment", () => {
  test("tuple with an event ref: for([e.after.id]) — Manuel's target spelling", () => {
    const T = User.event("rfr_ev", {
      then: (e) =>
        surql`UPSERT ${EmailVerification.record().for([e.after.id])} SET codeHash = 'x'`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain(
      "UPSERT type::record(rfr_verification, [$after.id]) SET codeHash = 'x'",
    );
  });

  test("the fragment carries binds for literal parts; plain values still make a RecordId", () => {
    const frag = EmailVerification.record().for([surql.$.after.id.as<never>()]);
    expect(frag.query).toBe("type::record(rfr_verification, [$after.id])");
    const plain = User.record().for("ada");
    expect(String(plain)).toBe("rfr_user:ada");
  });

  test("typed: a wrong-shaped ref is rejected", () => {
    const _bad = () =>
      // @ts-expect-error — the tuple element is a rfr_user RecordId; a string ref doesn't fit
      EmailVerification.record().for([surql.$.x.as<string>()]);
    expect(typeof _bad).toBe("function");
  });
});
