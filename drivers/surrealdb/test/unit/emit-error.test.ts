import { describe, expect, test } from "bun:test";
import { fromStandalone } from "../../src/cli/lower";
import { buildSnapshot } from "../../src/cli/surreal-diff";
import { emitDefStatement, emitTable } from "../../src/driver";
import { surql } from "../../src/index";
import {
  defineAccess,
  defineAnalyzer,
  defineFunction,
  defineTable,
  RecordAccessDef,
  type StandaloneDef,
  s,
} from "../../src/pure";

test("DEFINE ACCESS scope is a type-enforced first step (.onDatabase()/.onNamespace())", () => {
  // The type/clause methods don't exist until a scope is picked — a COMPILE error, which is the whole
  // point (you can't author an unscoped access). Kept in a never-called fn so tsc checks it but it
  // doesn't run (the methods genuinely aren't there at runtime).
  const _typeGate = () => {
    // @ts-expect-error — `.record()` is not on the pre-scope builder
    defineAccess("a").record();
    // @ts-expect-error — `.bearer()` is not on the pre-scope builder either
    defineAccess("a").bearer({ for: "user" });
    // The TYPE is an exclusive choice — once you pick one, the other switchers are gone:
    // @ts-expect-error — can't switch JWT → BEARER (types are mutually exclusive)
    defineAccess("a").onDatabase().jwt({ url: "u" }).bearer({ for: "user" });
    // RECORD-only clauses don't leak onto other types:
    // @ts-expect-error — `.signup()` is not on a BEARER access
    defineAccess("a").onDatabase().bearer({ for: "user" }).signup(surql`X`);
    // @ts-expect-error — `.withRefresh()` is not on a JWT access
    defineAccess("a").onDatabase().jwt({ url: "u" }).withRefresh();
    // RECORD is database-only — `.record()` isn't offered on the namespace stage:
    // @ts-expect-error — no `.record()` on ON NAMESPACE
    defineAccess("a").onNamespace().record();
    // The TYPE is a required, explicit step — no implicit-record shortcut:
    // @ts-expect-error — must call `.record()` before a RECORD clause
    defineAccess("a").onDatabase().signup(surql`X`);
  };
  void _typeGate;
  // Scope first, then the type:
  expect(emitDefStatement(defineAccess("a").onDatabase().record()).ddl).toBe(
    "DEFINE ACCESS a ON DATABASE TYPE RECORD;",
  );
});

test("emit defensively throws if an access somehow has no scope", () => {
  // The type-gate makes this unreachable via the public API; a directly-constructed access builder with
  // no scope still throws a clear error rather than emitting invalid DDL.
  expect(() =>
    emitDefStatement(new RecordAccessDef("a", { kind: { type: "record" } })),
  ).toThrow(/no scope set — call \.onDatabase\(\) or \.onNamespace\(\)/);
});

// --- incomplete defs teach, never crash (and are never silently dropped) -------------------------
describe("incomplete definitions", () => {
  // The public API type-gates these (see the `_typeGate` above), so a JS schema module or a bad cast
  // is how they reach the pipeline. They used to MIS-DISPATCH: a def with no `kind` fell through
  // `emitDefStatement` into `emitFunction` and died on `undefined is not an object (fn.config.body)`.
  const unscoped = () => defineAccess("account") as unknown as StandaloneDef;
  const noType = () =>
    defineAccess("account").onDatabase() as unknown as StandaloneDef;
  const noTypeNs = () =>
    defineAccess("account").onNamespace() as unknown as StandaloneDef;

  test("an access with no scope + no TYPE names the next call to make", () => {
    for (const go of [
      () => emitDefStatement(unscoped()),
      () => fromStandalone(unscoped()),
    ]) {
      expect(go).toThrow(/access "account" is incomplete/);
      expect(go).toThrow(/\.onDatabase\(\) or \.onNamespace\(\)/);
    }
  });

  test("a scoped access with no TYPE names only that scope's types", () => {
    expect(() => emitDefStatement(noType())).toThrow(
      /access "account" has no TYPE — call \.record\(\), \.jwt\(.+\) or \.bearer\(/,
    );
    expect(() => fromStandalone(noType())).toThrow(/has no TYPE/);
    // RECORD is database-only, so the namespace stage must not suggest it.
    expect(() => emitDefStatement(noTypeNs())).toThrow(
      /TYPE RECORD is database-only/,
    );
    expect(() => emitDefStatement(noTypeNs())).not.toThrow(/\.record\(\)/);
  });

  test("an incomplete access is COLLECTED, not silently dropped", () => {
    // core's loader duck-types `{ kind: string, name: string }`. Without a `kind` the unfinished
    // stage vanished from the schema and `ls`/`diff`/`pull` quietly ignored it — worse than a crash.
    const collected = (v: unknown) =>
      !!v &&
      typeof v === "object" &&
      typeof (v as { kind?: unknown }).kind === "string" &&
      typeof (v as { name?: unknown }).name === "string";
    expect(collected(defineAccess("account"))).toBe(true);
    expect(collected(defineAccess("account").onDatabase())).toBe(true);
    expect(collected(defineAccess("account").onNamespace())).toBe(true);
  });

  test("a bodyless function throws on BOTH lower and emit (never an empty block)", () => {
    // `lowerFunction` used to emit `block: "{}"`, landing an empty function in the snapshot while
    // `emitFunction` threw on the very same def.
    const bodyless = () => defineFunction("greet") as unknown as StandaloneDef;
    expect(() => emitDefStatement(bodyless())).toThrow(
      /function fn::greet has no body — call \.body\(/,
    );
    expect(() => fromStandalone(bodyless())).toThrow(
      /function fn::greet has no body — call \.body\(/,
    );
  });

  test("an unknown def kind is named, not mis-dispatched into a sibling emitter", () => {
    const bogus = { kind: "widget", name: "w" } as unknown as StandaloneDef;
    for (const go of [
      () => emitDefStatement(bogus),
      () => fromStandalone(bogus),
    ]) {
      expect(go).toThrow(/definition "w" has an unknown kind "widget"/);
      expect(go).toThrow(/event, access, analyzer, param, function/);
    }
  });

  test("defs that are legitimately clause-free still emit", () => {
    // Guard the guards: a bare analyzer is VALID SurrealQL (verified on 3.1.4), so it must not throw.
    expect(emitDefStatement(defineAnalyzer("english")).ddl).toBe(
      "DEFINE ANALYZER english;",
    );
  });
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
