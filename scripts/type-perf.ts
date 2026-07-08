// Shared TYPE-PERF runner — runs a package's `test/types/` suite under node/tsx (NOT bun).
//
// Why node, not bun: @ark/attest measures type instantiations + checks type assertions by driving a
// TypeScript program and locating the running source file via the node call stack. Under bun that
// frame reads as `native`, so attest throws "TypeScript was unable to resolve expected file at native".
// Running the suite in a separate node process (TS via tsx) sidesteps it entirely. See
// packages/core/docs/TYPE-PERF-TESTING.md.
//
// Usage: bun run scripts/type-perf.ts [packageDir...]   (default: every workspace with a test/types/)
//   - test/types/*.assert.ts → attest type assertions, via node's test runner
//   - test/types/*.bench.ts  → instantiation budgets, each run directly (exits non-zero if over budget)
//
// NOTE the `.assert.ts` (not `.test.ts`) suffix: it keeps these files OUT of `bun test` (which would
// run them under bun and hit the `native` error), while `node --test` runs them fine when passed
// explicitly. `.bench.ts` is likewise unmatched by bun.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

/** Workspace package dirs that actually have a type-suite. */
function packagesWithTypeSuites(): string[] {
  const out: string[] = [];
  for (const group of ["packages", "drivers"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (existsSync(join(base, name, "test/types")))
        out.push(join(group, name));
    }
  }
  return out;
}

function typeFiles(pkgDir: string, suffix: string): string[] {
  const dir = join(ROOT, pkgDir, "test/types");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((f) => join("test/types", f));
}

function run(cwd: string, args: string[]): boolean {
  const r = spawnSync("node", ["--import", "tsx", ...args], {
    cwd: join(ROOT, cwd),
    stdio: "inherit",
  });
  return r.status === 0;
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : packagesWithTypeSuites();

if (!targets.length) {
  console.log("type-perf: no test/types/ suites found — nothing to check.");
  process.exit(0);
}

let failed = false;
for (const pkg of targets) {
  const asserts = typeFiles(pkg, ".assert.ts");
  const benches = typeFiles(pkg, ".bench.ts");
  if (!asserts.length && !benches.length) {
    console.log(
      `type-perf: ${pkg} has a test/types/ dir but no *.assert.ts / *.bench.ts — skipping.`,
    );
    continue;
  }
  console.log(
    `\n=== type-perf: ${pkg} (${asserts.length} assertion file(s), ${benches.length} bench file(s)) ===`,
  );
  if (asserts.length && !run(pkg, ["--test", ...asserts])) failed = true;
  for (const bench of benches) if (!run(pkg, [bench])) failed = true;
}

if (failed) {
  console.error(
    "\ntype-perf: FAILED (type assertion mismatch or instantiation budget exceeded).",
  );
  process.exit(1);
}
console.log("\ntype-perf: all suites passed.");
