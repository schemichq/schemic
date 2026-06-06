import { surql } from "surrealdb";
import { type App, relation, sz, table, type Wire } from "surreal-zod";

/**
 * Shared, isomorphic data model for the project/task tracker. Imported by the
 * admin migration (`setup.ts`), the bun tests, and the browser app alike.
 *
 * Exercises: smart record ids, record links + arrays of links, nested objects
 * with per-field `$default`, enums (status/priority/role), datetime, duration,
 * and DB-side `$default` / `$assert` / `$readonly` / `$comment` / `$value`.
 *
 * NOTE: there is no `passhash` field here on purpose — it is internal to record
 * access and must never appear in the app type. It is defined via raw SurrealQL
 * in `setup.ts` (with `PERMISSIONS NONE`). See DX-FINDINGS.md.
 */

/** End users. `id` omitted -> `record<user>` with a DB-generated id. */
export const User = table("user", {
  name: sz.string().$assert(surql`string::len($value) > 0`),
  email: sz.email(),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly().$comment("Signup time"),
}).comment("Application end users");

/** Projects owned by a user; `owner` defaults to the signed-in user and is fixed. */
export const Project = table("project", {
  owner: User.record().$default(surql`$auth.id`).$readonly(),
  name: sz.string().$assert(surql`string::len($value) > 0`),
  description: sz.string().optional(),
  color: sz.string().$default("#6366f1"),
  tags: sz.string().array().$default(surql`[]`),
  settings: sz
    .object({
      isPublic: sz.boolean().$default(surql`false`),
      defaultView: sz.enum(["list", "board"]).$default("list"),
    })
    .$default(surql`{}`),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
}).comment("Project workspaces");

/** Tasks within a project. Demonstrates enums, duration, links + arrays of links. */
export const Task = table("task", {
  project: Project.record(),
  title: sz.string().$assert(surql`string::len($value) > 0`).$comment("Short summary"),
  description: sz.string().optional(),
  status: sz.enum(["todo", "in_progress", "done", "archived"]).$default("todo"),
  priority: sz.enum(["low", "medium", "high", "urgent"]).$default("medium"),
  /** Estimated effort (Surreal `duration`, e.g. `2h`, `3d`). */
  estimate: sz.duration().optional(),
  assignees: User.record().array().$default(surql`[]`),
  labels: sz.string().array().$default(surql`[]`),
  dueAt: sz.datetime().optional(),
  completedAt: sz.datetime().optional().nullable(),
  createdBy: User.record().$default(surql`$auth.id`).$readonly(),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
  /** Always stamped on every write via a DB-side VALUE clause. */
  updatedAt: sz.datetime().$value(surql`time::now()`).optional(),
}).comment("Project tasks");

/** Comments on a task; `author` defaults to the signed-in user and is fixed. */
export const Comment = table("comment", {
  task: Task.record(),
  author: User.record().$default(surql`$auth.id`).$readonly(),
  body: sz.string().$assert(surql`string::len($value) > 0`),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly().$comment("When posted"),
}).comment("Task comments");

/** Graph: user ->member-> project, carrying a membership role. */
export const Member = relation("member", {
  role: sz.enum(["owner", "editor", "viewer"]).$default("viewer"),
  since: sz.datetime().$default(surql`time::now()`).$readonly(),
})
  .from(User)
  .to(Project);

/** Graph: user ->watch-> task (notifications / follows). */
export const Watch = relation("watch", {
  since: sz.datetime().$default(surql`time::now()`).$readonly(),
})
  .from(User)
  .to(Task);

/** Graph: task ->depends_on-> task. */
export const DependsOn = relation("depends_on", {
  kind: sz.enum(["blocks", "relates_to"]).$default("blocks"),
})
  .from(Task)
  .to(Task);

/** Every table/relation, in dependency order, for migrations. */
export const tables = [User, Project, Task, Comment, Member, Watch, DependsOn];

// --- App (decoded) and Wire (DB) types ---
export type User = App<typeof User>;
export type UserRow = Wire<typeof User>;
export type Project = App<typeof Project>;
export type ProjectRow = Wire<typeof Project>;
export type Task = App<typeof Task>;
export type TaskRow = Wire<typeof Task>;
export type Comment = App<typeof Comment>;
export type Member = App<typeof Member>;
export type Watch = App<typeof Watch>;
export type DependsOn = App<typeof DependsOn>;
