import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../src/index.ts");

/** Run the scaffolder (always --no-install --no-git -y) into a temp dir; returns paths + exit code. */
function scaffold(args: string[]) {
  const root = mkdtempSync(join(tmpdir(), "create-schemic-"));
  const app = join(root, "app");
  const r = spawnSync(
    "bun",
    [ENTRY, app, ...args, "--no-install", "--no-git", "-y"],
    { encoding: "utf8" },
  );
  const pkg = () => JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
  const ts = () => JSON.parse(readFileSync(join(app, "tsconfig.json"), "utf8"));
  // clack writes prompts/cancel to stdout, not stderr — check the combined output
  return {
    root,
    app,
    status: r.status,
    out: `${r.stdout}${r.stderr}`,
    pkg,
    ts,
  };
}

describe("create-schemic", () => {
  it("scaffolds the project envelope for surrealdb", () => {
    const s = scaffold(["--driver", "surrealdb"]);
    try {
      expect(s.status).toBe(0);
      expect(existsSync(join(s.app, "package.json"))).toBe(true);
      expect(existsSync(join(s.app, "tsconfig.json"))).toBe(true);
      expect(existsSync(join(s.app, ".gitignore"))).toBe(true);
      const deps = s.pkg().dependencies;
      expect(deps["@schemic/cli"]).toBeDefined();
      expect(deps["@schemic/surrealdb"]).toBeDefined();
      expect(deps.surrealdb).toBeDefined();
      expect(deps.zod).toBeDefined();
      // bun/npm hoist core transitively — no direct @schemic/core dep
      expect(deps["@schemic/core"]).toBeUndefined();
      // the type declaration for the `with { type: "text" }` seed imports needs resolveJsonModule
      expect(s.ts().compilerOptions.resolveJsonModule).toBe(true);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  it("scaffolds postgres deps (pglite, no surrealdb SDK)", () => {
    const s = scaffold(["--driver", "postgres"]);
    try {
      const deps = s.pkg().dependencies;
      expect(deps["@schemic/postgres"]).toBeDefined();
      expect(deps["@electric-sql/pglite"]).toBeDefined();
      expect(deps.surrealdb).toBeUndefined();
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  it("adds a direct @schemic/core dep under pnpm (strict node_modules)", () => {
    const s = scaffold(["--driver", "surrealdb", "--pm", "pnpm"]);
    try {
      expect(s.pkg().dependencies["@schemic/core"]).toBeDefined();
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown driver", () => {
    const s = scaffold(["--driver", "mongodb"]);
    try {
      expect(s.status).not.toBe(0);
      expect(s.out).toContain("Unknown driver");
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });
});
