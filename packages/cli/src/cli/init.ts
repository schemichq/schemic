import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CONFIG = `import { defineConfig } from "@schemic/core/config";

export default defineConfig({
  // schema and migrations default to ./database/schema and ./database/migrations.
  // schema/ is loaded recursively — organize by kind: tables/, functions/, access/, …
  // schema: "./database/schema",
  // migrations: "./database/migrations",
  db: {
    url: process.env.SURREAL_URL ?? "ws://localhost:8000",
    namespace: process.env.SURREAL_NAMESPACE ?? "app",
    database: process.env.SURREAL_DATABASE ?? "app",
    username: process.env.SURREAL_USER,
    password: process.env.SURREAL_PASS,
    authLevel: "root", // "root" | "namespace" | "database"
  },
  // \`schemic check\` replays your migrations to confirm they reproduce the schema. By default ("auto") it
  // spins up an ephemeral in-memory SurrealDB from your local \`surreal\` CLI — your exact version, no
  // external server, your real database untouched. Falls back to the \`db\` server if the CLI is
  // missing. To always use a server (and keep it off production) point the replay at a scratch one:
  // check: { engine: "remote", db: { url: "ws://localhost:8000", namespace: "scratch" } },
  // Or run fully in-process via the optional @surrealdb/node package (npm i -D @surrealdb/node):
  // check: { engine: { backend: "memory" } }, // backend: memory | surrealkv | rocksdb, + capabilities
});
`;

const SAMPLE_SCHEMA = `import { surql } from "surrealdb";
import { s, defineTable } from "@schemic/surreal";

export const User = defineTable("user", {
  id: s.string(),
  name: s.string(),
  email: s.email(),
  createdAt: s.datetime().$default(surql\`time::now()\`).$readonly(),
});
`;

const SEED = `import type { Surreal } from "surrealdb";

/** Run with \`schemic seed\`. Receives a connected client. */
export default async function seed(db: Surreal) {
  // await db.create("user", { name: "Ada", email: "ada@example.com" });
}
`;

const ENV_EXAMPLE = `SURREAL_URL=ws://localhost:8000
SURREAL_NAMESPACE=app
SURREAL_DATABASE=app
SURREAL_USER=root
SURREAL_PASS=root
SURREAL_AUTH_LEVEL=root
`;

const INITIAL_SNAPSHOT = `${JSON.stringify(
  {
    version: 2,
    driver: "surreal",
    portable: { tables: [], functions: [], accesses: [] },
    files: {},
  },
  null,
  2,
)}\n`;

export interface InitResult {
  created: string[];
  skipped: string[];
}

/** Scaffold the `database/` layout + config + sample schema. Never overwrites existing files. */
export function init(cwd: string): InitResult {
  const files: Record<string, string> = {
    "schemic.config.ts": CONFIG,
    "database/schema/tables/user.ts": SAMPLE_SCHEMA,
    "database/seed.ts": SEED,
    "database/migrations/meta/_snapshot.json": INITIAL_SNAPSHOT,
    ".env.example": ENV_EXAMPLE,
  };

  const created: string[] = [];
  const skipped: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = resolve(cwd, rel);
    if (existsSync(abs)) {
      skipped.push(rel);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    created.push(rel);
  }
  return { created, skipped };
}
