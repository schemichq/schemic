import { describe, expect, test } from "bun:test";
// Import `sz`/`table` by package name (like the CLI does) so the table types line up with the
// `surreal-zod`-typed signatures in cli/diff (avoids src-vs-lib duplicate-declaration errors).
import { defineEvent, defineTable, emitTable, surql, sz } from "surreal-zod";
import {
  buildSnapshot,
  diffSnapshots,
  formatPatch,
  renderMigration,
  summarizeKinds,
  tokenDiff,
} from "../../src/cli/diff";
import { EMPTY_SNAPSHOT } from "../../src/cli/meta";

const User = defineTable("user", { id: sz.string(), name: sz.string() });

describe("diff engine", () => {
  test("from empty: defines table + fields up, drops table down", () => {
    const diff = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([User]));
    expect(diff.up.some((s) => s.includes("DEFINE TABLE user"))).toBe(true);
    expect(
      diff.up.some((s) => s.includes("DEFINE FIELD name ON TABLE user")),
    ).toBe(true);
    expect(diff.down).toContain("REMOVE TABLE IF EXISTS user;");
    // tables are defined before their fields
    expect(diff.up.findIndex((s) => s.includes("DEFINE TABLE"))).toBeLessThan(
      diff.up.findIndex((s) => s.includes("DEFINE FIELD")),
    );
  });

  test("groups statements by table (each table's fields follow its DEFINE TABLE)", () => {
    const A = defineTable("a", { id: sz.string(), x: sz.string() });
    const B = defineTable("b", { id: sz.string(), y: sz.string() });
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([A, B])).up;
    const at = up.findIndex((s) => /DEFINE TABLE a\b/.test(s));
    const ax = up.findIndex((s) => /FIELD x ON TABLE a\b/.test(s));
    const bt = up.findIndex((s) => /DEFINE TABLE b\b/.test(s));
    const by = up.findIndex((s) => /FIELD y ON TABLE b\b/.test(s));
    // a's field comes before b's table — i.e. grouped, not all-tables-then-all-fields.
    expect(at).toBeLessThan(ax);
    expect(ax).toBeLessThan(bt);
    expect(bt).toBeLessThan(by);
  });

  test("add a field: only the new field up, REMOVE FIELD down", () => {
    const prev = buildSnapshot([User]);
    const next = buildSnapshot([
      defineTable("user", {
        id: sz.string(),
        name: sz.string(),
        email: sz.email(),
      }),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.up).toHaveLength(1);
    expect(diff.up[0]).toContain("DEFINE FIELD email ON TABLE user");
    expect(diff.down[0]).toContain(
      "REMOVE FIELD IF EXISTS email ON TABLE user",
    );
  });

  test("change a field: OVERWRITE to new up, OVERWRITE to old down", () => {
    const prev = buildSnapshot([
      defineTable("user", { id: sz.string(), name: sz.string() }),
    ]);
    const next = buildSnapshot([
      defineTable("user", { id: sz.string(), name: sz.string().optional() }),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.up[0]).toContain("DEFINE FIELD OVERWRITE name");
    expect(diff.up[0]).toContain("option<string>");
    expect(diff.down[0]).toContain("DEFINE FIELD OVERWRITE name");
    expect(diff.down[0]).not.toContain("option<string>");
  });

  test("remove a table: REMOVE TABLE up (no orphan field removes), re-define down", () => {
    const diff = diffSnapshots(buildSnapshot([User]), EMPTY_SNAPSHOT);
    expect(diff.up).toContain("REMOVE TABLE IF EXISTS user;");
    expect(diff.up.some((s) => s.includes("REMOVE FIELD"))).toBe(false);
    expect(diff.down.some((s) => s.includes("DEFINE TABLE user"))).toBe(true);
  });

  test("no changes: empty diff", () => {
    const snap = buildSnapshot([User]);
    expect(diffSnapshots(snap, snap).up).toHaveLength(0);
  });

  test("renderMigration wraps statements in an IF $direction up/down branch", () => {
    const m = renderMigration("0001_x", {
      up: ["DEFINE TABLE x TYPE NORMAL SCHEMAFULL;"],
      down: ["REMOVE TABLE IF EXISTS x;"],
    });
    expect(m).toContain('IF $direction = "up" {');
    expect(m).toContain("} ELSE {");
    expect(m).toContain("DEFINE TABLE x");
    expect(m).toContain("REMOVE TABLE IF EXISTS x;");
  });
});

