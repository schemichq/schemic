import { execFileSync, spawn } from "node:child_process";

/** Read a single git config value (global/system included), or undefined. */
function gitConfig(key: string): string | undefined {
  try {
    const v = execFileSync("git", ["config", "--get", key], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The diff pager, resolved the way git does: `pager.diff` → `core.pager` → `$GIT_PAGER` →
 * `$PAGER`. So a user with `core.pager = delta` gets delta for free, with their own config.
 */
export function resolvePager(): string | undefined {
  return (
    gitConfig("pager.diff") ||
    gitConfig("core.pager") ||
    process.env.GIT_PAGER ||
    process.env.PAGER ||
    undefined
  );
}

/** Pipe `text` through `pager` (a shell command, possibly with args); resolve when it exits. */
export function pipeThroughPager(pager: string, text: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("sh", ["-c", pager], {
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("close", () => resolve());
    // The pager may quit before reading all input (e.g. `less` on a short diff) — ignore EPIPE.
    child.stdin.on("error", () => {});
    child.stdin.end(text);
  });
}
