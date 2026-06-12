import { describe, expect, test } from "bun:test";
// Import `sz`/`table` by package name (like the CLI does) so the table types line up with the
// `surreal-zod`-typed signatures in cli/diff (avoids src-vs-lib duplicate-declaration errors).
import {
  defineAccess,
  defineEvent,
  defineFunction,
  defineRelation,
  defineTable,
  emitTable,
  surql,
  sz,
} from "surreal-zod";
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

  test("change a field type: ALTER FIELD … TYPE up and down", () => {
    const prev = buildSnapshot([
      defineTable("user", { id: sz.string(), name: sz.string() }),
    ]);
    const next = buildSnapshot([
      defineTable("user", { id: sz.string(), name: sz.string().optional() }),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.up[0]).toBe(
      "ALTER FIELD name ON TABLE user TYPE option<string>;",
    );
    expect(diff.down[0]).toBe("ALTER FIELD name ON TABLE user TYPE string;");
  });

  test("add a field clause -> ALTER sets it; remove -> ALTER DROPs it", () => {
    const prev = buildSnapshot([
      defineTable("user", { id: sz.string(), name: sz.string() }),
    ]);
    const next = buildSnapshot([
      defineTable("user", {
        id: sz.string(),
        name: sz.string().$default("anon"),
      }),
    ]);
    expect(diffSnapshots(prev, next).up[0]).toBe(
      'ALTER FIELD name ON TABLE user DEFAULT "anon";',
    );
    // the inverse removes the default with an explicit DROP:
    expect(diffSnapshots(next, prev).up[0]).toBe(
      "ALTER FIELD name ON TABLE user DROP DEFAULT;",
    );
  });

  test("COMPUTED change falls back to DEFINE … OVERWRITE (no ALTER form)", () => {
    const prev = buildSnapshot([
      defineTable("t", { id: sz.string(), c: sz.string() }),
    ]);
    const next = buildSnapshot([
      defineTable("t", {
        id: sz.string(),
        c: sz.string().$computed(surql`"x"`),
      }),
    ]);
    expect(diffSnapshots(prev, next).up[0]).toContain(
      "DEFINE FIELD OVERWRITE c",
    );
  });

  test("changed index -> REMOVE + DEFINE (ALTER INDEX can't change fields)", () => {
    const prev = buildSnapshot([
      defineTable("t", { id: sz.string(), a: sz.string().index() }),
    ]);
    const next = buildSnapshot([
      defineTable("t", { id: sz.string(), a: sz.string().unique() }),
    ]);
    const up = diffSnapshots(prev, next).up;
    expect(up.some((s) => s.startsWith("REMOVE INDEX"))).toBe(true);
    expect(up.some((s) => /^DEFINE INDEX .*UNIQUE;$/.test(s))).toBe(true);
  });

  test("table SCHEMAFULL<->SCHEMALESS change -> ALTER TABLE", () => {
    const prev = buildSnapshot([defineTable("t", { id: sz.string() })]); // schemafull default
    const next = buildSnapshot([
      defineTable("t", { id: sz.string() }).schemaless(),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.up[0]).toBe("ALTER TABLE t SCHEMALESS;");
    expect(diff.down[0]).toBe("ALTER TABLE t SCHEMAFULL;");
  });

  test("table COMMENT add -> ALTER TABLE … COMMENT; remove -> DROP COMMENT", () => {
    const prev = buildSnapshot([defineTable("t", { id: sz.string() })]);
    const next = buildSnapshot([
      defineTable("t", { id: sz.string() }).comment("note"),
    ]);
    expect(diffSnapshots(prev, next).up[0]).toBe(
      'ALTER TABLE t COMMENT "note";',
    );
    expect(diffSnapshots(next, prev).up[0]).toBe("ALTER TABLE t DROP COMMENT;");
  });

  test("table TYPE change (NORMAL -> RELATION) falls back to OVERWRITE", () => {
    const prev = buildSnapshot([defineTable("t", { id: sz.string() })]);
    const next = buildSnapshot([defineRelation("t", {})]);
    expect(diffSnapshots(prev, next).up[0]).toContain(
      "DEFINE TABLE OVERWRITE t",
    );
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
    // No source file in this fixture → the section falls back to the bare object name.
    expect(patch).toContain("diff --git a/user b/user");
    expect(patch).toContain("--- a/user");
    expect(patch).toContain("+++ b/user");
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
      then: [
        surql`UPDATE $after.id SET a = 1`,
        surql`UPDATE $after.id SET b = 2`,
      ],
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

describe("functions", () => {
  const User = defineTable("user", { id: sz.string() });
  const ddlOf = (fn: ReturnType<typeof defineFunction>) =>
    diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [fn])).up[0];

  test("emits DEFINE FUNCTION with sz-typed args + returns, permissions, comment", () => {
    const greet = defineFunction("greet", { name: sz.string() })
      .returns(sz.string())
      .body(surql`RETURN "Hi " + $name`)
      .permissions(false)
      .comment("greeter");
    expect(ddlOf(greet)).toBe(
      `DEFINE FUNCTION fn::greet($name: string) -> string { RETURN "Hi " + $name } PERMISSIONS NONE COMMENT "greeter";`,
    );
  });

  test("sz-typed args infer SurrealQL types (record/int), bare body is braced", () => {
    const fn = defineFunction("touch", {
      who: User.record(),
      n: sz.int(),
    }).body(surql`UPDATE $who SET hits = $n`);
    expect(ddlOf(fn)).toBe(
      "DEFINE FUNCTION fn::touch($who: record<user>, $n: int) { UPDATE $who SET hits = $n };",
    );
  });

  test("a surql`{ … }` block body is not double-braced", () => {
    const fn = defineFunction("noop", {}).body(surql`{ RETURN NONE }`);
    expect(ddlOf(fn)).toBe("DEFINE FUNCTION fn::noop() { RETURN NONE };");
  });

  test("adding a function → DEFINE FUNCTION up / REMOVE FUNCTION down", () => {
    const fn = defineFunction("add", { a: sz.int(), b: sz.int() })
      .returns(sz.int())
      .body(surql`RETURN $a + $b`);
    const diff = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [fn]));
    expect(diff.up).toEqual([
      "DEFINE FUNCTION fn::add($a: int, $b: int) -> int { RETURN $a + $b };",
    ]);
    expect(diff.down).toEqual(["REMOVE FUNCTION IF EXISTS fn::add;"]);
  });

  test("a function with no body throws on emit", () => {
    const fn = defineFunction("bad", {});
    expect(() => buildSnapshot([], [fn])).toThrow(/has no body/);
  });

  test("summarizeKinds counts functions", () => {
    const fn = defineFunction("f", {}).body(surql`RETURN 1`);
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [fn])).up;
    expect(summarizeKinds(up)).toBe("1 function");
  });
});