describe("display items", () => {
  test("diffSnapshots tags each object as add / remove / change", () => {
    const before = defineTable("user", {
      id: sz.string(),
      name: sz.string(),
      legacy: sz.string(),
    });
    const after = defineTable("user", {
      id: sz.string(),
      name: sz.string().optional(),
      email: sz.email(),
    });
    const items = diffSnapshots(
      buildSnapshot([before]),
      buildSnapshot([after]),
    ).items;
    const byOp = (op: string) => items?.filter((i) => i.op === op) ?? [];
    expect(byOp("add").map((i) => i.key)).toContain("field:user:email");
    expect(byOp("remove").map((i) => i.key)).toContain("field:user:legacy");
    const change = byOp("change")[0];
    expect(change.key).toBe("field:user:name");
    if (change.op === "change") {
      expect(change.before).toContain("TYPE string;");
      expect(change.after).toContain("option<string>");
    }
  });
});

describe("tokenDiff", () => {
  test("colorless output marks removed/added tokens git-style ([-…-]{+…+})", () => {
    // NO_COLOR → git `--word-diff=plain` markers, so removed-vs-added is unambiguous + assertable.
    const prev = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(
        tokenDiff(
          "DEFINE FIELD x ON TABLE t TYPE string;",
          "DEFINE FIELD x ON TABLE t TYPE option<string>;",
        ),
      ).toBe("DEFINE FIELD x ON TABLE t TYPE [-string;-] {+option<string>;+}");
    } finally {
      if (prev === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev;
    }
  });
});

describe("formatPatch (unified diff)", () => {
  test("emits per-table .sql hunks with -/+ lines (removes show the old DEFINE)", () => {
    const before = defineTable("user", {
      id: sz.string(),
      name: sz.string(),
      legacy: sz.string(),
    });
    const after = defineTable("user", {
      id: sz.string(),
      name: sz.string().optional(),
      email: sz.email(),
    });
    const patch = formatPatch(
      diffSnapshots(buildSnapshot([before]), buildSnapshot([after])),
    );
    expect(patch).toContain("diff --git a/Table: user b/Table: user");
    expect(patch).toContain("--- a/Table: user");
    expect(patch).toContain("+++ b/Table: user");
    expect(patch).toContain("-DEFINE FIELD name ON TABLE user TYPE string;");
    expect(patch).toContain(
      "+DEFINE FIELD name ON TABLE user TYPE option<string>;",
    );
    // a removed field shows the dropped DEFINE, not the `REMOVE` statement
    expect(patch).toContain("-DEFINE FIELD legacy ON TABLE user TYPE string;");
    expect(patch).not.toContain("REMOVE FIELD");
    expect(patch).toContain("+DEFINE FIELD email ON TABLE user");
  });

  test("no changes → empty patch", () => {
    const snap = buildSnapshot([defineTable("u", { id: sz.string() })]);
    expect(formatPatch(diffSnapshots(snap, snap))).toBe("");
  });
});

describe("indexes", () => {
  const Indexed = defineTable("member", {
    id: sz.string(),
    email: sz.email().unique(),
    handle: sz.string().index(),
    first: sz.string(),
    last: sz.string(),
  }).index("member_full_name", ["first", "last"]);

  test("field .unique()/.index() and table .index() emit DEFINE INDEX", () => {
    const ddl = emitTable(Indexed);
    expect(ddl).toContain(
      "DEFINE INDEX member_email_idx ON TABLE member FIELDS email UNIQUE;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX member_handle_idx ON TABLE member FIELDS handle;",
    );
    expect(ddl).toContain(
      "DEFINE INDEX member_full_name ON TABLE member FIELDS first, last;",
    );
  });

  test("diff orders create as table → fields → indexes; remove is the reverse", () => {
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([Indexed])).up;
    const firstField = up.findIndex((s) => s.startsWith("DEFINE FIELD"));
    const firstIndex = up.findIndex((s) => s.startsWith("DEFINE INDEX"));
    expect(up.findIndex((s) => s.startsWith("DEFINE TABLE"))).toBeLessThan(
      firstField,
    );
    expect(firstField).toBeLessThan(firstIndex);

    const removeUp = diffSnapshots(buildSnapshot([Indexed]), EMPTY_SNAPSHOT).up;
    // dropping the whole table covers its fields + indexes — only REMOVE TABLE remains
    expect(removeUp).toEqual(["REMOVE TABLE IF EXISTS member;"]);
  });

  test("adding just an index → one DEFINE INDEX up / REMOVE INDEX down", () => {
    const before = defineTable("t", { id: sz.string(), code: sz.string() });
    const after = defineTable("t", {
      id: sz.string(),
      code: sz.string().unique(),
    });
    const diff = diffSnapshots(buildSnapshot([before]), buildSnapshot([after]));
    expect(diff.up).toEqual([
      "DEFINE INDEX t_code_idx ON TABLE t FIELDS code UNIQUE;",
    ]);
    expect(diff.down).toEqual([
      "REMOVE INDEX IF EXISTS t_code_idx ON TABLE t;",
    ]);
  });

  test("summarizeKinds counts indexes", () => {
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([Indexed])).up;
    expect(summarizeKinds(up)).toBe("1 table, 4 fields, 3 indexes");
  });
});

