// Typed-fragments PHASE 0 (docs/proposals/typed-fragments.md): eager marker resolution in the
// surql tag (TableDef/Table/FunctionDef/surql.$ splice as TEXT; everything else binds), the
// surql.record/table/$/expr helpers, event THEN auto-blocking (multi-statement bodies wrap { ...; }
// matching INFO's canonical spelling), and lazy record refs s.recordId(() => Table).
import { setDefaultTimeout } from "bun:test";

// The workspace gate runs every package's suite IN PARALLEL — PGlite's CPU burst can slow live
// connects/DDL far past bun's 30s default, timing out beforeAll/afterAll hooks (reported as
// "(unnamed)" tests). Live work gets a generous ceiling; isolated runs are unaffected.
setDefaultTimeout(120_000);

import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { emitTable } from "../../src/ddl";
import { defineFunction, defineTable, s, surql } from "../../src/index";

const SendMail = defineFunction("frag_send_mail", {
  email: s.string(),
  code: s.string(),
})
  .returns(s.string())
  .body(surql`RETURN $email + ":" + $code`);

const User = defineTable("frag_user", {
  name: s.string(),
  email: s.string().$min(1),
});

const Verification = defineTable("frag_verification", {
  id: s.tuple([User.record()]),
  codeHash: s.string().$internal(),
  expiresAt: s.datetime(),
  attempts: s.int().$default(0),
});

describe("surql tag — eager marker resolution", () => {
  test("TableDef / FunctionDef / surql.$ splice as TEXT (no bindings)", () => {
    const q = surql`SELECT * FROM ${User} WHERE ${surql.$.after.email} != NONE AND ${SendMail}($x, $y)`;
    expect(q.query).toContain("FROM frag_user ");
    expect(q.query).toContain("$after.email != NONE");
    expect(q.query).toContain("fn::frag_send_mail($x, $y)");
    expect(Object.keys(q.bindings ?? {})).toHaveLength(0);
  });

  test("plain values still BIND as params; nested BoundQuery composes", () => {
    const inner = surql`age >= ${18}`;
    const q = surql`SELECT * FROM ${User} WHERE ${inner} AND name = ${"ada"}`;
    expect(q.query).toContain("FROM frag_user");
    expect(q.query).not.toContain("18"); // bound, not inlined
    expect(Object.values(q.bindings ?? {})).toContain(18);
    expect(Object.values(q.bindings ?? {})).toContain("ada");
  });

  test("surql.record builds type::record with the typed table ref", () => {
    const q = surql.record(Verification, surql`[$after.id]`);
    expect(q.query).toBe("type::record(frag_verification, [$after.id])");
  });

  test("surql.table splices the escaped name", () => {
    expect(surql.table(User).query).toBe("frag_user");
  });

  test("a single-table RecordIdField ref splices its table name", () => {
    const ref = s.recordId("frag_user");
    expect(surql`SELECT * FROM ${ref}`.query).toBe("SELECT * FROM frag_user");
  });
});

