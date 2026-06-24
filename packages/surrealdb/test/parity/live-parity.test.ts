/**
 * PARITY — live round-trip against SurrealDB.
 *
 * Proves the DDL @schemic/core emits is ACCEPTED by a real SurrealDB (probed on 3.1.3)
 * and round-trips through `INFO FOR TABLE ... STRUCTURE`. Skipped automatically when no
 * DB is reachable (CI / no DB), exactly like `test/live`.
 *
 * ISOLATION: everything runs inside a dedicated scratch namespace `__sz_parity` and a
 * fresh database that is DROPPED on teardown. It NEVER touches the `tracker`/`@schemic/core`
 * namespaces. We drive the SDK directly with explicit `.use({ namespace, database })`
 * rather than the shared `tryConnect` helper (whose default db must not be written to).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { planKinds } from "@schemic/core";
import { Surreal, surql } from "surrealdb";
import { z } from "zod";
import { emitDefStatement, emitTable } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import {
  defineAccess,
  defineFunction,
  defineRelation,
  defineTable,
  s,
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
    "[parity-live] SurrealDB unreachable — skipping live parity tests",
  );

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
  s: s.string(),
  n: s.number(),
  i: s.int(),
  fl: s.float(),
  dec: s.decimal(),
  bi: s.bigint(),
  b: s.boolean(),
  dt: s.datetime(),
  dur: s.duration(),
  byt: s.bytes(),
  uid: s.uuid(),
  fil: s.file(),
  geo: s.geometry(),
  geop: s.geometry("point"),
  geocol: s.geometry("collection"),
  em: s.email(),
  url: s.url(),
  ip: s.ipv4(),
  lit: s.literal("admin"),
  litn: s.literal(42),
  en: s.enum(["a", "b"]),
  un: s.union([s.string(), s.number()]),
  tup: s.tuple([s.string(), s.number()]),
  rec: s.recordId("pl_big"),
  arr: s.array(s.string()),
  arrr: s.array(s.recordId("pl_big")),
  setf: s.set(s.string()),
  recmap: s.record(z.string(), s.number()),
  opt: s.string().optional(),
  nul: s.string().nullable(),
  nush: s.string().nullish(),
  obj: s.object({ a: s.string(), b: s.number().optional() }),
  flex: s.object({ a: s.string() }).flexible(),
  arrobj: s.array(s.object({ x: s.string() })),
  def: s.string().$default("pending"),
  defa: s.datetime().$defaultAlways(surql`time::now()`),
  val: s.string().$value(surql`string::lowercase($value)`),
  asrt: s.number().$assert(surql`$value > 0`),
  ro: s.string().$readonly(),
  cmt: s.string().$comment("a field"),
  perm: s.string().$permissions({ select: true, update: false }),
  intl: s.string().$internal(),
  idx: s.string().index(),
  uniq: s.string().unique(),
});

live("DB accepts @schemic/core's generated DDL", () => {
  test("the whole mixed-type table applies with ZERO rejections", async () => {
    const rejected = await applyEach(
      db!,
      emitTable(Big, { exists: "overwrite" }),
    );
    // Any rejection is a real bug — surface the exact statement(s).
    expect(rejected).toEqual([]);
  });

  test("INFO FOR TABLE STRUCTURE round-trips the field types we care about", async () => {
    const [info] = await db!.query<
      [{ fields: { name: string; kind?: string }[] }]
    >("INFO FOR TABLE pl_big STRUCTURE;");
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
    const Rel = defineRelation("pl_rel", { weight: s.number() })
      .from(Big)
      .to(Big);
    const Open = defineRelation("pl_rel_open", {});
    expect(
      await applyEach(db!, emitTable(Rel, { exists: "overwrite" })),
    ).toEqual([]);
    expect(
      await applyEach(db!, emitTable(Open, { exists: "overwrite" })),
    ).toEqual([]);
  });

  test("table-level clauses (ANY / DROP / PERMISSIONS / composite index)", async () => {
    const any = defineTable("pl_any", { id: z.string() }).typeAny();
    const drop = defineTable("pl_drop", { id: z.string() }).schemaless().drop();
    const perms = defineTable("pl_perms", { id: z.string() }).permissions({
      select: true,
      create: surql`$auth.id != NONE`,
    });
    const comp = defineTable("pl_comp", {
      id: z.string(),
      a: s.string(),
      b: s.string(),
    }).index("ab_idx", ["a", "b"], { unique: true });
    for (const t of [any, drop, perms, comp]) {
      expect(
        await applyEach(db!, emitTable(t, { exists: "overwrite" })),
      ).toEqual([]);
    }
  });

  test("event / function / access (record, jwt, bearer) apply cleanly", async () => {
    const ev = defineTable("pl_ev", {
      id: z.string(),
      email: s.email(),
    }).event("reverify", {
      when: surql`$before.email != $after.email`,
      // biome-ignore lint/suspicious/noThenProperty: event DSL "then" clause, not a thenable
      then: surql`UPDATE $after.id SET email = $after.email`,
    });
    expect(
      await applyEach(db!, emitTable(ev, { exists: "overwrite" })),
    ).toEqual([]);

    const fn = defineFunction("pl_greet", { name: s.string() })
      .returns(s.string())
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
      defineAccess("pl_svc")
        .bearer({ for: "record" })
        .duration({ grant: "30d" }),
    ];
    for (const a of accesses) {
      expect(
        await applyEach(db!, emitDefStatement(a, { exists: "overwrite" }).ddl),
      ).toEqual([]);
    }
  });

  test("access with default durations round-trips (no phantom OVERWRITE)", async () => {
    // Regression: SurrealDB materializes FOR TOKEN 1h (every access) + FOR GRANT 4w2d (BEARER) as
    // defaults; an access that omits them must not diff against the introspected materialized form.
    const defs = [
      defineAccess("pl_rt_rec").record(), // no duration
      defineAccess("pl_rt_rec2").record().duration({ session: "12h" }), // token omitted
      defineAccess("pl_rt_bear").bearer({ for: "user" }), // grant default
    ];
    for (const a of defs)
      await applyEach(db!, emitDefStatement(a, { exists: "overwrite" }).ddl);
    // Restrict to our names — the shared scratch DB also holds other objects.
    const plan = planKinds(
      surrealKinds,
      await introspectAll(db!),
      lowerAll([], defs),
    );
    expect(plan.up.filter((d) => /pl_rt_/.test(d))).toEqual([]);
  });
});

live("batch 1 + 2 features round-trip on the DB", () => {
  test("s.set() -> set<T>, sized array<T,N> / set<T,N> round-trip", async () => {
    const T = defineTable("pl_b2_coll", {
      id: z.string(),
      tags: s.set(s.string()),
      sized: s.array(s.string(), { max: 3 }),
      sizedset: s.set(s.int(), { max: 5 }),
    });
    expect(await applyEach(db!, emitTable(T, { exists: "overwrite" }))).toEqual(
      [],
    );
    const [info] = await db!.query<
      [{ fields: { name: string; kind?: string }[] }]
    >("INFO FOR TABLE pl_b2_coll STRUCTURE;");
    const kind = (n: string) => info.fields.find((f) => f.name === n)?.kind;
    expect(kind("tags")).toBe("set<string>");
    expect(kind("sized")).toBe("array<string, 3>");
    expect(kind("sizedset")).toBe("set<int, 5>");
  });

  test("record REFERENCE [ON DELETE …] via .$reference()", async () => {
    const T = defineTable("pl_b2_ref", {
      id: z.string(),
      author: s.recordId("pl_b2_ref").$reference({ onDelete: "cascade" }),
      friends: s
        .array(s.recordId("pl_b2_ref"))
        .$reference({ onDelete: "unset" }),
    });
    expect(await applyEach(db!, emitTable(T, { exists: "overwrite" }))).toEqual(
      [],
    );
  });

  test("TYPE RELATION … ENFORCED via .enforced()", async () => {
    const A = defineTable("pl_b2_a", { id: z.string() });
    const Rel = defineRelation("pl_b2_rel", {}).from(A).to(A).enforced();
    expect(await applyEach(db!, emitTable(A, { exists: "overwrite" }))).toEqual(
      [],
    );
    expect(
      await applyEach(db!, emitTable(Rel, { exists: "overwrite" })),
    ).toEqual([]);
  });

  test("all 10 batch-2 string::is_* validators are accepted (names are real)", async () => {
    const T = defineTable("pl_b2_val", {
      id: z.string(),
      a: s.alpha(),
      an: s.alphanum(),
      asc: s.ascii(),
      num: s.numeric(),
      sv: s.semver(),
      hx: s.hexadecimal(),
      lat: s.latitude(),
      lon: s.longitude(),
      ip: s.ip(),
      dom: s.domain(),
    });
    expect(await applyEach(db!, emitTable(T, { exists: "overwrite" }))).toEqual(
      [],
    );
  });
});

// --- These document live-confirmed GAPS: features the DB ACCEPTS but @schemic/core
//     cannot express (or expresses lossily). Marked todo so the suite stays green. ---
live("known gaps (DB supports these; @schemic/core does not)", () => {
  test("object-literal union is accepted by the DB (@schemic/core emits plain object)", async () => {
    const rejected = await applyEach(
      db!,
      `DEFINE TABLE pl_litobj SCHEMAFULL; DEFINE FIELD r ON TABLE pl_litobj TYPE { kind: "a", x: string } | { kind: "b", y: number };`,
    );
    expect(rejected).toEqual([]);
  });

  test.todo("GAP: FULLTEXT / vector (HNSW) indexes + DEFINE ANALYZER — see PARITY.md", () => {});
});

afterAll(async () => {
  if (db) {
    // Drop everything we created; leave the empty scratch namespace (cheap, isolated).
    await db.query(`REMOVE DATABASE IF EXISTS ${DB};`).catch(() => {});
    await db.close();
  }
});
