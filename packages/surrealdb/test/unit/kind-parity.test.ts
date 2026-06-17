// Kind-registry parity (docs/kind-registry-contract.md §3): the generic kind-registry path must reproduce
// the driver's INTERNAL clause-level engine (`diffSnapshots` over `buildSnapshot`) for the
// `table`/`index`/`event`/`function`/`access` kinds. We assert the STRONGEST statement — that
// `planKinds(registry, lowerAll(prev), lowerAll(next)).{up,down}` equals the `diffSnapshots` up/down —
// across add/change/remove of every kind, so the kind engines stay byte-exact with the engine they
// delegate to (and the test self-maintains: no hand-written DDL). At the Option-A flip the registry IS
// the production diff path (the old whole-DB `surrealDriver.diff` is gone), so this pins the wrapper.
//
// Each diff scenario touches ONE table, so statement order is unambiguous. Cross-table EMIT ordering is
// asserted separately via `emitKinds` (the registry uses dependency ordering — strictly more correct
// than the legacy insertion order, e.g. a RELATION emits after its endpoints).

import { describe, expect, test } from "bun:test";
import {
  buildKindDiff,
  emitKinds,
  planKinds,
  snapshotKinds,
  snapshotObjects,
} from "@schemic/core";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  s,
  surql,
  surrealDriver,
} from "@schemic/surrealdb";
import { schemaStruct } from "../../src/cli/lower";
import { structuredSnapshot } from "../../src/cli/structure";
import { diffSnapshots } from "../../src/cli/surreal-diff";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";

// Lib-authored tables/defs vs the src-typed signatures: cast at the seam (as buildSnapshot does).
// biome-ignore lint/suspicious/noExplicitAny: bridge the src-vs-lib TableDef duality at the test seam.
type AnyArr = any[];
// The driver's INTERNAL clause-level engine over the CANONICAL snapshot (`structuredSnapshot` — the
// SAME renderer the registry's `explode` uses, so divergences like DEFAULT quote style match).
const legacy = (
  prevT: AnyArr,
  nextT: AnyArr,
  prevD: AnyArr = [],
  nextD: AnyArr = [],
) => {
  const snap = (t: AnyArr, d: AnyArr) => structuredSnapshot(schemaStruct(t, d));
  const diff = diffSnapshots(snap(prevT, prevD), snap(nextT, nextD));
  return { up: diff.up, down: diff.down };
};
const registry = (
  prevT: AnyArr,
  nextT: AnyArr,
  prevD: AnyArr = [],
  nextD: AnyArr = [],
) => {
  const { up, down } = planKinds(
    surrealKinds,
    lowerAll(prevT, prevD),
    lowerAll(nextT, nextD),
  );
  return { up, down };
};

/** Assert the registry path == the fixed-slot path for a (prev -> next) schema change. */
const parity = (
  prevT: AnyArr,
  nextT: AnyArr,
  prevD: AnyArr = [],
  nextD: AnyArr = [],
) =>
  expect(registry(prevT, nextT, prevD, nextD)).toEqual(
    legacy(prevT, nextT, prevD, nextD),
  );

const User = () => defineTable("user", { id: s.string(), name: s.string() });

describe("table/field kind parity with surrealDriver.diff", () => {
  test("add a field", () => {
    parity(
      [User()],
      [
        defineTable("user", {
          id: s.string(),
          name: s.string(),
          email: s.email(),
        }),
      ],
    );
  });

  test("change a field type", () => {
    parity(
      [defineTable("user", { id: s.string(), name: s.string() })],
      [defineTable("user", { id: s.string(), name: s.string().optional() })],
    );
  });

  test("remove a field", () => {
    parity(
      [
        defineTable("user", {
          id: s.string(),
          name: s.string(),
          legacy: s.string(),
        }),
      ],
      [User()],
    );
  });

  test("add a field clause (DEFAULT) -> ALTER FIELD set/drop", () => {
    const prev = [defineTable("user", { id: s.string(), name: s.string() })];
    const next = [
      defineTable("user", {
        id: s.string(),
        name: s.string().$default("anon"),
      }),
    ];
    parity(prev, next);
    parity(next, prev); // the inverse (DROP DEFAULT)
  });

  test("COMPUTED change (OVERWRITE fallback inside the table kind)", () => {
    parity(
      [defineTable("t", { id: s.string(), c: s.string() })],
      [
        defineTable("t", {
          id: s.string(),
          c: s.string().$computed(surql`"x"`),
        }),
      ],
    );
  });

  test("table SCHEMAFULL <-> SCHEMALESS (table-head ALTER)", () => {
    const t = () => defineTable("t", { id: s.string() });
    parity([t()], [t().schemaless()]);
    parity([t().schemaless()], [t()]);
  });

  test("table COMMENT add/remove (table-head ALTER)", () => {
    const t = () => defineTable("t", { id: s.string() });
    parity([t()], [t().comment("note")]);
    parity([t().comment("note")], [t()]);
  });

  test("table TYPE change (NORMAL -> RELATION) OVERWRITE fallback", () => {
    parity([defineTable("t", { id: s.string() })], [defineRelation("t", {})]);
  });

  test("add a whole table (head + fields)", () => {
    parity(
      [User()],
      [User(), defineTable("post", { id: s.string(), title: s.string() })],
    );
  });

  test("remove a whole table", () => {
    parity(
      [User(), defineTable("post", { id: s.string(), title: s.string() })],
      [User()],
    );
  });

  test("mixed field add + change + remove in one table", () => {
    parity(
      [
        defineTable("user", {
          id: s.string(),
          name: s.string(),
          old: s.string(),
        }),
      ],
      [
        defineTable("user", {
          id: s.string(),
          name: s.string().optional(),
          email: s.email(),
        }),
      ],
    );
  });

  test("identical schema -> empty plan", () => {
    expect(registry([User()], [User()])).toEqual({ up: [], down: [] });
  });
});

