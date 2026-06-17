// Slice 2 parity (docs/kind-registry-contract.md §3): the generic kind-registry path must reproduce
// the fixed-slot `surrealDriver.diff` for the `table`/`index`/`event` kinds. We assert the STRONGEST
// statement — that `planKinds(registry, lowerAll(prev), lowerAll(next)).{up,down}` equals
// `surrealDriver.diff(lower(prev), lower(next)).{up,down}` — across add/change/remove of every kind, so
// the engines stay byte-exact with the production path (and the test self-maintains: no hand-written DDL).
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
  defineRelation,
  defineTable,
  s,
  surql,
  surrealDriver,
} from "@schemic/surrealdb";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";

// Lib-authored tables/defs vs the driver's src-typed signatures: cast at the seam (as buildSnapshot does).
// biome-ignore lint/suspicious/noExplicitAny: bridge the src-vs-lib TableDef duality at the test seam.
type AnyArr = any[];
const legacy = (
  prevT: AnyArr,
  nextT: AnyArr,
  prevD: AnyArr = [],
  nextD: AnyArr = [],
) => {
  const prev = surrealDriver.lower(prevT, prevD);
  const next = surrealDriver.lower(nextT, nextD);
  const d = surrealDriver.diff(prev, next);
  return { up: d.up, down: d.down };
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
    const items = diff.items ?? [];
    expect(items.find((i) => i.key === "table::user")?.op).toBe("change");
    expect(items.find((i) => i.key === "table::post")?.op).toBe("add");
    expect((diff.full ?? []).map((s) => s.key)).toContain("table::post");
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
