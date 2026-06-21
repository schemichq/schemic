// The golden path a user walks: init -> gen -> migrate -> status -> diff -> check. Drives the real
// CLI end to end against a throwaway in-memory SurrealDB.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
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

const T = 60_000; // subprocess + jiti + (for check) a nested ephemeral server

e2e("lifecycle: init -> gen -> migrate -> status -> diff -> check", () => {
  test(
    "the full golden path",
    async () => {
      const root = H.scaffold();
      const db = H.freshDb();
      const run = (args: string[]) => H.run(args, { cwd: root, db });

      // init scaffolds the project.
      const init = await run(["init"]);
      expect(init.code).toBe(0);
      expect(init.out).toContain("schemic.config.ts");
      expect(init.out).toContain("database/schema/tables/user.ts");
      expect(init.out).toContain("Initialized");

      // re-init is a no-op (never clobbers existing files).
      const reinit = await run(["init"]);
      expect(reinit.out).toContain("Nothing to do");
      expect(reinit.out).toContain("(exists, skipped)");

      // gen writes the baseline migration from the empty snapshot.
      const gen = await run(["gen", "init_schema", "-y"]);
      expect(gen.code).toBe(0);
      expect(gen.out).toContain("change");
      // gen prints the rendered migration it wrote — idempotent DEFINE … OVERWRITE, not a diff.
      expect(gen.out).toContain("DEFINE TABLE OVERWRITE user");
      expect(gen.out).toContain("init_schema");
      // …and writes an IDEMPOTENT migration FILE — added objects as DEFINE … OVERWRITE.
      const migRel = [...new Glob("**/*_init_schema.surql").scanSync(root)][0];
      expect(migRel).toBeDefined();
      expect(readFileSync(join(root, migRel), "utf8")).toContain(
        "DEFINE TABLE OVERWRITE user",
      );

      // status: one pending migration (nothing applied yet).
      const statusPending = await run(["status"]);
      expect(statusPending.out).toContain("pending");
      expect(statusPending.out).toContain("init_schema");

      // migrate applies it.
      const migrate = await run(["migrate"]);
      expect(migrate.code).toBe(0);
      expect(migrate.out).toContain("init_schema");
      expect(migrate.out).toContain("Applied 1 migration");

      // status: now applied.
      const statusApplied = await run(["status"]);
      expect(statusApplied.out).toContain("applied");
      expect(statusApplied.out).toContain("init_schema");

      // diff --live: schema now matches the database.
      const diffLive = await run(["diff", "--live"]);
      expect(diffLive.code).toBe(0);
      expect(diffLive.out).toContain("No changes.");

      // gen again: nothing to generate (snapshot caught up).
      const genAgain = await run(["gen", "noop", "-y"]);
      expect(genAgain.out).toContain("nothing to generate");

      // migrate again: up to date.
      const migrateAgain = await run(["migrate"]);
      expect(migrateAgain.out).toContain("Up to date");

      // check: replay the migrations on a throwaway engine and confirm they reproduce the schema.
      const check = await run(["check"]);
      expect(check.code).toBe(0);
      expect(check.out).toContain("Migrations reproduce the schema.");
    },
    T,
  );
});
