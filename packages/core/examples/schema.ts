import { surql } from "surrealdb";
import { z } from "zod";
import { type App, defineRelation, defineTable, s, type Wire } from "../src";

/**
 * Showcase data model for a tiny blog / social app. Demonstrates: smart record
 * ids, record links, arrays of links, chained graph relations, DB-side
 * defaults/asserts/readonly, schemafull + comment config, and derived shapes.
 */

/** Users — schemafull, with DB-managed timestamps and status. */
export const User = defineTable("user", {
  id: z.string(), // -> record<user> with a string id
  name: s.string(),
  email: s.email(),
  bio: s.string().optional().$comment("Short profile blurb"),
  settings: s.object({
    theme: s.string().$default(surql`"light"`),
    notifications: s.boolean().$default(surql`true`),
    lastSeen: s.datetime().optional(),
  }),
  status: s.string().$default(surql`"pending"`),
  role: s.enum(["admin", "member"]).$default(surql`"member"`),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
  bestFriend: s.recordId("user").optional(),
}).comment("Application users");

/** Tags — a simple lookup table with string ids. */
export const Tag = defineTable("tag", {
  id: z.string(),
  label: s.string(),
  slug: s.string(),
});

/** Posts — id omitted (defaults to record<post>); link to one author and many tags. */
export const Post = defineTable("post", {
  author: User.record(), // record<user>
  title: s.string(),
  body: s.string(),
  tags: Tag.record().array(), // array<record<tag>>
  published: s.boolean().$default(surql`false`),
  views: s.number().$default(surql`0`).$readonly(),
  publishedAt: s.datetime().optional(),
  createdAt: s.datetime().$default(surql`time::now()`).$readonly(),
}).comment("Blog posts");

/** Comments — link a post and its author. */
export const Comment = defineTable("comment", {
  post: Post.record(),
  author: User.record(),
  body: s.string(),
  createdAt: s.datetime().$default(surql`time::now()`),
});

/** Graph relation: user ->friend-> user. */
export const Friend = defineRelation("friend", {
  since: s.datetime().$default(surql`time::now()`),
  strength: s.number().$assert(surql`$value >= 0 AND $value <= 1`),
})
  .from(User)
  .to(User);

/** Graph relation: user ->liked-> post. */
export const Liked = defineRelation("liked", {
  at: s.datetime().$default(surql`time::now()`),
})
  .from(User)
  .to(Post);

/** Derived shapes — same field metadata, different field sets. */
export const PublicUser = User.omit("email", "status"); // safe to expose
export const UserPatch = User.omit("id", "createdAt").partial(); // PATCH body

// Inferred types
export type User = App<typeof User>;
export type UserRow = Wire<typeof User>;
export type Post = App<typeof Post>;
export type PublicUser = App<typeof PublicUser>;
