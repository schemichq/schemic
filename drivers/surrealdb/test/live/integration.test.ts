import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RecordId, surql } from "surrealdb";
import { z } from "zod";
import {
  introspectStructured,
  structuredSnapshot,
} from "../../src/cli/structure";
import { emitDefStatement, emitTable } from "../../src/ddl";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  s,
} from "../../src/pure";
import { tryConnect } from "../helpers";

/**
 * End-to-end checks against a real SurrealDB. Skipped automatically when no DB is
 * reachable. Tables are prefixed `it_` and dropped on entry to stay isolated.
 */
const db = await tryConnect();
const live = describe.skipIf(!db);
if (!db)
  console.warn("[live] SurrealDB unreachable — skipping integration tests");

const User = defineTable("it_user", {
  id: z.string(),
  name: s.string(),
  status: s.string().$default(surql`"pending"`),
  role: s.enum(["admin", "member"]).$default(surql`"member"`),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
});

const Native = defineTable("it_native", {
  id: z.string(),
  tag: s.uuid(),
  data: s.bytes(),
  when: s.datetime(),
});

const Friend = defineRelation("it_friend", { strength: s.number() })
  .from(User)
  .to(User);

live("CRUD + codecs against a live DB", () => {
  beforeAll(async () => {
    const ddl = [User, Native, Friend]
      .map((t) => emitTable(t, { exists: "overwrite" }))
      .join("\n");
    await db!.query(ddl);
    await db!.query(surql`DELETE it_friend; DELETE it_user; DELETE it_native;`);
  });

  test("CREATE fills DB-side defaults; decode yields app types", async () => {
    const id = User.record().for("alice");
    await db!.query(
      surql`CREATE ${id} CONTENT ${User.encode({ name: "Alice" })}`,
    );

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    const u = User.decode(rows[0]);
    expect(u.id).toBeInstanceOf(RecordId);
    expect(u.name).toBe("Alice");
    expect(u.status).toBe("pending"); // DB default
    expect(u.role).toBe("member"); // DB default
    expect(u.createdAt).toBeInstanceOf(Date); // datetime -> Date
  });

  test("encodePartial MERGE updates a field", async () => {
    const id = User.record().for("alice");
    await db!.query(
      surql`UPDATE ${id} MERGE ${User.encodePartial({ role: "admin" })}`,
    );

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    expect(User.decode(rows[0]).role).toBe("admin");
  });

  test("native round-trip: uuid + bytes + datetime through the DB", async () => {
    const id = Native.record().for("n1");
    const tag = "0190b6e0-1234-7890-abcd-ef0123456789";
    await db!.query(
      surql`CREATE ${id} CONTENT ${Native.encode({
        tag,
        data: new Uint8Array([1, 2, 3]),
        when: new Date("2022-01-01T00:00:00.000Z"),
      })}`,
    );

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    const n = Native.decode(rows[0]);
    expect(n.tag).toBe(tag); // Uuid -> string
    expect(n.data).toBeInstanceOf(Uint8Array); // DB returns ArrayBuffer -> normalized
    expect(Array.from(n.data)).toEqual([1, 2, 3]);
    expect(n.when).toBeInstanceOf(Date);
    expect(n.when.toISOString()).toBe("2022-01-01T00:00:00.000Z");
  });

  test("RELATE + decode of an edge record", async () => {
    const alice = User.record().for("alice");
    const bob = User.record().for("bob");
    await db!.query(
      surql`CREATE ${bob} CONTENT ${User.encode({ name: "Bob" })}`,
    );
    await db!.query(
      surql`RELATE ${alice}->it_friend->${bob} SET strength = 0.9`,
    );

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM it_friend`);
    const f = Friend.decode(rows[0]);
    expect(f.in).toBeInstanceOf(RecordId);
    expect(f.out).toBeInstanceOf(RecordId);
    expect(f.in.table.name).toBe("it_user");
    expect(f.strength).toBe(0.9);
  });

  test("graph traversal", async () => {
    const alice = User.record().for("alice");
    const [res] = await db!.query<[{ friends: string[] }[]]>(
      surql`SELECT ->it_friend->it_user.name AS friends FROM ${alice}`,
    );
    expect(res[0]?.friends).toContain("Bob");
  });
});

const Evented = defineTable("it_evented", {
  id: z.string(),
  email: s.email(),
  verified: s.boolean().$default(surql`false`),
}).event("it_reverify", {
  when: surql`$before.email != $after.email`,
  // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable
  then: surql`UPDATE $after.id SET verified = false`,
});

live("event DDL introspects + round-trips", () => {
  beforeAll(async () => {
    await db!.query(emitTable(Evented, { exists: "overwrite" }));
  });
  afterAll(async () => {
    await db?.query("REMOVE TABLE IF EXISTS it_evented;");
  });

  test("INFO … STRUCTURE reports the event; the snapshot canonicalizes it", async () => {
    const { tables } = await introspectStructured(db!);
    const t = tables.find((t) => t.name === "it_evented");
    const ev = t?.events.find((e) => e.name === "it_reverify");
    expect(ev?.when).toBe("$before.email != $after.email");
    expect(ev?.then).toEqual(["UPDATE $after.id SET verified = false"]);

    const ddl = structuredSnapshot({
      tables: [t!],
      functions: [],
      accesses: [],
      analyzers: [],
    }).statements["event:it_evented:it_reverify"]?.ddl;
    expect(ddl).toBe(
      "DEFINE EVENT it_reverify ON TABLE it_evented WHEN $before.email != $after.email THEN UPDATE $after.id SET verified = false;",
    );
  });

  test("re-applying the emitted DDL is idempotent (no diff --live drift)", async () => {
    const key = "event:it_evented:it_reverify";
    const before = structuredSnapshot(await introspectStructured(db!));
    await db!.query(emitTable(Evented, { exists: "overwrite" }));
    const after = structuredSnapshot(await introspectStructured(db!));
    expect(after.statements[key].ddl).toBe(before.statements[key].ddl);
  });
});

const Greeter = defineFunction("it_greet", { name: s.string() })
  .returns(s.string())
  .body(surql`RETURN "Hi " + $name`);

live("function DDL introspects + round-trips", () => {
  beforeAll(async () => {
    await db!.query(emitDefStatement(Greeter, { exists: "overwrite" }).ddl);
  });
  afterAll(async () => {
    await db?.query("REMOVE FUNCTION IF EXISTS fn::it_greet;");
  });

  test("INFO FOR DB STRUCTURE reports the function; the snapshot canonicalizes it", async () => {
    const { functions } = await introspectStructured(db!);
    const fn = functions.find((f) => f.name === "it_greet");
    expect(fn?.args).toEqual([["name", "string"]]);
    expect(fn?.returns).toBe("string");

    const ddl = structuredSnapshot({
      tables: [],
      functions: fn ? [fn] : [],
      accesses: [],
      analyzers: [],
    }).statements["function::it_greet"]?.ddl;
    expect(ddl).toContain(
      "DEFINE FUNCTION fn::it_greet($name: string) -> string {",
    );
  });

  test("re-applying the emitted DDL is idempotent (no diff --live drift)", async () => {
    const key = "function::it_greet";
    const before = structuredSnapshot(await introspectStructured(db!));
    await db!.query(emitDefStatement(Greeter, { exists: "overwrite" }).ddl);
    const after = structuredSnapshot(await introspectStructured(db!));
    expect(after.statements[key].ddl).toBe(before.statements[key].ddl);
  });
});

const Accesses = [
  defineAccess("it_app")
    .onDatabase()
    .record()
    .signin(surql`SELECT * FROM it_user WHERE email = $email`)
    .duration({ token: "1h", session: "12h" }),
  defineAccess("it_jwt")
    .onDatabase()
    .jwt({ alg: "HS512", key: "supersecretvalue" }),
  defineAccess("it_svc")
    .onDatabase()
    .bearer({ for: "record" })
    .duration({ grant: "30d" }),
];

live("access DDL (record/jwt/bearer) introspects + round-trips", () => {
  beforeAll(async () => {
    for (const a of Accesses)
      await db!.query(emitDefStatement(a, { exists: "overwrite" }).ddl);
  });
  afterAll(async () => {
    for (const n of ["it_app", "it_jwt", "it_svc"])
      await db?.query(`REMOVE ACCESS IF EXISTS ${n} ON DATABASE;`);
  });

  test("INFO FOR DB STRUCTURE reports all three access types", async () => {
    const { accesses } = await introspectStructured(db!);
    const mine = accesses.filter((a) => a.name.startsWith("it_"));
    expect(mine.map((a) => `${a.name}:${a.kind.kind}`).sort()).toEqual([
      "it_app:RECORD",
      "it_jwt:JWT",
      "it_svc:BEARER",
    ]);
  });

  test("re-applying is idempotent (no diff --live drift)", async () => {
    const snap = () =>
      introspectStructured(db!).then((s) => structuredSnapshot(s).statements);
    const before = await snap();
    for (const a of Accesses)
      await db!.query(emitDefStatement(a, { exists: "overwrite" }).ddl);
    const after = await snap();
    for (const n of ["it_app", "it_jwt", "it_svc"])
      expect(after[`access::${n}`].ddl).toBe(before[`access::${n}`].ddl);
  });
});

// A preset-composed table: preset columns + AND-combined permissions + appended event/index. The
// live check matters because combined perms are NESTED surql compositions — verify the emitted
// DDL applies cleanly and round-trips drift-free through INFO … STRUCTURE.
const Tenanted = defineTable("it_preset", {
  id: z.string(),
  title: s.string(),
})
  .permissions({ select: true, update: surql`user = $auth.id`, delete: false })
  .use(
    defineTable.preset({
      columns: { org_id: s.string().$readonly() },
      permissions: surql`org_id != NONE`,
      events: [
        {
          name: "it_preset_guard",
          when: surql`$event = 'UPDATE'`,
          // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable
          then: surql`RETURN true`,
        },
      ],
      indexes: [{ name: "it_by_org", fields: ["org_id"] }],
    }),
  );

live("preset-composed table applies + round-trips", () => {
  beforeAll(async () => {
    await db!.query(emitTable(Tenanted, { exists: "overwrite" }));
  });
  afterAll(async () => {
    await db?.query("REMOVE TABLE IF EXISTS it_preset;");
  });

  test("INFO … STRUCTURE reports the preset column, event, and index", async () => {
    const { tables } = await introspectStructured(db!);
    const t = tables.find((t) => t.name === "it_preset");
    expect(t?.fields.map((f) => f.name)).toContain("org_id");
    expect(t?.events.find((e) => e.name === "it_preset_guard")).toBeDefined();
    expect(t?.indexes.find((i) => i.name === "it_by_org")).toBeDefined();
  });

  test("authored struct === introspected struct (no diff --live phantom)", async () => {
    const { explodeSchema, introspectAll } = await import(
      "../../src/kinds/explode"
    );
    const { deepEqual } = await import("../../src/cli/struct");
    const pick = (objs: { kind: string; name: string }[]) =>
      objs.find(
        (o) => o.kind === "table" && o.name === "it_preset",
      ) as unknown as { struct: unknown };
    const authored = pick(explodeSchema([Tenanted]));
    const live = pick(await introspectAll(db!));
    // JSON round-trip drops `undefined`-valued keys (the authored side carries them; the
    // introspected side doesn't) — the pipeline's decisive compare is the canonical DDL anyway
    // (next test); this guards the VALUE-level phantom class (combined-perm parens, expr spellings).
    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
    expect(deepEqual(scrub(authored.struct), scrub(live.struct))).toBe(true);
  });

  test("re-applying the emitted DDL is idempotent (combined perms round-trip)", async () => {
    const snap = () =>
      introspectStructured(db!).then((s) => structuredSnapshot(s).statements);
    const before = await snap();
    await db!.query(emitTable(Tenanted, { exists: "overwrite" }));
    const after = await snap();
    for (const key of Object.keys(before).filter((k) =>
      k.includes("it_preset"),
    ))
      expect(after[key]?.ddl).toBe(before[key].ddl);
    // The combined update rule survived the DB round-trip intact (DB-canonical, paren-free).
    const tableDdl = before["table::it_preset"]?.ddl ?? "";
    expect(tableDdl).toContain("user = $auth.id AND org_id != NONE");
  });
});

// Single teardown for the shared connection (each describe above uses it in turn).
afterAll(async () => {
  await db?.close();
});
