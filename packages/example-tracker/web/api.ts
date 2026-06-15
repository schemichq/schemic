import { type RecordId, type Surreal, surql, Table } from "surrealdb";
import type { App, Create, Update } from "@schemic/surreal";
import { Comment, Project, Task } from "../src/schema";

/**
 * Browser data layer. Every read runs the row through `@schemic/core` `decode`
 * (DB -> app types: RecordId, Date, Duration, enums) and every write builds its
 * payload with `encode` / `encodePartial` (app -> wire). All queries run as the
 * signed-in record user, so table PERMISSIONS scope the results automatically.
 */

export type AppProject = App<typeof Project>;
export type AppTask = App<typeof Task>;
export type AppComment = App<typeof Comment>;

export async function listProjects(db: Surreal): Promise<AppProject[]> {
  const [rows] = await db.query<[unknown[]]>(surql`SELECT * FROM project ORDER BY createdAt DESC`);
  return rows.map((r) => Project.decode(r));
}

export async function createProject(
  db: Surreal,
  input: Create<typeof Project>,
): Promise<AppProject> {
  const [rows] = await db.query<[unknown[]]>(surql`CREATE project CONTENT ${Project.encode(input)}`);
  return Project.decode(rows[0]);
}

export async function listTasks(db: Surreal, project: RecordId<"project">): Promise<AppTask[]> {
  const [rows] = await db.query<[unknown[]]>(
    surql`SELECT * FROM task WHERE project = ${project} ORDER BY priority DESC, createdAt`,
  );
  return rows.map((r) => Task.decode(r));
}

export async function createTask(db: Surreal, input: Create<typeof Task>): Promise<AppTask> {
  const [rows] = await db.query<[unknown[]]>(surql`CREATE task CONTENT ${Task.encode(input)}`);
  return Task.decode(rows[0]);
}

export async function updateTask(
  db: Surreal,
  id: RecordId<"task">,
  patch: Update<typeof Task>,
): Promise<AppTask> {
  const [rows] = await db.query<[unknown[]]>(
    surql`UPDATE ${id} MERGE ${Task.encodePartial(patch)} RETURN AFTER`,
  );
  return Task.decode(rows[0]);
}

export async function deleteTask(db: Surreal, id: RecordId<"task">): Promise<void> {
  await db.query(surql`DELETE ${id}`);
}

export async function listComments(db: Surreal, task: RecordId<"task">): Promise<AppComment[]> {
  const [rows] = await db.query<[unknown[]]>(
    surql`SELECT * FROM comment WHERE task = ${task} ORDER BY createdAt`,
  );
  return rows.map((r) => Comment.decode(r));
}

export async function addComment(db: Surreal, input: Create<typeof Comment>): Promise<AppComment> {
  const [rows] = await db.query<[unknown[]]>(surql`CREATE comment CONTENT ${Comment.encode(input)}`);
  return Comment.decode(rows[0]);
}

/**
 * Subscribe to realtime task changes via SurrealDB LIVE SELECT. The handler is
 * called on every CREATE/UPDATE/DELETE the user is permitted to see. Returns a
 * cleanup function. Falls back to a no-op if live queries are unavailable.
 */
export async function watchTasks(db: Surreal, onChange: () => void): Promise<() => void> {
  try {
    const sub = await db.live(new Table("task"));
    const unsub = sub.subscribe(() => onChange());
    return () => {
      unsub();
      void sub.kill();
    };
  } catch {
    return () => {};
  }
}
