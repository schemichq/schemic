// `schemic pull` end to end: idempotency (the regression lock for the surql-import / literal-default
// fixes), the local-only guard (--merge / --discard), and the documented codec asymmetries.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { E2E_ENABLED, type Harness, startHarness } from "./harness";

const e2e = describe.skipIf(!E2E_ENABLED);
if (!E2E_ENABLED)
  console.warn("[e2e] `surreal` binary not found — skipping e2e suite");

let H: Harness;
beforeAll(async () => {
  if (E2E_ENABLED) H = await startHarness();
}, 30_000);
afterAll(async () => {
  await H?.cleanup();
});

const T = 60_000;

/** Init, then drop the sample `user.ts` so pull tests start from a clean, single-table slate. */
async function setupBare() {
  const root = H.scaffold();
  const db = H.freshDb();
  const run = (args: string[]) => H.run(args, { cwd: root, db });
  await run(["init"]);
  rmSync(`${root}/database/schema/tables/user.ts`);
  return { root, db, run };
}

e2e("pull", () => {
  test(
    "round-trips idempotently: literal defaults stay bare, surql comes from surrealdb",
    async () => {
      const { root, run } = await setupBare();
      H.write(
        root,
        "database/schema/tables/flag.ts",
        `import { surql } from "surrealdb";
import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
  count: s.int().$default(0),
  createdAt: s.datetime().$default(surql\`time::now()\`),
});
`,
      );
      await run(["push"]); // db now has `flag`

      const written = await run(["pull", "--write"]);
      expect(written.code).toBe(0);

      const flag = H.read(root, "database/schema/tables/flag.ts");
      // Literal defaults render bare (not wrapped in surql).
      expect(flag).toContain(".$default(false)");
      expect(flag).toContain(".$default(0)");
      expect(flag).not.toContain("$default(surql`false`)");
      expect(flag).not.toContain("$default(surql`0`)");
      // An expression default keeps surql, imported from surrealdb on its own line.
      expect(flag).toContain(".$default(surql`time::now()`)");
      expect(flag).toContain(`import { surql } from "surrealdb";`);
      // surql is NEVER folded into the @schemic/core import.
      const szLine = flag
        .split("\n")
        .find((l) => l.includes('from "@schemic/core"'));
      expect(szLine).toBeDefined();
      expect(szLine).not.toContain("surql");

      // Pulling an in-sync database is a no-op.
      const again = await run(["pull"]);
      expect(again.out).toContain("Schema files already match the database.");
    },
    T,
  );

  test(
    "local-only field: preview warns, bare --write is guarded, --discard drops it",
    async () => {
      const { root, run } = await setupBare();
      H.write(
        root,
        "database/schema/tables/flag.ts",
        `import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
});
`,
      );
      await run(["push"]); // db has flag { enabled }

      // Add a field the db doesn't have — local-only, at risk on a mirror pull.
      H.write(
        root,
        "database/schema/tables/flag.ts",
        `import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
  note: s.string().optional(),
});
`,
      );

      // Preview surfaces the local-only field.
      const preview = await run(["pull"]);
      expect(preview.out).toContain("local-only");
      expect(preview.out).toContain("note");

      // A bare --write refuses to clobber it (the git "commit or stash" guard).
      const guarded = await run(["pull", "--write"]);
      expect(guarded.code).toBe(1);
      expect(guarded.out).toContain("would overwrite local-only schema");
      expect(H.read(root, "database/schema/tables/flag.ts")).toContain("note");

      // --discard mirrors the db exactly, dropping the local-only field.
      const discard = await run(["pull", "--write", "--discard"]);
      expect(discard.code).toBe(0);
      expect(discard.out).toMatch(/Pulled/);
      expect(H.read(root, "database/schema/tables/flag.ts")).not.toContain(
        "note",
      );
    },
    T,
  );

  test(
    "local-only field: --merge keeps it while still mirroring the rest",
    async () => {
      const { root, run } = await setupBare();
      H.write(
        root,
        "database/schema/tables/flag.ts",
        `import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
});
`,
      );
      await run(["push"]);
      H.write(
        root,
        "database/schema/tables/flag.ts",
        `import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
  note: s.string().optional(),
});
`,
      );

      const merge = await run(["pull", "--write", "--merge"]);
      expect(merge.code).toBe(0);
      // The local-only field survives (no change to mirror → already in sync).
      expect(H.read(root, "database/schema/tables/flag.ts")).toContain("note");
    },
    T,
  );

  test(
    "string-format builders reverse from their baked assert (s.email(), not string + ASSERT)",
    async () => {
      // The sample `user.ts` uses s.email(); the db stores it as `string ASSERT string::is_email`.
      // pull recovers the builder from that exact assert (and drops the now-redundant $assert).
      const root = H.scaffold();
      const db = H.freshDb();
      const run = (args: string[]) => H.run(args, { cwd: root, db });
      await run(["init"]);
      await run(["push"]);

      await run(["pull", "--write"]);
      const user = H.read(root, "database/schema/tables/user.ts");
      expect(user).toContain("email: s.email()");
      expect(user).not.toContain("string::is_email"); // the assert was reversed, not re-emitted
      expect(user).not.toMatch(/email:.*\$assert/);

      // Idempotent on the second pull.
      const again = await run(["pull"]);
      expect(again.out).toContain("Schema files already match the database.");
    },
    T,
  );

  test(
    "whole-table local-only: surfaced in preview, kept by --merge, file deleted by --discard",
    async () => {
      const { root, run } = await setupBare();
      const flag = `import { s, defineTable } from "@schemic/core";

export const Flag = defineTable("flag", {
  id: s.string(),
  enabled: s.boolean().$default(false),
});
`;
      H.write(root, "database/schema/tables/flag.ts", flag);
      await run(["push"]); // DB has `flag` only

      // A table the DB doesn't have — a whole local-only entity in its own file.
      H.write(
        root,
        "database/schema/tables/draft.ts",
        `import { s, defineTable } from "@schemic/core";

export const Draft = defineTable("draft", {
  id: s.string(),
  title: s.string(),
});
`,
      );
      const draftPath = join(root, "database/schema/tables/draft.ts");

      // Preview surfaces it (no longer the old "already match" lie).
      const preview = await run(["pull"]);
      expect(preview.out).not.toContain("already match");
      expect(preview.out).toContain("local-only");
      expect(preview.out).toContain("draft.ts");

      // A bare --write refuses to clobber it.
      const guarded = await run(["pull", "--write"]);
      expect(guarded.code).toBe(1);
      expect(guarded.out).toContain("would overwrite local-only schema");
      expect(existsSync(draftPath)).toBe(true);

      // --merge keeps the file.
      const merged = await run(["pull", "--write", "--merge"]);
      expect(merged.code).toBe(0);
      expect(existsSync(draftPath)).toBe(true);

      // --discard deletes the whole file (it was purely the local-only entity).
      const discard = await run(["pull", "--write", "--discard"]);
      expect(discard.code).toBe(0);
      expect(discard.out).toMatch(/removed/);
      expect(existsSync(draftPath)).toBe(false);
    },
    T,
  );

  test(
    "a local-only entity mixed with other code is surfaced but NOT deleted",
    async () => {
      const { root, run } = await setupBare();
      await run(["push"]); // empty schema (user.ts removed) → empty DB

      // A file that mixes a local-only table with a non-schema export → not safe to auto-delete.
      H.write(
        root,
        "database/schema/tables/mix.ts",
        `import { s, defineTable } from "@schemic/core";

export const HELPER = 42;
export const Mix = defineTable("mix", {
  id: s.string(),
  name: s.string(),
});
`,
      );
      const mixPath = join(root, "database/schema/tables/mix.ts");

      const preview = await run(["pull"]);
      expect(preview.out).toContain("local-only");
      expect(preview.out).toContain("mix.ts");

      // --discard surfaces it but leaves the file (helper would be lost) with a note.
      const discard = await run(["pull", "--write", "--discard"]);
      expect(discard.code).toBe(0);
      expect(existsSync(mixPath)).toBe(true);
      expect(discard.out).toMatch(/left in place|by hand/);
    },
    T,
  );
});

