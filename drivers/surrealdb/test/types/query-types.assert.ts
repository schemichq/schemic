// TYPE-COMPLETENESS ASSERTIONS for the SurrealDB query builder's inference (@ark/attest `attest<E,A>()`).
// Run under node/tsx (NOT bun — see packages/core/docs/TYPE-PERF-TESTING.md):
//   bun run --cwd drivers/surrealdb test:types
//
// `attest<Expected, Actual>()` fails to COMPILE if Actual isn't exactly Expected (and attest re-checks
// at runtime) — so a generic that silently drifts (Row dropping a field's stdlib, the content gate
// mis-firing, the schemaless collapse regressing) turns red here instead of downstream at a call site.
import { after, before, describe, it } from "node:test";
import { attest, setup, teardown } from "@ark/attest";
import { defineTable, s, surql } from "../../src/index";
import type { App } from "../../src/pure";
import type {
  CreateStart,
  Out,
  PendingCreate,
  Row,
  SchemalessTable,
  StatementKind,
} from "../../src/query";

// attest needs its checker set up once per run; bracket the suite. (Shared 6-line convention — copied
// verbatim from packages/core/test/types; see docs/TYPE-PERF-TESTING.md.)
let cleanup: (() => void) | undefined;
before(() => {
  cleanup = setup() as unknown as () => void;
});
after(() => {
  cleanup?.();
  teardown();
});

const User = defineTable("user", {
  name: s.string(),
  age: s.int(),
  bio: s.string().optional(),
  views: s.int().$default(surql`0`),
});
type U = typeof User;

// Every field optional/defaulted -> a contentless CREATE is valid (the content gate stays open).
const Note = defineTable("note", {
  body: s.string().optional(),
  views: s.int().$default(surql`0`),
});
type N = typeof Note;

describe("App — decoded row inference", () => {
  it("decodes each field to its app value type", () => {
    attest<string, App<U>["name"]>();
    attest<number, App<U>["age"]>();
    attest<string | undefined, App<U>["bio"]>();
  });
});

describe("Row — the callback ref proxy", () => {
  it("a number field carries the number stdlib (.plus)", () => {
    attest<true, Row<U>["age"] extends { plus: unknown } ? true : false>();
  });
  it("a string field carries the string stdlib (.length)", () => {
    attest<true, Row<U>["name"] extends { length: unknown } ? true : false>();
  });
  it("every field carries the base comparison ops (.eq)", () => {
    attest<true, Row<U>["age"] extends { eq: unknown } ? true : false>();
  });
});

describe("Out — output-mode result shape", () => {
  it("array by default", () => {
    attest<App<U>[], Out<App<U>, false>>();
  });
  it("single-or-undefined under .only()/.one()", () => {
    attest<App<U> | undefined, Out<App<U>, true>>();
  });
});

describe("CreateStart — the compile-time content gate", () => {
  it("a required-field table gates to PendingCreate (exactly)", () => {
    attest<PendingCreate<U>, CreateStart<U>>();
  });
  it("PendingCreate is NOT runnable — no `.run` until `.content()`", () => {
    // The real distinguisher: a CreateQuery has `.run`, a PendingCreate deliberately doesn't
    // (a plain `extends PendingCreate` can't tell them apart — CreateQuery structurally satisfies it).
    attest<false, CreateStart<U> extends { run: unknown } ? true : false>();
  });
  it("an all-optional table is runnable now (CreateQuery has `.run`)", () => {
    attest<true, CreateStart<N> extends { run: unknown } ? true : false>();
  });
});

describe("schemaless — the untyped collapse", () => {
  it("data collapses to Record<string, unknown>", () => {
    attest<
      true,
      App<SchemalessTable> extends Record<string, unknown> ? true : false
    >();
  });
  it("callback rows stay indexable (proxy of generic refs)", () => {
    attest<
      true,
      Row<SchemalessTable> extends Record<string, unknown> ? true : false
    >();
  });
});

describe("StatementKind — the runtime discriminant union", () => {
  it("is exactly the seven statement kinds", () => {
    attest<
      "select" | "create" | "update" | "upsert" | "delete" | "relate" | "count",
      StatementKind
    >();
  });
});
