// Driver-contributed CLI commands (sc access rotate/check, sc table find) — run() logic against a live
// SurrealDB (gated on SURREAL_URL, like the other live tests). Core's dispatch is tested in @schemic/cli;
// here we cover the surreal dialect logic with a mock CommandContext.

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envSecretProvider } from "@schemic/core";
import { Surreal } from "surrealdb";
import { surrealCommands } from "../../src/commands";

const indexPath = join(import.meta.dir, "..", "..", "src", "index.ts");

const URL = process.env.SURREAL_URL;
const cmd = (k: string, v: string) =>
  surrealCommands.find((c) => c.kind === k && c.verb === v);

async function ctxWith(ns: string, schemaPath = "") {
  const conn = new Surreal();
  await conn.connect(URL as string);
  await conn.signin({ username: "root", password: "root" });
  await conn.use({ namespace: ns, database: ns });
  const out: string[] = [];
  const io = {
    ok: (m: string) => out.push(`OK ${m}`),
    fail: (m: string) => out.push(`FAIL ${m}`),
    info: (m: string) => out.push(`INFO ${m}`),
    prompt: async () => "x",
  };
  return {
    conn,
    out,
    ctx: {
      conn,
      config: { schemaPath },
      io,
      secrets: envSecretProvider,
    } as unknown as Parameters<NonNullable<ReturnType<typeof cmd>>["run"]>[0],
  };
}