e2e("migration guards", () => {
  test(
    "gen --baseline without --force refuses, pointing at the exact command",
    async () => {
      const root = H.scaffold();
      const db = H.freshDb();
      const run = (args: string[]) => H.run(args, { cwd: root, db });
      await run(["init"]);
      await run(["gen", "base", "-y"]); // one migration now exists

      // Non-interactive (no TTY) + no --force → stop with an actionable message, no files touched.
      const baseline = await run(["gen", "--baseline", "-y"]);
      expect(baseline.code).toBe(1);
      expect(baseline.out).toMatch(/already exist/);
      expect(baseline.out).toMatch(/--baseline --force/);
    },
    T,
  );

  test(
    "gen --baseline --force squashes existing migrations into one applied baseline",
    async () => {
      const root = H.scaffold();
      const db = H.freshDb();
      const run = (args: string[]) => H.run(args, { cwd: root, db });
      await run(["init"]);
      await run(["gen", "base", "-y"]);
      await run(["migrate"]);
      // A second migration, also applied → two on disk, both applied in the DB.
      H.write(
        root,
        "database/schema/tables/post.ts",
        `import { s, defineTable } from "@schemic/core";

export const Post = defineTable("post", {
  id: s.string(),
  title: s.string(),
});
`,
      );
      await run(["gen", "add_post", "-y"]);
      await run(["migrate"]);

      const squash = await run(["gen", "--baseline", "--force"]);
      expect(squash.code).toBe(0);
      expect(squash.out).toContain("replaced 2 migrations");
      // DB already matched → baseline recorded applied (DDL not re-run).
      expect(squash.out).toContain("recorded as applied");

      // Exactly one migration, applied, with NO orphaned ('missing') history rows.
      const status = await run(["status"]);
      expect(status.out).toContain("baseline");
      expect(status.out).not.toContain("missing");
      expect(status.out).toMatch(/1 migration, 0 pending/);

      // Code, snapshot, and DB are all back in sync.
      const live = await run(["diff", "--live"]);
      expect(live.out).toContain("No changes.");
      const offline = await run(["diff"]);
      expect(offline.out).toContain("No changes.");
      const migrate = await run(["migrate"]);
      expect(migrate.out).toContain("Up to date");
    },
    T,
  );

  test(
    "rollback reverts the last migration and is then a no-op",
    async () => {
      const root = H.scaffold();
      const db = H.freshDb();
      const run = (args: string[]) => H.run(args, { cwd: root, db });
      await run(["init"]);
      await run(["gen", "base", "-y"]);
      await run(["migrate"]);

      const back = await run(["rollback"]);
      expect(back.code).toBe(0);
      expect(back.out).toMatch(/Rolled back 1 migration/);

      // The migration is pending again.
      const status = await run(["status"]);
      expect(status.out).toContain("pending");

      const again = await run(["rollback"]);
      expect(again.out).toContain("Nothing to roll back.");
    },
    T,
  );
});
