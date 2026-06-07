/**
 * Live showcase: generates the schema DDL, applies it, then exercises CRUD,
 * record links, arrays of links, graph relations + traversal, and derived shapes.
 *
 * Run: SURREAL_PASS=... bun demo.ts
 */
import { surql } from "surrealdb";
import { defineTable } from "../src";
import { connect } from "./db";
import { Comment, Friend, Liked, Post, PublicUser, Tag, User } from "./schema";

const rule = (t: string) => console.log(`\n─── ${t} ${"─".repeat(Math.max(0, 52 - t.length))}`);

rule("Generated schema (DDL)");
const ddl = [User, Tag, Post, Comment, Friend, Liked]
  .map((t) => defineTable(t, { exists: "overwrite" }))
  .join("\n");
console.log(ddl);

const db = await connect();
await db.query(ddl);
await db.query(surql`DELETE liked; DELETE friend; DELETE comment; DELETE post; DELETE tag; DELETE user;`);

rule("Create users — User.encode() builds the CONTENT payload");
const alice = User.record().make("alice");
const bob = User.record().make("bob");
// encode() input: id/status/role/createdAt are optional (DB-filled); name/email/settings required.
await db.query(surql`CREATE ${alice} CONTENT ${User.encode({
  name: "Alice",
  email: "alice@example.com",
  bio: "Builder",
  settings: { theme: "dark", notifications: true, lastSeen: new Date() },
})}`);
await db.query(surql`CREATE ${bob} CONTENT ${User.encode({
  name: "Bob",
  email: "bob@example.com",
  settings: { theme: "light", notifications: false },
})}`);
const [userRows] = await db.query<[unknown[]]>(surql`SELECT * FROM user ORDER BY name`);
for (const row of userRows) {
  const u = User.decode(row);
  const seen = u.settings.lastSeen instanceof Date ? "Date" : "—";
  console.log(`  ${String(u.id)}  role=${u.role}  status=${u.status}  theme=${u.settings.theme}  lastSeen=${seen}`);
}

rule("Update — User.encodePartial() (id & readonly createdAt excluded by the type)");
await db.query(surql`UPDATE ${alice} MERGE ${User.encodePartial({ role: "admin", bio: "Builder & maintainer" })}`);
const [aliceRow] = await db.query<[unknown[]]>(surql`SELECT * FROM ${alice}`);
const updated = User.decode(aliceRow[0]);
console.log(`  alice role=${updated.role}  bio="${updated.bio}"`);

rule("Post — author link + array<record<tag>>");
const ts = Tag.record().make("ts");
const dbTag = Tag.record().make("db");
await db.query(surql`
  CREATE ${ts} SET label = "TypeScript", slug = "typescript";
  CREATE ${dbTag} SET label = "SurrealDB", slug = "surrealdb";
`);
const [postRows] = await db.query<[unknown[]]>(surql`
  CREATE post SET author = ${alice}, title = "Hello, Surreal", body = "First post!",
    tags = ${[ts, dbTag]}, published = true, publishedAt = time::now()
`);
const post = Post.decode(postRows[0]);
console.log("  author:", String(post.author));
console.log("  tags:  ", post.tags.map(String).join(", "));
console.log("  views:", post.views, "| published:", post.published, "| publishedAt is Date:", post.publishedAt instanceof Date);

rule("Comment");
const [commentRows] = await db.query<[unknown[]]>(
  surql`CREATE comment SET post = ${post.id}, author = ${bob}, body = "Great first post!"`,
);
const comment = Comment.decode(commentRows[0]);
console.log(" ", String(comment.author), "->", String(comment.post), ":", comment.body);

rule("Graph relations (friend, liked)");
await db.query(surql`RELATE ${alice}->friend->${bob} SET strength = 0.8`);
await db.query(surql`RELATE ${bob}->liked->${post.id}`);
const [friendRows] = await db.query<[unknown[]]>(surql`SELECT * FROM friend`);
const friend = Friend.decode(friendRows[0]);
console.log("  friend:", String(friend.in), "->", String(friend.out), "strength", friend.strength, "| since Date:", friend.since instanceof Date);
const [likedRows] = await db.query<[unknown[]]>(surql`SELECT * FROM liked`);
console.log("  liked.at is Date:", Liked.decode(likedRows[0]).at instanceof Date);

rule("Graph traversal — Alice's friends");
const [traversal] = await db.query<[{ friends: string[] }[]]>(
  surql`SELECT ->friend->user.name AS friends FROM ${alice}`,
);
console.log("  ", traversal);

rule("Derived shape — PublicUser (omit email + status)");
const publicUser = PublicUser.decode(userRows[0]);
console.log("  keys:", Object.keys(publicUser).join(", "));

await db.close();