describe("event THEN auto-block", () => {
  test("a multi-statement then wraps { ...; } and collapses whitespace (INFO-canonical)", () => {
    const T = defineTable("frag_evt", { n: s.int() }).event("bump", {
      when: surql`$event = 'CREATE'`,
      then: surql`
        LET $x = $after.n + 1;
        UPDATE $after.id SET n = $x;
      `,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain(
      "THEN { LET $x = $after.n + 1; UPDATE $after.id SET n = $x; };",
    );
  });

  test("a single statement stays bare (trailing ; stripped)", () => {
    const T = defineTable("frag_evt1", { n: s.int() }).event("one", {
      then: surql`UPDATE $after.id SET n = 1;`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain("THEN UPDATE $after.id SET n = 1;");
    expect(ddl).not.toContain("{");
  });

  test("a ; inside a string literal does not trigger blocking", () => {
    const T = defineTable("frag_evt2", { note: s.string() }).event("lit", {
      then: surql`UPDATE $after.id SET note = 'a;b'`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain("THEN UPDATE $after.id SET note = 'a;b';");
    expect(ddl).not.toContain("THEN {");
  });

  test("an author-braced block passes through (whitespace collapsed)", () => {
    const T = defineTable("frag_evt3", { n: s.int() }).event("braced", {
      then: surql`{
        LET $x = 1;
        UPDATE $after.id SET n = $x;
      }`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain("THEN { LET $x = 1; UPDATE $after.id SET n = $x; };");
  });
});

describe("lazy record refs — s.recordId(() => Table)", () => {
  // Deliberately reference `Later` BEFORE its declaration: the thunk defers until emit, which is
  // exactly what breaks import cycles between mutually-linked table modules.
  const Early = defineTable("frag_early", {
    link: s.recordId(() => Later),
  });
  const Later = defineTable("frag_later", { name: s.string() });

  test("the thunk resolves at emit time — record<frag_later> in the DDL", () => {
    const ddl = emitTable(Early);
    expect(ddl).toContain(
      "DEFINE FIELD link ON TABLE frag_early TYPE record<frag_later>",
    );
  });

  test(".tables / .for() resolve lazily too", () => {
    const ref = s.recordId(() => Later);
    expect(ref.tables).toEqual(["frag_later"]);
    const rid = ref.for("x1");
    expect(rid).toBeInstanceOf(RecordId);
    expect(rid.table.name).toBe("frag_later");
  });

  test("runtime validation enforces the resolved table", () => {
    const ref = s.recordId(() => Later);
    expect(ref.schema.safeParse(new RecordId("frag_later", "a")).success).toBe(
      true,
    );
    expect(ref.schema.safeParse(new RecordId("frag_early", "a")).success).toBe(
      false,
    );
  });

  test("mixed arrays (eager + lazy) union in the DDL", () => {
    const T = defineTable("frag_mixed", {
      target: s.recordId([User, () => Later]),
    });
    expect(emitTable(T)).toContain("record<frag_user | frag_later>");
  });
});

// --- live (SURREAL_URL-gated): the full verification-event flow + auto-block drift check ---------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)(
  "phase-0 live — the dogfood verification flow, drift-free",
  () => {
    test("markers + auto-block apply, fire, and round-trip without phantom diffs", async () => {
      const { Surreal } = await import("surrealdb");
      const { emitDefStatement } = await import("../../src/ddl");
      const { explodeSchema, introspectAll } = await import(
        "../../src/kinds/explode"
      );
      const { deepEqual } = await import("../../src/cli/struct");

      const UserV = User.event("frag_issue_verification", {
        when: surql`$event = 'CREATE'`,
        then: surql`
        LET $code = string::uppercase(rand::string(8));
        UPSERT ${surql.record(Verification, surql`[$after.id]`)} CONTENT {
          codeHash: crypto::sha256($code),
          expiresAt: time::now() + 15m
        };
        ${SendMail}($after.email, $code);
      `,
      });

      const db = new Surreal();
      await db.connect(URL as string);
      await db.signin({ username: "root", password: "root" });
      await db.use({ namespace: "frag_p0", database: "frag_p0" });
      await db.query(
        "REMOVE TABLE IF EXISTS frag_user; REMOVE TABLE IF EXISTS frag_verification; REMOVE FUNCTION IF EXISTS fn::frag_send_mail;",
      );
      await db.query(emitDefStatement(SendMail, { exists: "overwrite" }).ddl);
      await db.query(emitTable(Verification, { exists: "overwrite" }));
      await db.query(emitTable(UserV, { exists: "overwrite" }));

      // The event fires end to end: CREATE user -> code row keyed by the user id.
      await db.query("CREATE frag_user:1 SET name = 'm', email = 'm@x.dev';");
      const [rows] = (await db.query(
        "SELECT expiresAt FROM frag_verification",
      )) as [unknown[]];
      expect(rows).toHaveLength(1);

      // Auto-block drift check: authored struct === introspected struct (scrubbed of undefined keys).
      const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
      const pick = (objs: { kind: string; name: string }[]) =>
        objs.find(
          (o) => o.kind === "table" && o.name === "frag_user",
        ) as unknown as { struct: unknown };
      const authored = pick(explodeSchema([UserV]));
      const live = pick(await introspectAll(db));
      expect(deepEqual(scrub(authored.struct), scrub(live.struct))).toBe(true);

      await db.query(
        "REMOVE TABLE IF EXISTS frag_user; REMOVE TABLE IF EXISTS frag_verification; REMOVE FUNCTION IF EXISTS fn::frag_send_mail;",
      );
      await db.close();
    });
  },
);
