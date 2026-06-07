import { surql } from "surrealdb";
import { type App, relation, sz, table, type Wire } from "surreal-zod";

/**
 * Shared, isomorphic data model for the project/task tracker. Imported by the
 * admin migration (`setup.ts`), the bun tests, and the browser app alike.
 *
 * Exercises: smart record ids, record links + arrays of links, nested objects
 * with per-field `$default`, enums (status/priority/role), datetime, duration,
 * DB-side `$default` / `$readonly` / `$comment` / `$value`, per-table row-level
 * `.permissions(...)`, and DB `ASSERT`s — both auto-baked by format builders
 * (`sz.email()` -> `string::is_email`) and authored via `$`-constraints (`.$min(1)`).
 *
 * NOTE: `passhash` is modeled with `.$internal()`: it still emits its `DEFINE FIELD`
 * (so the SCHEMAFULL SIGNUP write succeeds) plus `PERMISSIONS NONE`, but is excluded
 * from the app type and the create/update input. Server/system code reaches it via
 * `User.system`. See DX-FINDINGS.md #2.
 *
 * NOTE: per-table `PERMISSIONS` now live here via `.permissions({...})` and are folded
 * into the single generated `DEFINE TABLE` (no more raw `DEFINE TABLE OVERWRITE …
 * PERMISSIONS` in `setup.ts`). Omitted ops default to NONE (deny) at the table level.
 * `DEFINE ACCESS` (record signup/signin) is still raw in `setup.ts`. See DX-FINDINGS.md #1/#3.
 */

/** End users. `id` omitted -> `record<user>` with a DB-generated id. */
export const User = table("user", {
  name: sz.string().$min(1),
  // sz.email() bakes `ASSERT string::is_email($value)` for free (3.x validator).
  email: sz.email(),
  // DB-managed, client-hidden: written by the record-access SIGNUP block, never exposed.
  passhash: sz.string().$internal(),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly().$comment("Signup time"),
})
  .comment("Application end users")
  .permissions({
    select: surql`$auth.id != NONE`,
    create: false,
    update: surql`id = $auth.id`,
    delete: "same as update",
  });

/** Projects owned by a user; `owner` defaults to the signed-in user and is fixed. */
export const Project = table("project", {
  owner: User.record().$default(surql`$auth.id`).$readonly(),
  name: sz.string().$min(1),
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
})
  .comment("Project workspaces")
  .permissions({
    // Visible to its owner, anyone if public, or a member (via the graph).
    select: surql`owner = $auth.id OR settings.isPublic = true OR id IN $auth->member->project`,
    create: surql`owner = $auth.id`,
    update: "same as create",
    delete: "same as create",
  });

/** Tasks within a project. Demonstrates enums, duration, links + arrays of links. */
export const Task = table("task", {
  project: Project.record(),
  title: sz.string().$min(1).$comment("Short summary"),
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
  updatedAt: sz.datetime().$value(surql`time::now()`, { optional: true }),
})
  .comment("Project tasks")
  .permissions({
    // Visibility derives from the parent project; writes need owner/membership.
    select: surql`project.owner = $auth.id OR project.settings.isPublic = true OR project IN $auth->member->project`,
    create: surql`project.owner = $auth.id OR project IN $auth->member->project`,
    update: "same as create",
    delete: "same as create",
  });

/** Comments on a task; `author` defaults to the signed-in user and is fixed. */
export const Comment = table("comment", {
  task: Task.record(),
  author: User.record().$default(surql`$auth.id`).$readonly(),
  body: sz.string().$min(1),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly().$comment("When posted"),
})
  .comment("Task comments")
  .permissions({
    // Anyone who can see the comment's task can read/post; only the author may edit/remove.
    select: surql`task.project.owner = $auth.id OR task.project.settings.isPublic = true OR task.project IN $auth->member->project`,
    create: "same as select",
    update: surql`author = $auth.id`,
    delete: "same as update",
  });

/** Graph: user ->member-> project, carrying a membership role. */
export const Member = relation("member", {
  role: sz.enum(["owner", "editor", "viewer"]).$default("viewer"),
  since: sz.datetime().$default(surql`time::now()`).$readonly(),
})
  .from(User)
  .to(Project)
  .permissions({
    select: surql`in = $auth.id OR out.owner = $auth.id`,
    // Only the project owner grants/edits membership; either side may remove it.
    create: surql`out.owner = $auth.id`,
    update: "same as create",
    delete: surql`out.owner = $auth.id OR in = $auth.id`,
  });

/** Graph: user ->watch-> task (notifications / follows). */
export const Watch = relation("watch", {
  since: sz.datetime().$default(surql`time::now()`).$readonly(),
})
  .from(User)
  .to(Task)
  .permissions({
    // A user only manages their own watches (update omitted -> NONE at the table level).
    select: surql`in = $auth.id`,
    create: "same as select",
    delete: "same as select",
  });

/** Graph: task ->depends_on-> task. */
export const DependsOn = relation("depends_on", {
  kind: sz.enum(["blocks", "relates_to"]).$default("blocks"),
})
  .from(Task)
  .to(Task)
  .permissions({
    // Manage dependencies if you own/are a member of the source task's project.
    select: surql`in.project.owner = $auth.id OR in.project IN $auth->member->project`,
    create: "same as select",
    delete: "same as select",
  });

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
