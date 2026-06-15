/**
 * Live integration tests against the running SurrealDB. They:
 *   - migrate a scratch database (schema + record access + permissions),
 *   - sign up two end users via record access,
 *   - exercise create/update + @schemic/core decode/encode (RecordId, Date, Duration,
 *     enums, nested objects),
 *   - and assert permission isolation (user B cannot see user A's private data,
 *     until A grants membership).
 *
 * Run:  bun test   (needs SURREAL_USER / SURREAL_PASS in .env)
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Duration, RecordId, Surreal, surql } from "surrealdb";
import type { App } from "@schemic/core";
import { type DbConfig, DB, signIn, signUp } from "../src/db";
import { Comment, Member, Project, Task, User } from "../src/schema";
import { migrate } from "../setup";

const TEST_DB = `tracker_test_${Date.now()}`;
const cfg: DbConfig = { ...DB, database: TEST_DB };

const root = new Surreal();
let A: Surreal; // Alice (owner)
let B: Surreal; // Bob (outsider, later a member)
let aliceId: RecordId<"user">;
let bobId: RecordId<"user">;

/** Open a fresh record-access connection signed up as a new user. */
async function newUser(name: string, email: string): Promise<{ db: Surreal; id: RecordId<"user"> }> {
  const db = new Surreal();
  await db.connect(cfg.url);
  await db.use({ namespace: cfg.namespace, database: cfg.database });
  await signUp(db, { name, email, pass: "passw0rd" }, cfg);
  const [id] = await db.query<[RecordId<"user">]>(surql`RETURN $auth.id`);
  return { db, id };
}

beforeAll(async () => {
  await root.connect(cfg.url);
  await root.signin({ username: process.env.SURREAL_USER!, password: process.env.SURREAL_PASS! });
  await root.query(`DEFINE NAMESPACE IF NOT EXISTS \`${cfg.namespace}\`;`);
  await root.use({ namespace: cfg.namespace });
  await root.query(`REMOVE DATABASE IF EXISTS \`${cfg.database}\`; DEFINE DATABASE \`${cfg.database}\`;`);
  await root.use({ namespace: cfg.namespace, database: cfg.database });
  await migrate(root);

  ({ db: A, id: aliceId } = await newUser("Alice", "alice@example.com"));
  ({ db: B, id: bobId } = await newUser("Bob", "bob@example.com"));
});

afterAll(async () => {
  await root.query(`REMOVE DATABASE IF EXISTS \`${cfg.database}\`;`);
  await Promise.all([root, A, B].map((d) => d?.close()));
});

describe("record access + identity", () => {
  test("signup authenticates and $auth resolves to a user RecordId", () => {
    expect(aliceId).toBeInstanceOf(RecordId);
    expect(aliceId.table.name).toBe("user");
    expect(bobId.id).not.toBe(aliceId.id);
  });

  test("decode of the authenticated user row yields app types", async () => {
    const [rows] = await A.query<[unknown[]]>(surql`SELECT * FROM ${aliceId}`);
    const u: App<typeof User> = User.decode(rows[0]);
    expect(u.id).toBeInstanceOf(RecordId);
    expect(u.name).toBe("Alice");
    expect(u.email).toBe("alice@example.com");
    expect(u.createdAt).toBeInstanceOf(Date);
    // passhash is hidden by PERMISSIONS NONE and absent from the app type.
    expect((u as Record<string, unknown>).passhash).toBeUndefined();
  });

  test("signin round-trips on a fresh connection", async () => {
    const db = new Surreal();
    await db.connect(cfg.url);
    await db.use({ namespace: cfg.namespace, database: cfg.database });
    const token = await signIn(db, { email: "alice@example.com", pass: "passw0rd" }, cfg);
    expect(typeof token).toBe("string");
    const [id] = await db.query<[RecordId]>(surql`RETURN $auth.id`);
    expect(String(id)).toBe(String(aliceId));
    await db.close();
  });

  test("signin with a wrong password is rejected", async () => {
    const db = new Surreal();
    await db.connect(cfg.url);
    await db.use({ namespace: cfg.namespace, database: cfg.database });
    await expect(signIn(db, { email: "alice@example.com", pass: "nope" }, cfg)).rejects.toThrow();
    await db.close();
  });
});

