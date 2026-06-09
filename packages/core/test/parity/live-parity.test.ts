/**
 * PARITY — live round-trip against SurrealDB.
 *
 * Proves the DDL surreal-zod emits is ACCEPTED by a real SurrealDB (probed on 3.1.3)
 * and round-trips through `INFO FOR TABLE ... STRUCTURE`. Skipped automatically when no
 * DB is reachable (CI / no DB), exactly like `test/live`.
 *
 * ISOLATION: everything runs inside a dedicated scratch namespace `__sz_parity` and a
 * fresh database that is DROPPED on teardown. It NEVER touches the `tracker`/`surreal-zod`
 * namespaces. We drive the SDK directly with explicit `.use({ namespace, database })`
 * rather than the shared `tryConnect` helper (whose default db must not be written to).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Surreal, surql } from "surrealdb";
import { z } from "zod";
import { emitDefStatement, emitTable } from "../../src/ddl";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  sz,
} from "../../src/pure";

const NS = "__sz_parity";
const DB = "parity_live";

/** Connect to a scratch namespace/db, or null when no DB is reachable. */
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
        // Fresh, empty scratch db.
        await db.query(`REMOVE DATABASE IF EXISTS ${DB}; DEFINE DATABASE ${DB};`);
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
  console.warn("[parity-live] SurrealDB unreachable — skipping live parity tests");