describe.skipIf(!URL)("surreal driver commands", () => {
  test("table find <table> <col=value> returns matching rows", async () => {
    const { conn, out, ctx } = await ctxWith("cmd_find");
    await conn.query(
      'REMOVE TABLE IF EXISTS t; CREATE t:1 SET name="alice"; CREATE t:2 SET name="bob";',
    );
    await cmd("table", "find")!.run(ctx, {
      positionals: ["t", "name=bob"],
      flags: {},
    });
    expect(out.some((l) => l.startsWith("OK 1 row"))).toBe(true);
    expect(out.some((l) => l.includes('"name":"bob"'))).toBe(true);
    await conn.close();
  });

  test("access rotate re-applies DEFINE ACCESS OVERWRITE with the freshly-resolved secret", async () => {
    const schema = join(tmpdir(), "cmdtest_rotate.ts");
    await Bun.write(
      schema,
      `import { defineAccess, env } from "${indexPath}";\nexport const api = defineAccess("api").onDatabase().jwt({ alg: "HS512", key: env("ROT_KEY") });\n`,
    );
    process.env.ROT_KEY = "rotated-v2";
    const { conn, out, ctx } = await ctxWith("cmd_rotate", schema);
    await conn.query("REMOVE ACCESS IF EXISTS api ON DATABASE;"); // isolate from prior runs

    // dry-run: prints the OVERWRITE, resolves but does not apply
    await cmd("access", "rotate")!.run(ctx, {
      positionals: ["api"],
      flags: { "dry-run": true },
    });
    expect(out.some((l) => l.includes("DEFINE ACCESS OVERWRITE api"))).toBe(
      true,
    );
    expect(out.some((l) => l.includes("KEY $env_ROT_KEY"))).toBe(true);
    const [before]: [{ accesses?: Record<string, unknown> }] =
      await conn.query("INFO FOR DB");
    expect(before.accesses?.api).toBeUndefined(); // dry-run didn't apply

    // real: applies, access now exists, key stored redacted (no leak)
    out.length = 0;
    await cmd("access", "rotate")!.run(ctx, {
      positionals: ["api"],
      flags: {},
    });
    expect(out.some((l) => l.startsWith("OK rotated"))).toBe(true);
    const [after]: [{ accesses?: Record<string, unknown> }] =
      await conn.query("INFO FOR DB");
    expect(after.accesses?.api).toBeDefined();
    expect(JSON.stringify(after.accesses?.api)).not.toContain("rotated-v2");
    await conn.close();
  });

  test("access rotate rejects an access with no env()/secret() key", async () => {
    const schema = join(tmpdir(), "cmdtest_inline.ts");
    await Bun.write(
      schema,
      `import { defineAccess } from "${indexPath}";\nexport const inline = defineAccess("inline").onDatabase().jwt({ key: "literal" });\n`,
    );
    const { conn, ctx } = await ctxWith("cmd_inline", schema);
    await expect(
      cmd("access", "rotate")!.run(ctx, { positionals: ["inline"], flags: {} }),
    ).rejects.toThrow(/no env\(\)\/secret\(\)/);
    await conn.close();
  });

  test("access push applies all authored accesses (idempotent OVERWRITE)", async () => {
    const schema = join(tmpdir(), "cmdtest_push.ts");
    await Bun.write(
      schema,
      `import { defineAccess, surql } from "${indexPath}";\n` +
        `export const acct = defineAccess("acct").onDatabase().record().signin(surql\`SELECT * FROM user WHERE email = $email\`);\n` +
        `export const ext = defineAccess("ext").onDatabase().jwt({ url: "https://x/jwks.json" });\n`,
    );
    const { conn, out, ctx } = await ctxWith("cmd_push", schema);
    await conn.query(
      "REMOVE ACCESS IF EXISTS acct ON DATABASE; REMOVE ACCESS IF EXISTS ext ON DATABASE;",
    );
    // dry-run: prints, applies nothing
    await cmd("access", "push")!.run(ctx, {
      positionals: [],
      flags: { "dry-run": true },
    });
    const [before]: [{ accesses?: Record<string, unknown> }] =
      await conn.query("INFO FOR DB");
    expect(before.accesses?.acct).toBeUndefined();
    // real push (all): both applied, idempotent (run twice)
    out.length = 0;
    await cmd("access", "push")!.run(ctx, { positionals: [], flags: {} });
    await cmd("access", "push")!.run(ctx, { positionals: [], flags: {} });
    const [after]: [{ accesses?: Record<string, unknown> }] =
      await conn.query("INFO FOR DB");
    expect(after.accesses?.acct).toBeDefined();
    expect(after.accesses?.ext).toBeDefined();
    await conn.close();
  });

  test("access diff: in-sync after push (no phantom diff), plus new + orphan", async () => {
    const schema = join(tmpdir(), "cmdtest_diff.ts");
    await Bun.write(
      schema,
      `import { defineAccess, surql } from "${indexPath}";\n` +
        `export const acct = defineAccess("acct").onDatabase().record().signin(surql\`SELECT * FROM user WHERE email = $email\`).withRefresh();\n` +
        `export const ext = defineAccess("ext").onDatabase().jwt({ url: "https://x/jwks.json" });\n`,
    );
    const seed = await ctxWith("cmd_diff", schema);
    await seed.conn.query(
      "REMOVE ACCESS IF EXISTS acct ON DATABASE; REMOVE ACCESS IF EXISTS ext ON DATABASE; REMOVE ACCESS IF EXISTS stray ON DATABASE;",
    );
    await cmd("access", "push")!.run(seed.ctx, { positionals: [], flags: {} });
    // diff the SAME schema -> everything in sync (the phantom-diff guard)
    seed.out.length = 0;
    await cmd("access", "diff")!.run(seed.ctx, { positionals: [], flags: {} });
    expect(seed.out.some((l) => l.includes("OK all accesses in sync"))).toBe(
      true,
    );
    expect(seed.out.some((l) => l.includes("~ "))).toBe(false);
    // introduce a live-only orphan, and diff a slimmer schema (drops acct, adds a new bearer)
    await seed.conn.query(
      'DEFINE ACCESS stray ON DATABASE TYPE JWT URL "https://y/jwks.json";',
    );
    await seed.conn.close();
    const slim = join(tmpdir(), "cmdtest_diff_slim.ts");
    await Bun.write(
      slim,
      `import { defineAccess } from "${indexPath}";\n` +
        `export const ext = defineAccess("ext").onDatabase().jwt({ url: "https://x/jwks.json" });\n` +
        `export const fresh = defineAccess("fresh").onDatabase().bearer({ for: "user" });\n`,
    );
    const { conn, out, ctx } = await ctxWith("cmd_diff", slim);
    await cmd("access", "diff")!.run(ctx, { positionals: [], flags: {} });
    expect(out.some((l) => l.startsWith("INFO + fresh"))).toBe(true); // new
    expect(out.some((l) => l.startsWith("INFO = ext"))).toBe(true); // in sync
    expect(out.some((l) => l.includes("acct") && l.includes("orphan"))).toBe(
      true,
    ); // dropped from schema
    expect(out.some((l) => l.includes("stray") && l.includes("orphan"))).toBe(
      true,
    ); // live-only
    await conn.close();
  });
});
