/**
 * The Struct-IR keystone proof: `normalize(fromTableDef(schema))` must deep-equal
 * `normalize(fromInfo(schema applied to a real DB))` — i.e. the offline lowering and the live
 * INFO lowering converge on one normal form. Applies a broad corpus to a scratch SurrealDB and
 * compares the two per object. Skips when no DB is reachable.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Surreal, surql } from "surrealdb";
import { z } from "zod";
import { fromStandalone, fromTableDef } from "../../src/cli/lower";
import { renderSchemaToTS } from "../../src/cli/pull";
import {
  deepEqual,
  normalizeAccess,
  normalizeDb,
  normalizeFunction,
  normalizeTable,
} from "../../src/cli/struct";
import {
  type DbStructured,
  introspectStructured,
} from "../../src/cli/structure";
import { emitDefStatement, emitStatements } from "../../src/ddl";
import { defineFunction, defineRelation, defineTable, s } from "../../src/pure";

const NS = "__sz_structparity";
const DB = "sp";

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
if (!db) console.warn("[struct-parity] SurrealDB unreachable — skipping");

// A broad corpus exercising the clause space (types, perms, defaults, asserts, index, nested
// objects, arrays, records, literal unions, relation, function).
const Big = defineTable("sp_big", {
  id: z.string(),
  s: s.string(),
  i: s.int(),
  dt: s.datetime(),
  uid: s.uuid(),
  rec: s.recordId("sp_big"),
  arr: s.array(s.string()),
  arrn: s.array(s.string(), { max: 3 }),
  setf: s.set(s.string()),
  opt: s.string().optional(),
  role: s.enum(["admin", "user"]),
  obj: s.object({ a: s.string(), b: s.number().optional() }),
  def: s.string().$default("pending"),
  defa: s.datetime().$defaultAlways(surql`time::now()`),
  val: s.string().$value(surql`string::lowercase($value)`),
  asrt: s.number().$assert(surql`$value > 0`),
  ro: s.string().$readonly(),
  cmt: s.string().$comment("a field"),
  perm: s.string().$permissions({ select: true, update: false }),
  uniq: s.string().unique(),
}).permissions({ select: true, create: surql`$auth.id != NONE` });
const Less = defineTable("sp_less", { id: z.string() })
  .schemaless()
  .comment("c");
const Rel = defineRelation("sp_likes", { id: z.string() }).from(Big).to(Big);
const Fn = defineFunction("sp_add", { a: s.int(), b: s.int() })
  .returns(s.int())
  .body(surql`RETURN $a + $b;`);

const TABLES = [Big, Less, Rel];
const DEFS = [Fn];
const asTable = (t: unknown) => t as Parameters<typeof fromTableDef>[0];
const asDef = (d: unknown) => d as Parameters<typeof fromStandalone>[0];

live("struct-parity", () => {
  afterAll(async () => {
    await db?.close().catch(() => {});
  });

  test("fromTableDef converges with fromInfo across the corpus", async () => {
    if (!db) return;
    for (const t of TABLES)
      for (const s of emitStatements(asTable(t))) await db.query(s.ddl);
    for (const d of DEFS) await db.query(emitDefStatement(asDef(d)).ddl);

    const info = await introspectStructured(db, new Set());
    const liveTable = new Map(info.tables.map((x) => [x.name, x]));
    const liveFn = new Map(info.functions.map((x) => [x.name, x]));
    const liveAccess = new Map(info.accesses.map((x) => [x.name, x]));

    const diverged: string[] = [];
    const report = (name: string, a: unknown, b: unknown) => {
      diverged.push(name);
      console.error(`\n=== DIVERGE ${name} ===`);
      console.error("fromTableDef:", JSON.stringify(a, null, 1));
      console.error("fromInfo:    ", JSON.stringify(b, null, 1));
    };

    for (const t of TABLES) {
      const name = asTable(t).name;
      const a = normalizeTable(fromTableDef(asTable(t)));
      const liveStruct = liveTable.get(name);
      if (!liveStruct) {
        report(`table ${name}`, a, "MISSING");
        continue;
      }
      const b = normalizeTable(liveStruct);
      if (!deepEqual(a, b)) report(`table ${name}`, a, b);
    }
    for (const d of DEFS) {
      const lowered = fromStandalone(asDef(d));
      const name = lowered.name;
      const fn = liveFn.get(name);
      const ac = liveAccess.get(name);
      if (fn) {
        const a = normalizeFunction(
          lowered as Parameters<typeof normalizeFunction>[0],
        );
        if (!deepEqual(a, normalizeFunction(fn)))
          report(`function ${name}`, a, normalizeFunction(fn));
      } else if (ac) {
        const a = normalizeAccess(
          lowered as Parameters<typeof normalizeAccess>[0],
        );
        if (!deepEqual(a, normalizeAccess(ac)))
          report(`access ${name}`, a, normalizeAccess(ac));
      } else {
        report(`def ${name}`, lowered, "MISSING");
      }
    }

    expect(diverged).toEqual([]);
  });

  test("diff --ts: rendering both sides to TS converges (no spurious change)", async () => {
    if (!db) return;
    // Both sides already applied in the test above; re-introspect the live (current) side.
    const live = await introspectStructured(db, new Set());
    const schema: DbStructured = {
      tables: TABLES.map((t) => fromTableDef(asTable(t))),
      functions: DEFS.map((d) => fromStandalone(asDef(d))).filter(
        (x): x is Parameters<typeof normalizeFunction>[0] => "block" in x,
      ),
      accesses: [],
    };
    // Restrict the live side to the corpus objects (the scratch DB holds only these).
    const names = new Set(schema.tables.map((t) => t.name));
    const liveCorpus: DbStructured = {
      tables: live.tables.filter((t) => names.has(t.name)),
      functions: live.functions.filter((f) =>
        schema.functions.some((s) => s.name === f.name),
      ),
      accesses: [],
    };
    expect(renderSchemaToTS(normalizeDb(schema))).toBe(
      renderSchemaToTS(normalizeDb(liveCorpus)),
    );
  });
});
