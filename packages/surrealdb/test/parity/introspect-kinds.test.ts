/**
 * PARITY — `introspectAll` round-trip (kind registry, reverse path).
 *
 * Proves the flip's reverse hook `introspectAll(conn)` is COMPLETE + canonical: a schema applied to a
 * real SurrealDB and read back introspects to per-kind objects that canonicalize IDENTICALLY to the
 * lowered authoring side — so `planKinds(registry, introspectAll(db), lowerAll(authored))` is EMPTY (no
 * phantom presence/content diff) for every round-tripping kind. Skipped when no DB is reachable (CI),
 * exactly like the other live parity suites. Isolated in its own scratch namespace/db, dropped on teardown.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { planKinds } from "@schemic/core";
import { Surreal, surql } from "surrealdb";
import { emitDefStatement, emitTable } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import { defineFunction, defineTable, s } from "../../src/pure";

const NS = "__sz_kind_introspect";
const DB = "kind_introspect";

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

const db = await connectScratch();
const live = describe.skipIf(!db);
if (!db)
  console.warn(
    "[introspect-kinds] SurrealDB unreachable — skipping introspectAll round-trip",
  );

async function apply(conn: Surreal, ddl: string): Promise<void> {
  for (const st of ddl
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean))
    await conn.query(`${st};`);
}

// A schema spanning table/field/index/event + a db-level function — all round-tripping kinds, chosen to
// avoid the allowlisted canonical divergences (no unions, no quoted DEFAULTs, numeric function body).
const User = defineTable("ik_user", {
  id: s.string(),
  name: s.string().unique(),
  age: s.int(),
  active: s.boolean(),
}).event("touch", {
  // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable.
  then: surql`UPDATE $after.id SET seen = true`,
});
const Add = defineFunction("ik_add", { a: s.int(), b: s.int() })
  .returns(s.int())
  .body(surql`RETURN $a + $b`);

live("introspectAll round-trips every kind to a zero diff", () => {
  test("apply -> introspectAll -> planKinds(live, desired) is empty", async () => {
    await apply(db!, emitTable(User));
    await apply(db!, emitDefStatement(Add).ddl);

    const liveObjects = await introspectAll(db!);
    const desired = lowerAll([User], [Add]);

    // Sanity: introspectAll returned objects for each kind (presence completeness).
    const kinds = new Set(liveObjects.map((o) => o.kind));
    expect(kinds.has("table")).toBe(true);
    expect(kinds.has("index")).toBe(true);
    expect(kinds.has("event")).toBe(true);
    expect(kinds.has("function")).toBe(true);

    const { up, down } = planKinds(surrealKinds, liveObjects, desired);
    expect(up).toEqual([]);
    expect(down).toEqual([]);
  });
});

afterAll(async () => {
  if (db) {
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});
