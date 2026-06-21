#!/usr/bin/env bun
import { join } from "node:path";
/**
 * Lockstep release for all @schemic packages.
 *
 *   bun scripts/release.ts <version> [--dry-run]
 *
 * Encapsulates the publish gotchas we have hit (see memory: publish-pin-gotcha):
 *  - `bun publish` rewrites each dependent's `@schemic/core: workspace:*` using bun.lock, and a bare
 *    version bump does NOT refresh that recorded version. So we REBUILD the lockfile (rm + install).
 *  - We then PACK-VERIFY every dependent actually pins core@<version> BEFORE publishing anything (a
 *    wrong pin can't be fixed without burning the version).
 *  - core is published FIRST, since the dependents pin it.
 *
 * Auth: an npm Automation token in ~/.npmrc (the account is 2FA auth-and-writes, so a normal publish
 * token would prompt for an OTP and hang). `npm` itself is broken under WSL — we use `bun publish`.
 */
import { $ } from "bun";

const version = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!version || version.startsWith("-")) {
  console.error("usage: bun scripts/release.ts <version> [--dry-run]");
  process.exit(1);
}

const ROOT = join(import.meta.dir, "..");
// core first (dependents pin it); create-schemic last — it has NO @schemic deps (it scaffolds version
// strings), so it isn't pin-verified, just bumped + published lockstep so it scaffolds matching versions.
const ORDER = ["core", "cli", "surrealdb", "postgres", "create-schemic", "schemic"];
const DEPENDENTS = ["cli", "surrealdb", "postgres"];
const pkgDir = (p: string) => join(ROOT, "packages", p);

// 1. set every package's version (targeted edit — don't reformat the file)
for (const p of ORDER) {
  const path = join(pkgDir(p), "package.json");
  const txt = await Bun.file(path).text();
  await Bun.write(
    path,
    txt.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  );
  console.log(`set @schemic/${p} -> ${version}`);
}

// 2. rebuild the lockfile so `workspace:*` rewrites to the NEW version (a bare bump won't refresh it)
console.log("rebuilding lockfile...");
await $`rm -f ${join(ROOT, "bun.lock")}`;
await $`bun install`.cwd(ROOT).quiet();

// 3. pack-verify each dependent pins core@<version> BEFORE publishing anything
for (const p of DEPENDENTS) {
  const tgz = `schemic-${p}-${version}.tgz`;
  await $`bun pm pack`.cwd(pkgDir(p)).quiet();
  const manifest = JSON.parse(
    await $`tar -xzf ${tgz} -O package/package.json`.cwd(pkgDir(p)).text(),
  );
  await $`rm -f ${tgz}`.cwd(pkgDir(p));
  const pin = manifest.dependencies?.["@schemic/core"];
  if (pin !== version) {
    console.error(
      `ABORT: @schemic/${p} pins core@${pin}, expected ${version} — lockfile not refreshed.`,
    );
    process.exit(1);
  }
  console.log(`verified @schemic/${p} -> core@${pin}`);
}

if (dryRun) {
  console.log("dry-run: versions set + pins verified; skipping publish.");
  process.exit(0);
}

// 4. publish core first, then the dependents (prepack builds each)
for (const p of ORDER) {
  console.log(`publishing @schemic/${p}@${version}...`);
  await $`bun publish`.cwd(pkgDir(p));
}
console.log(
  `\nReleased @schemic/* ${version}. Verify: bun pm view @schemic/cli version`,
);
