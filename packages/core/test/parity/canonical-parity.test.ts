/**
 * CANONICAL PARITY — the two DDL emitters must agree.
 *
 * @schemic/core has two "canonical DDL" emitters that have to produce identical output for an
 * equivalent schema, or the diff engine reports phantom changes:
 *   - the GENERATOR (`emit` in `ddl.ts`)        — TS defs -> DDL, used by offline `schemic gen`/`schemic diff`
 *   - the INTROSPECTOR (`canonical*` in `structure.ts`) — live `INFO … STRUCTURE` -> DDL, used by
 *     `schemic diff --live`/shadow-verify
 * They are independent today (each world compares against itself), but shadow-verify will compare
 * one against the other — so they must converge. This harness applies a broad corpus to a real DB,
 * reads it back, and asserts the generator's snapshot DDL equals the introspected DDL per object.
 *
 * Auto-skips when no DB is reachable. The remaining known divergences live in `ALLOWLIST` and are
 * being driven to zero (generator-side: union sort, single-quoted literals, default-op omission);
 * the function-body case is irreducible without a SurrealQL parser (SurrealDB reformats the verbatim
 * expression's quotes) and is the designed-residual that shadow-verify, not the offline path, owns.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Surreal, surql } from "surrealdb";
import { z } from "zod";
import { buildSnapshot } from "../../src/cli/surreal-diff";
import { introspect } from "../../src/cli/introspect";
import { emitDefStatement, emitTable } from "../../src/ddl";
import { defineFunction, defineRelation, defineTable, s } from "../../src/pure";

const NS = "__sz_canon";
const DB = "canon";

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
if (!db) console.warn("[canonical-parity] SurrealDB unreachable — skipping");

// A broad corpus exercising the clause space (types, perms, defaults, indexes, events, relation, fn).
const Big = defineTable("c_big", {
  id: z.string(),
  s: s.string(),
  i: s.int(),
  n: s.number(),
  dt: s.datetime(),
  b: s.boolean(),
  uid: s.uuid(),
  rec: s.recordId("c_big"),
  arr: s.array(s.string()),
  arrn: s.array(s.string(), { max: 3 }),
  setf: s.set(s.string()),
  un: s.union([s.string(), s.number()]),
  opt: s.string().optional(),
  obj: s.object({ a: s.string(), b: s.number().optional() }),
  flex: s.object({ a: s.string() }).flexible(),
  def: s.string().$default("pending"),
  defa: s.datetime().$defaultAlways(surql`time::now()`),
  val: s.string().$value(surql`string::lowercase($value)`),
  asrt: s.number().$assert(surql`$value > 0`),
  ro: s.string().$readonly(),
  cmt: s.string().$comment("a field"),
  perm: s.string().$permissions({ select: true, update: false }),
  idx: s.string().index(),
  uniq: s.string().unique(),
});
const Schemaless = defineTable("c_less", { id: z.string() }).schemaless();
const Commented = defineTable("c_cmt", { id: z.string() }).comment("hello");
const Perms = defineTable("c_perms", { id: z.string() }).permissions({
  select: true,
  create: surql`$auth.id != NONE`,
});
const Comp = defineTable("c_comp", {
  id: z.string(),
  a: s.string(),
  b: s.string(),
}).index("ab", ["a", "b"], { unique: true });
const Ev = defineTable("c_ev", { id: z.string(), email: s.email() }).event(
  "re",
  {
    when: surql`$before.email != $after.email`,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the SurrealQL THEN clause, not a PromiseLike.
    then: surql`UPDATE $after.id SET email = $after.email`,
  },
);
const Rel = defineRelation("c_rel", { weight: s.number() }).from(Big).to(Big);
const Fn = defineFunction("c_greet", { name: s.string() })
  .returns(s.string())
  .body(surql`RETURN "Hi " + $name`);

// The corpus mixes TableDef/RelationDef/FunctionDef; the CLI snapshot/emit helpers take their own
// (`AnyTable`/`StandaloneDef`) shapes, which tsc can't reconcile across the self-referential package
// for a heterogeneous array — so feed them through a typed alias of the helpers' own parameters.
const TABLES = [Big, Schemaless, Commented, Perms, Comp, Ev, Rel];
const DEFS = [Fn];
const asTables = TABLES as unknown as Parameters<typeof buildSnapshot>[0];
const asDefs = DEFS as unknown as Parameters<typeof buildSnapshot>[1];

// Known, not-yet-closed divergences (generator-side work) + the irreducible verbatim-expression one.
const ALLOWLIST = new Set([
  "field:c_big:un", // generator does not sort union members yet
  "field:c_big:def", // generator emits a double-quoted string DEFAULT
  "field:c_big:perm", // generator keeps an explicit default-valued perm op (FOR create FULL)
  "function::c_greet", // verbatim surql body keeps double quotes (SurrealDB single-quotes it)
]);

async function applyEach(conn: Surreal, ddl: string): Promise<void> {
  for (const st of ddl
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    await conn.query(`${st};`);
  }
}

live("generator-form DDL matches INFO-canonical DDL", () => {
  test("no unexpected per-object divergences across the corpus", async () => {
    for (const t of TABLES)
      await applyEach(db!, emitTable(t, { exists: "overwrite" }));
    for (const d of DEFS)
      await applyEach(db!, emitDefStatement(d, { exists: "overwrite" }).ddl);

    const gen = buildSnapshot(asTables, asDefs);
    const info = await introspect(
      db!,
      new Set(["_migrations", "_migrations_lock"]),
    );

    const unexpected: { key: string; gen: string; info: string }[] = [];
    for (const [key, g] of Object.entries(gen.statements)) {
      const l = info.statements[key];
      // Every generated object must exist in the live introspection.
      expect(l, `missing in live introspection: ${key}`).toBeDefined();
      if (l && g.ddl !== l.ddl && !ALLOWLIST.has(key))
        unexpected.push({ key, gen: g.ddl, info: l.ddl });
    }
    // Any divergence not on the allowlist is a real, new canonical-form bug — surface it.
    expect(unexpected).toEqual([]);
  });
});

afterAll(async () => {
  if (db) {
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});
