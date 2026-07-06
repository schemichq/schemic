// `.record().for(...)` is the ZOD-side VALUE helper — it builds a concrete RecordId from LOCAL
// data (Manuel's ruling: query-time refs are not values; the fragment spelling is
// `surql.record(Table, [e.after.id])`). Refs in `.for` throw guidance instead of silently
// constructing garbage. And `.use(preset)` no longer widens a declared id type (the tuple /
// singleton literal survives presets), which is what made `.for` look untyped.
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

describe(".for is values-only (refs throw guidance; fragments spell surql.record)", () => {
  test("plain values build a RecordId", () => {
    const plain = User.record().for("ada");
    expect(String(plain)).toBe("rfr_user:ada");
  });

  test("a query-time ref in .for is a compile error AND throws guidance at runtime", () => {
    expect(() =>
      EmailVerification.record().for([
        // @ts-expect-error — refs are not local values; use surql.record
        surql.$.after.id,
      ]),
    ).toThrow(/surql\.record/);
  });

  test("the fragment spelling stays surql.record(Table, [e.after.id])", () => {
    const T = User.event("rfr_ev", {
      then: (e) =>
        surql`UPSERT ${surql.record(EmailVerification, [e.after.id])} SET codeHash = 'x'`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain(
      "UPSERT type::record(rfr_verification, [$after.id]) SET codeHash = 'x'",
    );
  });
});
