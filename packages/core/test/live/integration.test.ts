import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import { RecordId, surql } from "surrealdb";
import { defineTable } from "../../src/ddl";
import { relation, sz, table } from "../../src/pure";
import { tryConnect } from "../helpers";

/**
 * End-to-end checks against a real SurrealDB. Skipped automatically when no DB is
 * reachable. Tables are prefixed `it_` and dropped on entry to stay isolated.
 */
const db = await tryConnect();
const live = describe.skipIf(!db);
if (!db) console.warn("[live] SurrealDB unreachable — skipping integration tests");

const User = table("it_user", {
  id: z.string(),
  name: sz.string(),
  status: sz.string().$default(surql`"pending"`),
  role: sz.enum(["admin", "member"]).$default(surql`"member"`),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
});

const Native = table("it_native", {
  id: z.string(),
  tag: sz.uuid(),
  data: sz.bytes(),
  when: sz.datetime(),
});

const Friend = relation("it_friend", { strength: sz.number() }).from(User).to(User);

live("CRUD + codecs against a live DB", () => {
  beforeAll(async () => {
    const ddl = [User, Native, Friend]
      .map((t) => defineTable(t, { exists: "overwrite" }))
      .join("\n");
    await db!.query(ddl);
    await db!.query(surql`DELETE it_friend; DELETE it_user; DELETE it_native;`);
  });

  afterAll(async () => {
    await db?.close();
  });

  test("CREATE fills DB-side defaults; decode yields app types", async () => {
    const id = User.record().make("alice");
    await db!.query(surql`CREATE ${id} CONTENT ${User.encode({ name: "Alice" })}`);

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    const u = User.decode(rows[0]);
    expect(u.id).toBeInstanceOf(RecordId);
    expect(u.name).toBe("Alice");
    expect(u.status).toBe("pending"); // DB default
    expect(u.role).toBe("member"); // DB default
    expect(u.createdAt).toBeInstanceOf(Date); // datetime -> Date
  });

  test("encodePartial MERGE updates a field", async () => {
    const id = User.record().make("alice");
    await db!.query(surql`UPDATE ${id} MERGE ${User.encodePartial({ role: "admin" })}`);

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    expect(User.decode(rows[0]).role).toBe("admin");
  });

  test("native round-trip: uuid + bytes + datetime through the DB", async () => {
    const id = Native.record().make("n1");
    const tag = "0190b6e0-1234-7890-abcd-ef0123456789";
    await db!.query(surql`CREATE ${id} CONTENT ${Native.encode({
      tag,
      data: new Uint8Array([1, 2, 3]),
      when: new Date("2022-01-01T00:00:00.000Z"),
    })}`);

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM ${id}`);
    const n = Native.decode(rows[0]);
    expect(n.tag).toBe(tag); // Uuid -> string
    expect(n.data).toBeInstanceOf(Uint8Array); // DB returns ArrayBuffer -> normalized
    expect(Array.from(n.data)).toEqual([1, 2, 3]);
    expect(n.when).toBeInstanceOf(Date);
    expect(n.when.toISOString()).toBe("2022-01-01T00:00:00.000Z");
  });

  test("RELATE + decode of an edge record", async () => {
    const alice = User.record().make("alice");
    const bob = User.record().make("bob");
    await db!.query(surql`CREATE ${bob} CONTENT ${User.encode({ name: "Bob" })}`);
    await db!.query(surql`RELATE ${alice}->it_friend->${bob} SET strength = 0.9`);

    const [rows] = await db!.query<[unknown[]]>(surql`SELECT * FROM it_friend`);
    const f = Friend.decode(rows[0]);
    expect(f.in).toBeInstanceOf(RecordId);
    expect(f.out).toBeInstanceOf(RecordId);
    expect(f.in.table.name).toBe("it_user");
    expect(f.strength).toBe(0.9);
  });

  test("graph traversal", async () => {
    const alice = User.record().make("alice");
    const [res] = await db!.query<[{ friends: string[] }[]]>(
      surql`SELECT ->it_friend->it_user.name AS friends FROM ${alice}`,
    );
    expect(res[0]?.friends).toContain("Bob");
  });
});