describe("create + decode (encode / DB defaults / codecs)", () => {
  let projectId: RecordId<"project">;
  let taskId: RecordId<"task">;

  test("Project.encode omits DB-filled fields; defaults + nested object decode", async () => {
    const payload = Project.encode({ name: "Launch", description: "Ship it", tags: ["q3"] });
    // encode() leaves owner/createdAt/settings/color to the DB.
    expect(payload).not.toHaveProperty("owner");
    expect(payload).not.toHaveProperty("createdAt");

    const [rows] = await A.query<[unknown[]]>(surql`CREATE project CONTENT ${payload}`);
    const p: App<typeof Project> = Project.decode(rows[0]);
    projectId = p.id;

    expect(p.id).toBeInstanceOf(RecordId);
    expect(p.owner).toBeInstanceOf(RecordId);
    expect(String(p.owner)).toBe(String(aliceId)); // owner DEFAULT $auth.id
    expect(p.color).toBe("#6366f1"); // scalar DB default
    expect(p.settings.isPublic).toBe(false); // nested object defaults
    expect(p.settings.defaultView).toBe("list");
    expect(p.createdAt).toBeInstanceOf(Date);
    expect(p.tags).toEqual(["q3"]);

    // Nested create-optionality: provide only ONE nested settings field (defaultView) and
    // omit the DB-defaulted `isPublic`. The partial nested object must round-trip with the
    // DB filling the omitted nested default (kept private so it doesn't leak to Bob below).
    const partial = Project.encode({ name: "Partial", settings: { defaultView: "board" } });
    expect(partial.settings as Record<string, unknown>).not.toHaveProperty("isPublic");
    const [prows] = await A.query<[unknown[]]>(surql`CREATE project CONTENT ${partial}`);
    const pp = Project.decode(prows[0]);
    expect(pp.settings.defaultView).toBe("board"); // client-provided nested value (non-default)
    expect(pp.settings.isPublic).toBe(false); // DB-filled nested default
  });

  test("Task.encode + enums, duration, links, $value updatedAt", async () => {
    const payload = Task.encode({
      project: projectId,
      title: "Write docs",
      priority: "high",
      estimate: new Duration("2h30m"),
      assignees: [aliceId],
    });
    const [rows] = await A.query<[unknown[]]>(surql`CREATE task CONTENT ${payload}`);
    const t: App<typeof Task> = Task.decode(rows[0]);
    taskId = t.id;

    expect(t.status).toBe("todo"); // enum default
    expect(t.priority).toBe("high");
    expect(t.estimate).toBeInstanceOf(Duration);
    expect(t.estimate?.toString()).toBe("2h30m");
    expect(t.project).toBeInstanceOf(RecordId);
    expect(t.assignees[0]).toBeInstanceOf(RecordId);
    expect(String(t.createdBy)).toBe(String(aliceId)); // DEFAULT $auth.id
    expect(t.createdAt).toBeInstanceOf(Date);
    expect(t.updatedAt).toBeInstanceOf(Date); // VALUE time::now()
    expect(t.completedAt).toBeUndefined();
  });

  test("encodePartial MERGE updates status + completedAt; updatedAt advances", async () => {
    const [before] = await A.query<[unknown[]]>(surql`SELECT * FROM ${taskId}`);
    const updatedBefore = Task.decode(before[0]).updatedAt!;
    await Bun.sleep(10);

    const patch = Task.encodePartial({ status: "done", completedAt: new Date() });
    const [rows] = await A.query<[unknown[]]>(surql`UPDATE ${taskId} MERGE ${patch} RETURN AFTER`);
    const t = Task.decode(rows[0]);

    expect(t.status).toBe("done");
    expect(t.completedAt).toBeInstanceOf(Date);
    expect(t.updatedAt!.getTime()).toBeGreaterThan(updatedBefore.getTime());
  });

  test("Comment.encode defaults author to $auth and decodes links", async () => {
    const [rows] = await A.query<[unknown[]]>(
      surql`CREATE comment CONTENT ${Comment.encode({ task: taskId, body: "Looks good" })}`,
    );
    const c = Comment.decode(rows[0]);
    expect(String(c.author)).toBe(String(aliceId));
    expect(String(c.task)).toBe(String(taskId));
    expect(c.body).toBe("Looks good");
    expect(c.createdAt).toBeInstanceOf(Date);
  });

  test("DB ASSERT rejects an empty title", async () => {
    // NB: surrealdb's query() returns a custom thenable, not a native Promise, so
    // `expect(db.query(...)).rejects` does not settle under bun — capture instead.
    let error: unknown;
    try {
      await A.query(surql`CREATE task CONTENT ${Task.encode({ project: projectId, title: "" })}`);
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
  });

  describe("permission isolation", () => {
    test("Bob cannot see Alice's project or task", async () => {
      const [projects] = await B.query<[unknown[]]>(surql`SELECT * FROM project`);
      const [tasks] = await B.query<[unknown[]]>(surql`SELECT * FROM task`);
      expect(projects.length).toBe(0);
      expect(tasks.length).toBe(0);
      const [direct] = await B.query<[unknown[]]>(surql`SELECT * FROM ${projectId}`);
      expect(direct.length).toBe(0);
    });

    test("Bob cannot create a task in Alice's project", async () => {
      const [rows] = await B.query<[unknown[]]>(
        surql`CREATE task CONTENT ${Task.encode({ project: projectId, title: "sneaky" })}`,
      ).catch(() => [[]] as [unknown[]]);
      expect(rows.length).toBe(0);
    });

    test("after Alice grants membership, Bob can see and edit", async () => {
      // Only the project owner may create the membership edge (member create perm).
      await A.query(surql`RELATE ${bobId}->member->${projectId} SET role = "editor"`);

      const [memberRows] = await A.query<[unknown[]]>(surql`SELECT * FROM member`);
      const m: App<typeof Member> = Member.decode(memberRows[0]);
      expect(m.in).toBeInstanceOf(RecordId);
      expect(m.out).toBeInstanceOf(RecordId);
      expect(m.role).toBe("editor");

      // Bob now sees the project + task via the membership graph permission.
      const [projects] = await B.query<[unknown[]]>(surql`SELECT * FROM project`);
      expect(projects.length).toBe(1);
      expect(String(Project.decode(projects[0]).id)).toBe(String(projectId));

      const [tasks] = await B.query<[unknown[]]>(surql`SELECT * FROM task`);
      expect(tasks.length).toBe(1);

      // And can edit a task (member write permission).
      const [edited] = await B.query<[unknown[]]>(
        surql`UPDATE ${taskId} MERGE ${Task.encodePartial({ priority: "urgent" })} RETURN AFTER`,
      );
      expect(Task.decode(edited[0]).priority).toBe("urgent");
    });
  });
});
