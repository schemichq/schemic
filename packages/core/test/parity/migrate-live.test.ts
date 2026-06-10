/**
 * MIGRATIONS — live round-trip against SurrealDB.
 *
 * Proves the migration engine's clause-level `ALTER FIELD` (and index `REMOVE`+`DEFINE`) deltas
 * are ACCEPTED by a real SurrealDB and round-trip: apply v1, apply the generated up-migration to
 * reach v2 (verified via `INFO FOR TABLE … STRUCTURE`), then the down-migration to revert to v1.
 * Auto-skips when no DB is reachable. Imports `defineTable`/`sz` by PACKAGE name so the table
 * types line up with the `surreal-zod`-typed diff-engine signatures.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { defineTable, emitTable, sz } from "surreal-zod";
import { Surreal } from "surrealdb";
import { z } from "zod";
import { buildSnapshot, diffSnapshots } from "../../src/cli/diff";

const NS = "__sz_migrate";
const DB = "ml";

async function connectScratch(): Promise<Surreal | null> {
  const db = new Surreal();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await db.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc");
        await db.signin({
          username: process.env.SURREAL_USER ?? "root",
          password: process.env.SURREAL_PASS ?? "root",
        });
        await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${NS};`);
        await db.use({ namespace: NS, database: DB });
        await db.query(
          `REMOVE DATABASE IF EXISTS ${DB}; DEFINE DATABASE ${DB};`,
        );
        await db.use({ namespace: NS, database: DB });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("connect timeout")), 2000);
      }),
    ]);
    return db;
  } catch {
    await db.close().catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Apply a multi-statement DDL string one statement at a time, returning rejections. */
async function applyEach(conn: Surreal, ddl: string): Promise<string[]> {
  const stmts = ddl
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
  const rejected: string[] = [];
  for (const st of stmts) {
    try {
      await conn.query(st);
    } catch (e) {
      rejected.push(`${st}  ::  ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return rejected;
}

type Info = { fields: { name: string; kind?: string; comment?: string }[] };
const db = await connectScratch();
const live = describe.skipIf(!db);
if (!db)
  console.warn(
    "[migrate-live] SurrealDB unreachable — skipping live migrations",
  );

live("clause-level ALTER migrations apply + round-trip", () => {
  test("ALTER FIELD deltas + index REMOVE/DEFINE, up then down", async () => {
    const v1 = defineTable("ml_user", {
      id: z.string(),
      name: sz.string(),
      email: sz.string(),
      age: sz.int().index(),
    });
    const v2 = defineTable("ml_user", {
      id: z.string(),
      name: sz.string().optional(), // TYPE string -> option<string>
      email: sz.string().$comment("addr"), // + COMMENT
      age: sz.int().unique(), // index -> unique (REMOVE + DEFINE)
    });

    // Apply v1.
    expect(
      await applyEach(db!, emitTable(v1, { exists: "overwrite" })),
    ).toEqual([]);

    const diff = diffSnapshots(buildSnapshot([v1]), buildSnapshot([v2]));
    // The engine should produce clause-level ALTERs and a REMOVE+DEFINE for the index.
    expect(diff.up.some((s) => s.startsWith("ALTER FIELD name"))).toBe(true);
    expect(diff.up.some((s) => s.startsWith("ALTER FIELD email"))).toBe(true);
    expect(diff.up.some((s) => s.startsWith("REMOVE INDEX"))).toBe(true);

    // Apply UP — every generated statement must be accepted by the DB.
    for (const s of diff.up) expect(await applyEach(db!, s)).toEqual([]);

    const structure = async () =>
      (await db!.query<[Info]>("INFO FOR TABLE ml_user STRUCTURE;"))[0];
    let info = await structure();
    const field = (n: string) => info.fields.find((f) => f.name === n);
    expect(field("name")?.kind).toBe("none | string"); // now optional
    expect(field("email")?.comment).toBeTruthy(); // comment added

    // Apply DOWN — reverts to v1.
    for (const s of diff.down) expect(await applyEach(db!, s)).toEqual([]);
    info = await structure();
    expect(field("name")?.kind).toBe("string"); // back to required
    expect(field("email")?.comment).toBeFalsy(); // comment dropped
  });

  test("ALTER TABLE clause deltas (schema mode + comment), up then down", async () => {
    const v1 = defineTable("ml_t", { id: z.string(), name: sz.string() });
    const v2 = defineTable("ml_t", { id: z.string(), name: sz.string() })
      .schemaless()
      .comment("notes");

    expect(
      await applyEach(db!, emitTable(v1, { exists: "overwrite" })),
    ).toEqual([]);
    const diff = diffSnapshots(buildSnapshot([v1]), buildSnapshot([v2]));
    expect(diff.up.some((s) => s.startsWith("ALTER TABLE ml_t"))).toBe(true);

    // Apply UP.
    for (const s of diff.up) expect(await applyEach(db!, s)).toEqual([]);
    const tableDef = async () =>
      (await db!.query<[{ tables: Record<string, string> }]>("INFO FOR DB;"))[0]
        .tables.ml_t;
    let def = await tableDef();
    expect(def).toContain("SCHEMALESS");
    expect(def).toContain("COMMENT");

    // Apply DOWN — reverts to v1 (schemafull, no comment).
    for (const s of diff.down) expect(await applyEach(db!, s)).toEqual([]);
    def = await tableDef();
    expect(def).toContain("SCHEMAFULL");
    expect(def).not.toContain("COMMENT");
  });
});

afterAll(async () => {
  if (db) {
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});