describe("access", () => {
  const ddlOf = (a: ReturnType<typeof defineAccess>) =>
    diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [a])).up[0];

  test("emits DEFINE ACCESS RECORD with auto-braced SIGNUP/SIGNIN + DURATION", () => {
    const account = defineAccess("account")
      .record()
      .signup(surql`CREATE user CONTENT { email: $email }`)
      .signin(surql`SELECT * FROM user WHERE email = $email`)
      .duration({ token: "1h", session: "12h" });
    expect(ddlOf(account)).toBe(
      "DEFINE ACCESS account ON DATABASE TYPE RECORD " +
        "SIGNUP { CREATE user CONTENT { email: $email } } " +
        "SIGNIN { SELECT * FROM user WHERE email = $email } " +
        "DURATION FOR TOKEN 1h, FOR SESSION 12h;",
    );
  });

  test("adding access → DEFINE ACCESS up / REMOVE ACCESS down", () => {
    const a = defineAccess("account").record().signin(surql`SELECT 1`);
    const diff = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [a]));
    expect(diff.up[0]).toContain(
      "DEFINE ACCESS account ON DATABASE TYPE RECORD",
    );
    expect(diff.down).toEqual(["REMOVE ACCESS IF EXISTS account ON DATABASE;"]);
  });

  test("summarizeKinds counts access", () => {
    const a = defineAccess("a").record().signin(surql`SELECT 1`);
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([], [a])).up;
    expect(summarizeKinds(up)).toBe("1 access");
  });

  test("TYPE JWT with alg + key, and with a JWKS url", () => {
    const sym = defineAccess("api")
      .jwt({ alg: "HS512", key: "secret" })
      .duration({ token: "1h" });
    expect(ddlOf(sym)).toBe(
      `DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM HS512 KEY "secret" DURATION FOR TOKEN 1h;`,
    );
    const jwks = defineAccess("api2").jwt({
      url: "https://example.com/jwks.json",
    });
    expect(ddlOf(jwks)).toBe(
      `DEFINE ACCESS api2 ON DATABASE TYPE JWT URL "https://example.com/jwks.json";`,
    );
  });

  test("TYPE BEARER FOR RECORD/USER with grant duration", () => {
    const svc = defineAccess("svc")
      .bearer({ for: "record" })
      .duration({ grant: "30d", session: "12h" });
    expect(ddlOf(svc)).toBe(
      "DEFINE ACCESS svc ON DATABASE TYPE BEARER FOR RECORD " +
        "DURATION FOR GRANT 30d, FOR SESSION 12h;",
    );
    expect(ddlOf(defineAccess("u").bearer({ for: "user" }))).toBe(
      "DEFINE ACCESS u ON DATABASE TYPE BEARER FOR USER;",
    );
  });
});

describe("batch 1: set / computed / changefeed / count", () => {
  test("sz.set() emits set<T> (distinct from array<T>)", () => {
    const t = defineTable("t", {
      id: sz.string(),
      tags: sz.set(sz.string()),
      arr: sz.array(sz.string()),
    });
    const ddl = emitTable(t);
    expect(ddl).toContain("DEFINE FIELD tags ON TABLE t TYPE set<string>;");
    expect(ddl).toContain("DEFINE FIELD arr ON TABLE t TYPE array<string>;");
  });

  test("$computed emits a COMPUTED field; option<> is stripped", () => {
    const t = defineTable("person", {
      id: sz.string(),
      first: sz.string(),
      last: sz.string(),
      full: sz
        .string()
        .optional()
        .$computed(surql`string::concat(first, " ", last)`),
    });
    expect(emitTable(t)).toContain(
      `DEFINE FIELD full ON TABLE person TYPE string COMPUTED string::concat(first, " ", last);`,
    );
  });

  test(".changefeed() folds into the DEFINE TABLE head", () => {
    expect(
      emitTable(defineTable("a", { id: sz.string() }).changefeed("3d")),
    ).toContain("SCHEMAFULL CHANGEFEED 3d;");
    expect(
      emitTable(
        defineTable("b", { id: sz.string() }).changefeed("1h", {
          includeOriginal: true,
        }),
      ),
    ).toContain("CHANGEFEED 1h INCLUDE ORIGINAL;");
  });

  test("COUNT index emits no FIELDS clause", () => {
    const t = defineTable("c", { id: sz.string() }).index("rows", [], {
      count: true,
    });
    const up = diffSnapshots(EMPTY_SNAPSHOT, buildSnapshot([t])).up;
    expect(up).toContain("DEFINE INDEX rows ON TABLE c COUNT;");
  });
});