/** Apply a multi-statement DDL string one statement at a time, returning rejections. */
async function applyEach(
  conn: Surreal,
  ddl: string,
): Promise<{ stmt: string; error: string }[]> {
  const stmts = ddl
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${s};`);
  const rejected: { stmt: string; error: string }[] = [];
  for (const st of stmts) {
    try {
      await conn.query(st);
    } catch (e) {
      rejected.push({ stmt: st, error: (e as Error).message.split("\n")[0] });
    }
  }
  return rejected;
}

// A broad mixed-type table exercising most of the type system + every field clause.
const Big = defineTable("pl_big", {
  id: z.string(),
  s: sz.string(),
  n: sz.number(),
  i: sz.int(),
  fl: sz.float(),
  dec: sz.decimal(),
  bi: sz.bigint(),
  b: sz.boolean(),
  dt: sz.datetime(),
  dur: sz.duration(),
  byt: sz.bytes(),
  uid: sz.uuid(),
  fil: sz.file(),
  geo: sz.geometry(),
  geop: sz.geometry("point"),
  geocol: sz.geometry("collection"),
  em: sz.email(),
  url: sz.url(),
  ip: sz.ipv4(),
  lit: sz.literal("admin"),
  litn: sz.literal(42),
  en: sz.enum(["a", "b"]),
  un: sz.union([sz.string(), sz.number()]),
  tup: sz.tuple([sz.string(), sz.number()]),
  rec: sz.recordId("pl_big"),
  arr: sz.array(sz.string()),
  arrr: sz.array(sz.recordId("pl_big")),
  setf: sz.set(sz.string()),
  recmap: sz.record(z.string(), sz.number()),
  opt: sz.string().optional(),
  nul: sz.string().nullable(),
  nush: sz.string().nullish(),
  obj: sz.object({ a: sz.string(), b: sz.number().optional() }),
  flex: sz.object({ a: sz.string() }).flexible(),
  arrobj: sz.array(sz.object({ x: sz.string() })),
  def: sz.string().$default("pending"),
  defa: sz.datetime().$defaultAlways(surql`time::now()`),
  val: sz.string().$value(surql`string::lowercase($value)`),
  asrt: sz.number().$assert(surql`$value > 0`),
  ro: sz.string().$readonly(),
  cmt: sz.string().$comment("a field"),
  perm: sz.string().$permissions({ select: true, update: false }),
  intl: sz.string().$internal(),
  idx: sz.string().index(),
  uniq: sz.string().unique(),
});

live("DB accepts surreal-zod's generated DDL", () => {
  test("the whole mixed-type table applies with ZERO rejections", async () => {
    const rejected = await applyEach(
      db!,
      emitTable(Big, { exists: "overwrite" }),
    );
    // Any rejection is a real bug — surface the exact statement(s).
    expect(rejected).toEqual([]);
  });

  test("INFO FOR TABLE STRUCTURE round-trips the field types we care about", async () => {
    const [info] = await db!.query<[{ fields: { name: string; kind?: string }[] }]>(
      "INFO FOR TABLE pl_big STRUCTURE;",
    );
    const kind = (n: string) => info.fields.find((f) => f.name === n)?.kind;
    expect(kind("uid")).toBe("uuid");
    expect(kind("dt")).toBe("datetime");
    expect(kind("dur")).toBe("duration");
    expect(kind("dec")).toBe("decimal");
    expect(kind("byt")).toBe("bytes");
    expect(kind("fil")).toBe("file");
    expect(kind("rec")).toBe("record<pl_big>");
    expect(kind("geop")).toBe("geometry<point>");
    // The DB canonicalizes `option<string>` to its desugared `none | string` form (equivalent).
    expect(kind("opt")).toBe("none | string");
    expect(kind("lit")).toBe("'admin'");
  });

  test("relations (restricted + open) apply cleanly", async () => {
    const Rel = defineRelation("pl_rel", { weight: sz.number() })
      .from(Big)
      .to(Big);
    const Open = defineRelation("pl_rel_open", {});
    expect(await applyEach(db!, emitTable(Rel, { exists: "overwrite" }))).toEqual(
      [],
    );
    expect(
      await applyEach(db!, emitTable(Open, { exists: "overwrite" })),
    ).toEqual([]);
  });

  test("table-level clauses (ANY / DROP / PERMISSIONS / composite index)", async () => {
    const any = defineTable("pl_any", { id: z.string() }).typeAny();
    const drop = defineTable("pl_drop", { id: z.string() })
      .schemaless()
      .drop();
    const perms = defineTable("pl_perms", { id: z.string() }).permissions({
      select: true,
      create: surql`$auth.id != NONE`,
    });
    const comp = defineTable("pl_comp", {
      id: z.string(),
      a: sz.string(),
      b: sz.string(),
    }).index("ab_idx", ["a", "b"], { unique: true });
    for (const t of [any, drop, perms, comp]) {
      expect(await applyEach(db!, emitTable(t, { exists: "overwrite" }))).toEqual(
        [],
      );
    }
  });

  test("event / function / access (record, jwt, bearer) apply cleanly", async () => {
    const ev = defineTable("pl_ev", { id: z.string(), email: sz.email() }).event(
      "reverify",
      {
        when: surql`$before.email != $after.email`,
        then: surql`UPDATE $after.id SET email = $after.email`,
      },
    );
    expect(await applyEach(db!, emitTable(ev, { exists: "overwrite" }))).toEqual(
      [],
    );

    const fn = defineFunction("pl_greet", { name: sz.string() })
      .returns(sz.string())
      .body(surql`RETURN "Hi " + $name`);
    expect(
      await applyEach(db!, emitDefStatement(fn, { exists: "overwrite" }).ddl),
    ).toEqual([]);

    const accesses = [
      defineAccess("pl_app")
        .record()
        .signin(surql`SELECT * FROM pl_big WHERE email = $email`)
        .duration({ token: "1h", session: "12h" }),
      defineAccess("pl_jwt").jwt({ alg: "HS512", key: "supersecretvalue" }),
      defineAccess("pl_svc").bearer({ for: "record" }).duration({ grant: "30d" }),
    ];
    for (const a of accesses) {
      expect(
        await applyEach(db!, emitDefStatement(a, { exists: "overwrite" }).ddl),
      ).toEqual([]);
    }
  });
});

// --- These document live-confirmed GAPS: features the DB ACCEPTS but surreal-zod
//     cannot express (or expresses lossily). Marked todo so the suite stays green. ---
live("known gaps (DB supports these; surreal-zod does not)", () => {
  test("set<T> is a DISTINCT round-tripping type on the DB (sz.set emits array<T>)", async () => {
    await db!.query(
      "DEFINE TABLE pl_set SCHEMAFULL; DEFINE FIELD s ON TABLE pl_set TYPE set<string>;",
    );
    const [info] = await db!.query<[{ fields: { name: string; kind?: string }[] }]>(
      "INFO FOR TABLE pl_set STRUCTURE;",
    );
    // The DB keeps `set<string>` (it is NOT normalized to array<string>) — so emitting
    // array<string> for sz.set() genuinely loses the dedup semantics.
    expect(info.fields.find((f) => f.name === "s")?.kind).toBe("set<string>");
  });

  test("REFERENCE / ON DELETE is accepted by the DB (no surreal-zod API)", async () => {
    const rejected = await applyEach(
      db!,
      "DEFINE TABLE pl_ref SCHEMAFULL; DEFINE FIELD author ON TABLE pl_ref TYPE option<array<record<pl_ref>>> REFERENCE ON DELETE UNSET;",
    );
    expect(rejected).toEqual([]); // DB accepts it; surreal-zod can't emit it
  });

  test("object-literal union is accepted by the DB (surreal-zod emits plain object)", async () => {
    const rejected = await applyEach(
      db!,
      `DEFINE TABLE pl_litobj SCHEMAFULL; DEFINE FIELD r ON TABLE pl_litobj TYPE { kind: "a", x: string } | { kind: "b", y: number };`,
    );
    expect(rejected).toEqual([]);
  });

  test.todo("GAP: sz.set() should emit set<T> — see PARITY.md");
  test.todo("GAP: .reference()/ON DELETE record-reference builder — see PARITY.md");
  test.todo("GAP: FULLTEXT / vector (HNSW) indexes + DEFINE ANALYZER — see PARITY.md");
});

afterAll(async () => {
  if (db) {
    // Drop everything we created; leave the empty scratch namespace (cheap, isolated).
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});
