/**
 * A small CRUD API over the live DB, to feel the spike in a realistic setting.
 * Decoded values (RecordId, Date) serialize cleanly to JSON via their toJSON().
 *
 * Run: SURREAL_PASS=... bun server.ts
 */
import { RecordId, surql } from "surrealdb";
import { connect } from "./src/db";
import { defineTable } from "./src/ddl";
import { Friend, User } from "./schema";

const db = await connect();
// Ensure the schema exists (idempotent).
await db.query(
  [defineTable(User, { exists: "overwrite" }), defineTable(Friend, { exists: "overwrite" })].join("\n"),
);

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const uid = (id: string) => new RecordId("user", id);

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/users": {
      GET: async () => {
        const [rows] = await db.query<[unknown[]]>(surql`SELECT * FROM user`);
        return json(rows.map((r) => User.decode(r)));
      },
      POST: async (req) => {
        const body = (await req.json()) as { name: string; email: string; bestFriend?: string };
        // id, createdAt and status are omitted on purpose -> filled by the DB.
        const content: Record<string, unknown> = { name: body.name, email: body.email };
        if (body.bestFriend) content.bestFriend = uid(body.bestFriend);
        const [rows] = await db.query<[unknown[]]>(surql`CREATE user CONTENT ${content}`);
        return json(User.decode(rows[0]), 201);
      },
    },
    "/users/:id": {
      GET: async (req) => {
        const [rows] = await db.query<[unknown[]]>(surql`SELECT * FROM ${uid(req.params.id)}`);
        return rows[0] ? json(User.decode(rows[0])) : json({ error: "not found" }, 404);
      },
      PATCH: async (req) => {
        const body = await req.json();
        const [rows] = await db.query<[unknown[]]>(surql`UPDATE ${uid(req.params.id)} MERGE ${body}`);
        return rows[0] ? json(User.decode(rows[0])) : json({ error: "not found" }, 404);
      },
      DELETE: async (req) => {
        await db.query(surql`DELETE ${uid(req.params.id)}`);
        return new Response(null, { status: 204 });
      },
    },
    "/users/:id/friends": {
      GET: async (req) => {
        const [rows] = await db.query<[unknown[]]>(
          surql`SELECT * FROM friend WHERE in = ${uid(req.params.id)}`,
        );
        return json(rows.map((r) => Friend.decode(r)));
      },
      POST: async (req) => {
        const body = (await req.json()) as { to: string; strength?: number };
        const [rows] = await db.query<[unknown[]]>(
          surql`RELATE ${uid(req.params.id)}->friend->${uid(body.to)} SET strength = ${body.strength ?? 0.5}`,
        );
        return json(Friend.decode(rows[0]), 201);
      },
    },
  },
  fetch: () => new Response("Not found", { status: 404 }),
});

console.log(`pure CRUD API listening on ${server.url}`);
