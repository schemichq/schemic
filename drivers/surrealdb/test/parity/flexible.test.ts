/**
 * PARITY — `FLEXIBLE` fields round-trip (push + pull) against a real SurrealDB.
 *
 * SurrealDB allows `FLEXIBLE` on any field whose type contains an `object` — `object`, `array<object>`,
 * and unions like `object | string` — and always stores the clause on the FIELD (for `array<object>`
 * the auto-created `.*` element stays a plain `object`). These tests prove the emitter matches that
 * canonical form:
 *   - PUSH: author -> emit -> apply -> `planKinds(live, desired)` is EMPTY (no emitter divergence).
 *   - PULL: introspect -> `renderPerFile` re-renders `.loose()` so a re-emit keeps FLEXIBLE.
 *
 * Skipped automatically when no SurrealDB is reachable (CI), isolated in a scratch namespace/db.
 */
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { planKinds } from "@schemic/core";
import { Surreal } from "surrealdb";
import { renderPerFile } from "../../src/cli/pull";
import { introspectStructured } from "../../src/cli/structure";
import { emitTable } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import { defineTable, s, type TableDef } from "../../src/pure";

// The workspace gate runs every package's suite IN PARALLEL — PGlite's CPU burst can slow a live
// connect/DDL past bun's 5s DEFAULT hook timeout, failing the `beforeEach`/`afterAll` below as an
// "(unnamed)" test. `beforeAll`s that say `120_000` explicitly are already covered; the default
// applies to every hook that doesn't. Isolated runs are unaffected.
setDefaultTimeout(120_000);

const NS = "__sz_flexible";
const DB = "flexible";

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
if (!db) console.warn("[flexible] SurrealDB unreachable — skipping round-trip");

async function applyEach(conn: Surreal, ddl: string): Promise<void> {
  for (const st of ddl
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    await conn.query(`${st};`);
  }
}

// biome-ignore lint/suspicious/noExplicitAny: src TableDef vs the lib-typed registry bound at the seam.
type AnyTableDef = TableDef<string, any>;

/** PUSH: author == DB (planKinds empty). PULL: return the regenerated TS for assertions. */
async function roundTrip(t: AnyTableDef): Promise<{ pulled: string }> {
  await applyEach(db!, emitTable(t, { exists: "overwrite" }));
  const plan = planKinds(surrealKinds, await introspectAll(db!), lowerAll([t]));
  expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });
  const struct = await introspectStructured(db!);
  const pulled = renderPerFile(struct, (_k, n) => `${n}.ts`).get(
    `${t.name}.ts`,
  );
  if (!pulled) throw new Error(`no ${t.name}.ts in the pulled output`);
  return { pulled };
}

beforeEach(async () => {
  if (!db) return;
  await db.query(`REMOVE DATABASE IF EXISTS ${DB}; DEFINE DATABASE ${DB};`);
  await db.use({ namespace: NS, database: DB });
});

afterAll(async () => {
  if (db) {
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});

live("FLEXIBLE", () => {
  test("object FLEXIBLE round-trips; pull renders .loose()", async () => {
    const { pulled } = await roundTrip(
      defineTable("fx_obj", {
        id: s.string(),
        meta: s.object({ x: s.string() }).flexible(),
      }).schemafull(),
    );
    expect(pulled).toContain(".loose()");
  });

  test("array<object> FLEXIBLE rides the array field; pull renders .array().loose()", async () => {
    const { pulled } = await roundTrip(
      defineTable("fx_arr", {
        id: s.string(),
        rows: s.array(s.object({ x: s.string() })).flexible(),
      }).schemafull(),
    );
    expect(pulled).toContain(".array().loose()");
  });

  test("array<object> FLEXIBLE via the inner object spelling round-trips identically", async () => {
    await roundTrip(
      defineTable("fx_arr2", {
        id: s.string(),
        rows: s.array(s.object({ x: s.string() }).flexible()),
      }).schemafull(),
    );
  });

  test("object | string FLEXIBLE round-trips", async () => {
    await roundTrip(
      defineTable("fx_union", {
        id: s.string(),
        either: s.object({ x: s.string() }).flexible().or(s.string()),
      }).schemafull(),
    );
  });

  test("option<object> FLEXIBLE round-trips", async () => {
    const { pulled } = await roundTrip(
      defineTable("fx_opt", {
        id: s.string(),
        meta: s.object({ x: s.string() }).flexible().optional(),
      }).schemafull(),
    );
    expect(pulled).toContain(".loose()");
  });
});