describe("index kind parity", () => {
  test("add an index (field .unique())", () => {
    parity(
      [defineTable("t", { id: s.string(), code: s.string() })],
      [defineTable("t", { id: s.string(), code: s.string().unique() })],
    );
  });

  test("change an index (.index() -> .unique()) recreates", () => {
    parity(
      [defineTable("t", { id: s.string(), a: s.string().index() })],
      [defineTable("t", { id: s.string(), a: s.string().unique() })],
    );
  });

  test("composite table .index() add", () => {
    const base = () =>
      defineTable("m", { id: s.string(), a: s.string(), b: s.string() });
    parity([base()], [base().index("m_ab", ["a", "b"])]);
  });
});

describe("event kind parity", () => {
  const evented = () =>
    defineTable("user", { id: s.string(), n: s.int() }).event("on_n", {
      when: surql`$before.n != $after.n`,
      // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
      then: surql`UPDATE $after.id SET touched = true`,
    });

  test("add an event", () => {
    parity([defineTable("user", { id: s.string(), n: s.int() })], [evented()]);
  });

  test("change an event (DEFINE EVENT OVERWRITE)", () => {
    const changed = () =>
      defineTable("user", { id: s.string(), n: s.int() }).event("on_n", {
        when: surql`$before.n != $after.n`,
        // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
        then: surql`UPDATE $after.id SET touched = false`,
      });
    parity([evented()], [changed()]);
  });

  test("remove an event", () => {
    parity([evented()], [defineTable("user", { id: s.string(), n: s.int() })]);
  });
});

describe("cross-kind dependency ordering (emitKinds)", () => {
  const headers = (ddl: string[]) =>
    ddl.filter((l) => /^DEFINE (TABLE|INDEX|EVENT)/.test(l));
  const idx = (ddl: string[], re: RegExp) => ddl.findIndex((l) => re.test(l));

  test("an index + event cluster AFTER their table", () => {
    const t = defineTable("user", {
      id: s.string(),
      email: s.email().unique(),
    }).event(
      "ev",
      // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
      { then: surql`UPDATE $after.id SET seen = true` },
    );
    const up = emitKinds(surrealKinds, lowerAll([t]));
    const at = idx(up, /^DEFINE TABLE user/);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(idx(up, /^DEFINE INDEX/));
    expect(at).toBeLessThan(idx(up, /^DEFINE EVENT/));
  });

  test("a RELATION emits AFTER its in/out endpoint tables (deps graph)", () => {
    const user = defineTable("user", { id: s.string() });
    const post = defineTable("post", { id: s.string() });
    const wrote = defineRelation("wrote", {}).from(user).to(post);
    const up = headers(emitKinds(surrealKinds, lowerAll([wrote, user, post])));
    const rel = up.findIndex((l) => /DEFINE TABLE wrote/.test(l));
    expect(up.findIndex((l) => /DEFINE TABLE user/.test(l))).toBeLessThan(rel);
    expect(up.findIndex((l) => /DEFINE TABLE post/.test(l))).toBeLessThan(rel);
  });
});

describe("buildKindDiff + snapshot round-trip", () => {
  test("buildKindDiff reports add/change items + full, matching planKinds up/down", () => {
    const prev = lowerAll([User()]);
    const next = lowerAll([
      defineTable("user", {
        id: s.string(),
        name: s.string().optional(),
        email: s.email(),
      }),
      defineTable("post", { id: s.string(), title: s.string() }),
    ]);
    const diff = buildKindDiff(surrealKinds, prev, next);
    expect({ up: diff.up, down: diff.down }).toEqual(
      planKinds(surrealKinds, prev, next),
    );
    // PER-FIELD display (Manuel's call, via the table kind's displayItems): a changed table reports
    // FIELD-level items (not a coarse whole-table item) — name changed, email added.
    const items = diff.items ?? [];
    expect(items.find((i) => i.key === "field:user:name")?.op).toBe("change");
    expect(items.find((i) => i.key === "field:user:email")?.op).toBe("add");
    // A freshly-added table still surfaces its head + fields as add items.
    expect(items.find((i) => i.key === "table::post")?.op).toBe("add");
    expect((diff.full ?? []).map((s) => s.key)).toContain("field:post:title");
  });

  test("snapshotKinds -> JSON -> snapshotObjects round-trips to a zero diff", () => {
    const portable = lowerAll([
      defineTable("user", { id: s.string(), email: s.email().unique() }).event(
        "ev",
        // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
        { then: surql`UPDATE $after.id SET seen = true` },
      ),
    ]);
    const snap = snapshotKinds(portable);
    expect(Object.keys(snap.kinds).sort()).toEqual(["event", "index", "table"]);
    const restored = snapshotObjects(JSON.parse(JSON.stringify(snap)));
    expect(planKinds(surrealKinds, restored, portable)).toEqual({
      up: [],
      down: [],
    });
  });
});