describe("events", () => {
  const Evented = defineTable("user", {
    id: sz.string(),
    email: sz.email(),
    verified: sz.boolean(),
  })
    .event("reverify", {
      when: surql`$before.email != $after.email`,
      then: surql`UPDATE $after.id SET verified = false`,
    })
    .event("log_changes", {
      then: [surql`UPDATE $after.id SET a = 1`, surql`UPDATE $after.id SET b = 2`],
    });

  test(".event() emits DEFINE EVENT with WHEN + THEN", () => {
    expect(emitTable(Evented)).toContain(
      "DEFINE EVENT reverify ON TABLE user WHEN $before.email != $after.email THEN UPDATE $after.id SET verified = false;",
    );
  });

  test("an omitted WHEN emits no WHEN; multiple THENs are parenthesized", () => {
    expect(emitTable(Evented)).toContain(
      "DEFINE EVENT log_changes ON TABLE user THEN (UPDATE $after.id SET a = 1), (UPDATE $after.id SET b = 2);",
    );
  });

  test("adding an event → DEFINE EVENT up / REMOVE EVENT down", () => {
    const before = defineTable("t", { id: sz.string(), n: sz.int() });
    const after = before.event("on_n", {
      when: surql`$before.n != $after.n`,
      then: surql`UPDATE $after.id SET touched = true`,
    });
    const diff = diffSnapshots(buildSnapshot([before]), buildSnapshot([after]));
    expect(diff.up).toEqual([
      "DEFINE EVENT on_n ON TABLE t WHEN $before.n != $after.n THEN UPDATE $after.id SET touched = true;",
    ]);
    expect(diff.down).toEqual(["REMOVE EVENT IF EXISTS on_n ON TABLE t;"]);
  });

  test("diff orders create as table → fields → … → events", () => {
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([Evented])).up;
    const lastField = up.findLastIndex((s) => s.startsWith("DEFINE FIELD"));
    const firstEvent = up.findIndex((s) => s.startsWith("DEFINE EVENT"));
    expect(lastField).toBeLessThan(firstEvent);
  });

  test("summarizeKinds counts events", () => {
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([Evented])).up;
    expect(summarizeKinds(up)).toBe("1 table, 2 fields, 2 events");
  });

  test("standalone defineEvent compiles to the same statement as inline .event()", () => {
    const Base = defineTable("user", { id: sz.string(), email: sz.email() });
    const inline = Base.event("reverify", {
      when: surql`$before.email != $after.email`,
      then: surql`UPDATE $after.id SET verified = false`,
    });
    const standalone = defineEvent(Base, "reverify", {
      when: surql`$before.email != $after.email`,
      then: surql`UPDATE $after.id SET verified = false`,
    });
    const key = "event:user:reverify";
    expect(buildSnapshot([Base], [standalone]).statements[key].ddl).toBe(
      buildSnapshot([inline]).statements[key].ddl,
    );
  });

  test("standalone events ride into buildSnapshot's second arg", () => {
    const Base = defineTable("user", { id: sz.string(), n: sz.int() });
    const ev = defineEvent(Base, "on_n", {
      then: surql`UPDATE $after.id SET touched = true`,
    });
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([Base], [ev])).up;
    expect(up).toContain(
      "DEFINE EVENT on_n ON TABLE user THEN UPDATE $after.id SET touched = true;",
    );
  });
});
