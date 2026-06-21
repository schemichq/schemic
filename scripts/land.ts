#!/usr/bin/env bun
/**
 * Land a green, backward-compatible PR branch onto `main` AND continuously deploy it. This is
 * core-dev's one-command merge step (see CLAUDE.md "Continuous deployment"):
 *
 *   1. rebase <branch> onto origin/main (in its worktree) so the merge is a clean fast-forward
 *   2. fast-forward-merge it into the local main checkout (NOT pushed yet)
 *   3. GATE: typecheck + test the whole workspace — if red, undo the merge and abort (never ship red)
 *   4. push main, then remove the branch's worktree + delete the branch (local + remote)
 *   5. deploy: cut the next prerelease (bun scripts/release.ts next) and commit/push the version bumps
 *
 * Usage:
 *   bun scripts/land.ts <branch> [--remote origin] [--no-test] [--no-deploy]
 *
 *   --no-test    skip the gate (rare; e.g. a docs/scripts-only branch)
 *   --no-deploy  land to main but DON'T cut a release (the change batches into the next deploy)
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const branch = argv.find((a) => !a.startsWith("-"));
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

if (!branch) {
  console.error(
    "usage: bun scripts/land.ts <branch> [--remote origin] [--no-test] [--no-deploy]",
  );
  process.exit(1);
}

const ROOT = join(import.meta.dir, "..");
const remote = opt("--remote", "origin");
const main = `${remote}/main`;

const git = (...a: string[]) =>
  execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const gitIO = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, stdio: "inherit" });
const run = (cmd: string, a: string[]) =>
  execFileSync(cmd, a, { cwd: ROOT, stdio: "inherit" });
const die = (msg: string): never => {
  console.error(`land: ${msg}`);
  process.exit(1);
};

// --- preflight: a clean main checkout ----------------------------------------------------------
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main")
  die("the main checkout must be on `main` (this script integrates into it).");
// tracked changes block the merge; untracked (e.g. .claude/) are fine.
if (
  git("status", "--porcelain")
    .split("\n")
    .some((l) => l && !l.startsWith("??"))
)
  die("main has uncommitted tracked changes — commit or stash them first.");

git("fetch", remote, "-q");

// Bring local main up to origin/main (fast-forward only).
const behind = Number(git("rev-list", "--count", `HEAD..${main}`));
if (behind) {
  if (Number(git("rev-list", "--count", `${main}..HEAD`)))
    die(`local main has diverged from ${main} — reconcile manually.`);
  gitIO("merge", "--ff-only", main);
}

// --- locate + rebase the branch --------------------------------------------------------------
function worktreeOf(b: string): string | null {
  for (const block of git("worktree", "list", "--porcelain").split("\n\n")) {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (block.match(/^branch refs\/heads\/(.+)$/m)?.[1] === b) return path ?? null;
  }
  return null;
}

const wt = worktreeOf(branch);
const isFF = (() => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", main, branch], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
})();

if (!isFF) {
  if (!wt) die(`${branch} is behind ${main} and has no worktree to rebase in.`);
  console.log(`rebasing ${branch} onto ${main}...`);
  try {
    execFileSync("git", ["-C", wt, "fetch", remote, "-q"]);
    execFileSync("git", ["-C", wt, "rebase", main], { stdio: "inherit" });
  } catch {
    try {
      execFileSync("git", ["-C", wt, "rebase", "--abort"], { stdio: "ignore" });
    } catch {}
    die(`rebase of ${branch} onto ${main} conflicted — resolve it in ${wt}, then re-run.`);
  }
}

const ahead = Number(git("rev-list", "--count", `HEAD..${branch}`));
if (ahead === 0) die(`${branch} has no commits beyond main — nothing to land.`);

// --- ff-merge into main locally (not pushed) -------------------------------------------------
console.log(`merging ${branch} -> main (${ahead} commit(s))...`);
gitIO("merge", "--ff-only", branch);

// --- gate: never ship red --------------------------------------------------------------------
if (!flag("--no-test")) {
  console.log("gate: typecheck + test workspace...");
  try {
    run("bun", ["run", "--filter", "*", "typecheck"]);
    run("bun", ["run", "--filter", "*", "test"]);
  } catch {
    console.error("gate FAILED — rolling main back, nothing pushed.");
    gitIO("reset", "--hard", main);
    process.exit(1);
  }
}

// --- push + clean up the worktree/branch -----------------------------------------------------
gitIO("push", remote, "main");
if (wt) {
  gitIO("worktree", "remove", "--force", wt);
  console.log(`removed worktree ${wt}`);
}
try {
  execFileSync("git", ["branch", "-D", branch], { cwd: ROOT, stdio: "ignore" });
} catch {}
try {
  execFileSync("git", ["push", remote, "--delete", branch], {
    cwd: ROOT,
    stdio: "ignore",
  });
} catch {}
console.log(`landed ${branch}.`);

// --- deploy ----------------------------------------------------------------------------------
if (flag("--no-deploy")) {
  console.log("--no-deploy: landed without releasing; it'll batch into the next deploy.");
  process.exit(0);
}
console.log("deploying (release next)...");
run("bun", ["scripts/release.ts", "next"]);
const newVer = JSON.parse(
  readFileSync(join(ROOT, "packages/core/package.json"), "utf8"),
).version as string;
gitIO(
  "add",
  ...["core", "cli", "surrealdb", "postgres", "create-schemic", "schemic"].map(
    (p) => `packages/${p}/package.json`,
  ),
  "bun.lock",
);
gitIO("commit", "-q", "-m", `chore: release ${newVer} (${branch})`);
gitIO("push", remote, "main");
console.log(`deployed ${newVer}.`);