describe("function kind parity (opaque)", () => {
  const add = () =>
    defineFunction("add", { a: s.int(), b: s.int() })
      .returns(s.int())
      .body(surql`RETURN $a + $b`);

  test("add a function", () => {
    parity([], [], [], [add()]);
  });

  test("change a function body (DEFINE FUNCTION OVERWRITE)", () => {
    const changed = defineFunction("add", { a: s.int(), b: s.int() })
      .returns(s.int())
      .body(surql`RETURN $a * $b`);
    parity([], [], [add()], [changed]);
  });

  test("remove a function", () => {
    parity([], [], [add()], []);
  });
});

describe("access kind parity (opaque)", () => {
  const acct = () => defineAccess("acct").record().signin(surql`SELECT 1`);

  test("add an access", () => {
    parity([], [], [], [acct()]);
  });

  test("change an access (DEFINE ACCESS OVERWRITE)", () => {
    const changed = defineAccess("acct").record().signin(surql`SELECT 2`);
    parity([], [], [acct()], [changed]);
  });

  test("remove an access", () => {
    parity([], [], [acct()], []);
  });
});

describe("fn:: dependency ordering (function emits before its caller)", () => {
  const fmt = () =>
    defineFunction("fmt", { v: s.string() })
      .returns(s.string())
      .body(surql`RETURN $v`);
  const fnIdx = (up: string[]) =>
    up.findIndex((l) => /^DEFINE FUNCTION fn::fmt/.test(l));

  test("before a table whose field COMPUTED calls it", () => {
    const t = defineTable("doc", {
      id: s.string(),
      slug: s.string().$computed(surql`fn::fmt(id)`),
    });
    const up = emitKinds(surrealKinds, lowerAll([t], [fmt()]));
    expect(fnIdx(up)).toBeGreaterThanOrEqual(0);
    expect(fnIdx(up)).toBeLessThan(
      up.findIndex((l) => /^DEFINE TABLE doc/.test(l)),
    );
  });

  test("before an event whose THEN calls it", () => {
    const t = defineTable("user", { id: s.string(), n: s.int() }).event("ev", {
      // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
      then: surql`UPDATE $after.id SET x = fn::fmt("y")`,
    });
    const up = emitKinds(surrealKinds, lowerAll([t], [fmt()]));
    expect(fnIdx(up)).toBeGreaterThanOrEqual(0);
    expect(fnIdx(up)).toBeLessThan(
      up.findIndex((l) => /^DEFINE EVENT ev/.test(l)),
    );
  });

  test("before an access whose SIGNIN calls it", () => {
    const check = defineFunction("fmt", { v: s.string() })
      .returns(s.string())
      .body(surql`RETURN $v`);
    const access = defineAccess("acct")
      .record()
      .signin(surql`SELECT * FROM user WHERE fn::fmt(email)`);
    const up = emitKinds(surrealKinds, lowerAll([], [check, access]));
    expect(fnIdx(up)).toBeGreaterThanOrEqual(0);
    expect(fnIdx(up)).toBeLessThan(
      up.findIndex((l) => /^DEFINE ACCESS acct/.test(l)),
    );
  });
});

// The flipped Driver shape: the production surreal driver IS the kind registry now — the whole-DB
// `lower`/`emit`/`diff`/`introspect`/`normalize`/`equal` methods are GONE, replaced by
// `registry`/`explode`/`introspectAll`. Smoke-test the new surface.
describe("flipped surrealDriver shape", () => {
  test("exposes registry + explode + introspectAll; drops the retired IR methods", () => {
    expect(surrealDriver.registry).toBe(surrealKinds);
    const objs = surrealDriver.explode(
      [
        defineTable("user", {
          id: s.string(),
          name: s.string().unique(),
        }),
      ] as never,
      [] as never,
    );
    // explode fans the table into a table object + its index, each tagged by kind.
    expect(objs.map((o) => o.kind).sort()).toEqual(["index", "table"]);
    expect(typeof surrealDriver.introspectAll).toBe("function");
    for (const m of [
      "lower",
      "emit",
      "diff",
      "introspect",
      "normalize",
      "equal",
    ]) {
      expect(
        (surrealDriver as unknown as Record<string, unknown>)[m],
      ).toBeUndefined();
    }
  });
});
