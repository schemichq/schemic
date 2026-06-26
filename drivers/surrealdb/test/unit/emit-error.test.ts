import { describe, expect, test } from "bun:test";
import { buildSnapshot } from "../../src/cli/surreal-diff";
import { emitDefStatement, emitTable } from "../../src/driver";
import { surql } from "../../src/index";
import { AccessDef, defineAccess, defineTable, s } from "../../src/pure";

test("DEFINE ACCESS scope is a type-enforced first step (.onDatabase()/.onNamespace())", () => {
  // The type/clause methods don't exist until a scope is picked — a COMPILE error, which is the whole
  // point (you can't author an unscoped access). Kept in a never-called fn so tsc checks it but it
  // doesn't run (the methods genuinely aren't there at runtime).
  const _typeGate = () => {
    // @ts-expect-error — `.record()` is not on the pre-scope builder
    defineAccess("a").record();
    // @ts-expect-error — `.bearer()` is not on the pre-scope builder either
    defineAccess("a").bearer({ for: "user" });
  };
  void _typeGate;
  // Scope first, then the type:
  expect(emitDefStatement(defineAccess("a").onDatabase().record()).ddl).toBe(
    "DEFINE ACCESS a ON DATABASE TYPE RECORD;",
  );
});

test("emit defensively throws if an access somehow has no scope", () => {
  // The type-gate makes this unreachable via the public API; a directly-constructed AccessDef with no
  // scope still throws a clear error rather than emitting invalid DDL.
  expect(() => emitDefStatement(new AccessDef("a"))).toThrow(
    /no scope set — call \.onDatabase\(\) or \.onNamespace\(\)/,
  );
});

test("a non-Surreal field type error names the field + table", () => {
  const Bad = defineTable("widget", {
    id: s.string(),
    // s.custom() has no SurrealQL mapping — defineTable rejects it at compile time (that's the
    // point); here we assert the RUNTIME error pins the field + table.
    // @ts-expect-error intentional no-DDL field
    blob: s.custom(),
  });
  const tables = [Bad] as unknown as Parameters<typeof buildSnapshot>[0];
  expect(() => buildSnapshot(tables)).toThrow(/field "blob" on table "widget"/);
});

// --- DEFINE FIELD validation guards (reject combos SurrealDB's parser rejects, at gen not apply) ---
describe("field validation guards", () => {
  const T = (field: s.Field, schemafull = true) => {
    const t = defineTable("t", { x: field });
    return () => emitTable(schemafull ? t.schemafull() : t.schemaless());
  };

  test("$computed is mutually exclusive with $value/$default/$readonly/$assert/$reference", () => {
    expect(T(s.string().$computed(surql`1`).$default(surql`0`))).toThrow(
      /\$computed can't be combined with \$default/,
    );
    expect(T(s.string().$computed(surql`1`).$readonly())).toThrow(
      /\$computed can't be combined with \$readonly/,
    );
    expect(T(s.string().$computed(surql`1`).$value(surql`$value`))).toThrow(
      /\$computed can't be combined with \$value/,
    );
    expect(T(s.string().$computed(surql`1`).$assert(surql`true`))).toThrow(
      /\$computed can't be combined with \$assert/,
    );
  });

  test("$reference needs a record-link type, and only on a top-level field", () => {
    expect(T(s.string().$reference())).toThrow(
      /\$reference needs a record-link type/,
    );
    // a real record link is fine:
    expect(() =>
      emitTable(
        defineTable("t", { x: s.recordId("post").$reference() }).schemafull(),
      ),
    ).not.toThrow();
  });

  test("FLEXIBLE requires a SCHEMAFULL table", () => {
    expect(T(s.object({ a: s.string() }).flexible(), false)).toThrow(
      /FLEXIBLE is only valid on a SCHEMAFULL table/,
    );
    expect(() =>
      emitTable(
        defineTable("t", {
          x: s.object({ a: s.string() }).flexible(),
        }).schemafull(),
      ),
    ).not.toThrow();
  });

  test("a valid $computed field (alone) still emits", () => {
    expect(
      emitTable(
        defineTable("t", {
          full: s.string().$computed(surql`a + b`),
        }).schemafull(),
      ),
    ).toContain("COMPUTED a + b");
  });
});
