/**
 * PARITY — full `DEFINE TABLE` syntax round-trip (push + pull) against a real SurrealDB.
 *
 * Exercises every reasonable permutation of the `DEFINE TABLE` head — schema mode, TYPE
 * (NORMAL/ANY/RELATION [FROM/TO][ENFORCED]), DROP, CHANGEFEED [INCLUDE ORIGINAL], PERMISSIONS, COMMENT,
 * and realistic combinations — and asserts each one round-trips BOTH ways:
 *   - PUSH: author -> emit DDL -> apply -> `introspectAll` -> `planKinds(live, desired)` is EMPTY (the DB
 *     stored exactly what we authored; canonical-vs-canonical, no emitter divergence).
 *   - PULL: introspect -> `renderPerFile` regenerates the authoring call for the clause (so a `pull`
 *     reproduces the table faithfully).
 *
 * `AS SELECT` pre-computed view tables (`defineView`) are covered too — the full `DEFINE TABLE` head.
 * Skipped automatically when no SurrealDB is reachable (CI), isolated in a scratch namespace/db reset
 * before each test.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { planKinds } from "@schemic/core";
import { Surreal, surql } from "surrealdb";
import { renderPerFile } from "../../src/cli/pull";
import { introspectStructured } from "../../src/cli/structure";
import { emitTable } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import {
  defineRelation,
  defineTable,
  defineView,
  s,
  type TableDef,
} from "../../src/pure";

const NS = "__sz_deftable";
const DB = "deftable";

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
if (!db)
  console.warn("[define-table] SurrealDB unreachable — skipping round-trip");

/** Apply a multi-statement DDL string one statement at a time, surfacing any rejection. */
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

/**
 * The full round-trip for a set of tables (applied in order — endpoints before relations):
 *   - PUSH: apply each table's DDL, then `planKinds(introspectAll, lowerAll)` must be EMPTY.
 *   - PULL: render `main`'s pulled `.ts`; the caller asserts the clauses on it.
 * Returns the pulled TS for `main` so the test can assert pull fidelity.
 */
async function roundTrip(
  tables: AnyTableDef[],
  main: string,
): Promise<{ pulled: string }> {
  for (const t of tables)
    await applyEach(db!, emitTable(t, { exists: "overwrite" }));

  // PUSH: what we authored == what the DB stored (canonical both sides, so no emitter divergence).
  const plan = planKinds(
    surrealKinds,
    await introspectAll(db!),
    lowerAll(tables),
  );
  expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });

  // PULL: regenerate TS from the introspected DB.
  const struct = await introspectStructured(db!);
  const pulled = renderPerFile(struct, (_k, n) => `${n}.ts`).get(`${main}.ts`);
  if (!pulled) throw new Error(`no ${main}.ts in the pulled output`);
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

const Base = (name: string) =>
  defineTable(name, { id: s.string(), name: s.string() });

// --- schema mode -------------------------------------------------------------------------------

live("schema mode", () => {
  test("SCHEMAFULL (default) round-trips; pull renders no .schemaless()", async () => {
    const { pulled } = await roundTrip([Base("dt_full")], "dt_full");
    expect(pulled).not.toContain(".schemaless()");
  });

  test("SCHEMALESS round-trips; pull renders .schemaless()", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_less").schemaless()],
      "dt_less",
    );
    expect(pulled).toContain(".schemaless()");
  });
});

// --- TYPE --------------------------------------------------------------------------------------

live("TYPE", () => {
  test("TYPE NORMAL (default) round-trips", async () => {
    const { pulled } = await roundTrip([Base("dt_normal")], "dt_normal");
    expect(pulled).toContain("defineTable(");
  });

  test("TYPE ANY round-trips; pull renders .typeAny()", async () => {
    const { pulled } = await roundTrip([Base("dt_any").typeAny()], "dt_any");
    expect(pulled).toContain(".typeAny()");
  });

  test("TYPE RELATION (open, no endpoints) round-trips", async () => {
    const { pulled } = await roundTrip(
      [defineRelation("dt_rel", {})],
      "dt_rel",
    );
    expect(pulled).toContain("defineRelation(");
  });

  test("TYPE RELATION FROM/TO round-trips; pull renders .from()/.to()", async () => {
    const A = Base("dt_a");
    const B = Base("dt_b");
    const Edge = defineRelation("dt_edge", {}).from(A).to(B);
    const { pulled } = await roundTrip([A, B, Edge], "dt_edge");
    expect(pulled).toContain(".from(");
    expect(pulled).toContain(".to(");
  });

  test("TYPE RELATION … ENFORCED round-trips; pull renders .enforced()", async () => {
    const A = Base("dt_ea");
    const B = Base("dt_eb");
    const Edge = defineRelation("dt_eedge", {}).from(A).to(B).enforced();
    const { pulled } = await roundTrip([A, B, Edge], "dt_eedge");
    expect(pulled).toContain(".enforced()");
  });

  test("NORMAL table with record fields named in/out round-trips; pull keeps them", async () => {
    // NOT a relation — `in`/`out` are ordinary record fields here. They're only implicit endpoints
    // on a RELATION, so pull must NOT strip them on a plain table. Mirrors a real-world `order` table
    // (DEFINE TABLE order SCHEMAFULL with `in` record<person> / `out` record<product>).
    const Person = Base("dt_person");
    const Product = Base("dt_product");
    const Order = defineTable("dt_io", {
      id: s.string(),
      currency: s.string(),
      in: s.recordId("dt_person"),
      out: s.recordId("dt_product"),
    });
    const { pulled } = await roundTrip([Person, Product, Order], "dt_io");
    expect(pulled).toContain("defineTable(");
    expect(pulled).not.toContain("defineRelation(");
    // The endpoint tables are in the pull, so the record links render as typed `.record()` refs
    // (same as any record field) — the point is `in`/`out` SURVIVE on a non-relation table.
    expect(pulled).toContain("in: DtPerson.record()");
    expect(pulled).toContain("out: DtProduct.record()");
  });
});

// --- DROP / CHANGEFEED / COMMENT ---------------------------------------------------------------

live("DROP / CHANGEFEED / COMMENT", () => {
  test("DROP round-trips; pull renders .drop()", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_drop").schemaless().drop()],
      "dt_drop",
    );
    expect(pulled).toContain(".drop()");
  });

  test("CHANGEFEED <dur> round-trips; pull renders .changefeed()", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_cf").changefeed("1h")],
      "dt_cf",
    );
    expect(pulled).toContain('.changefeed("1h")');
  });

  test("CHANGEFEED <dur> INCLUDE ORIGINAL round-trips; pull renders the option", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_cfo").changefeed("1h", { includeOriginal: true })],
      "dt_cfo",
    );
    expect(pulled).toContain('.changefeed("1h", { includeOriginal: true })');
  });

  test("COMMENT round-trips; pull renders .comment()", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_cmt").comment("a table")],
      "dt_cmt",
    );
    expect(pulled).toContain('.comment("a table")');
  });
});

// --- PERMISSIONS -------------------------------------------------------------------------------

live("PERMISSIONS", () => {
  test("PERMISSIONS FULL round-trips; pull renders .permissions(true)", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_pf").permissions(true)],
      "dt_pf",
    );
    expect(pulled).toContain(".permissions(true)");
  });

  test("PERMISSIONS NONE (the table default) round-trips; pull omits it", async () => {
    const { pulled } = await roundTrip(
      [Base("dt_pn").permissions(false)],
      "dt_pn",
    );
    // NONE is the table default — canonical (and pull) omit it; the push round-trip still holds.
    expect(pulled).not.toContain(".permissions(");
  });

  test("PERMISSIONS FOR <op> WHERE … round-trips; pull renders the per-op rules", async () => {
    const t = Base("dt_pw").permissions({
      select: true,
      create: surql`$auth.id != NONE`,
      update: surql`$auth.id != NONE`,
      delete: false,
    });
    const { pulled } = await roundTrip([t], "dt_pw");
    expect(pulled).toContain(".permissions(");
    expect(pulled).toContain("$auth.id != NONE");
  });
});

// --- combinations ------------------------------------------------------------------------------

live("combinations", () => {
  test("SCHEMALESS + CHANGEFEED(INCLUDE ORIGINAL) + COMMENT + PERMISSIONS together", async () => {
    const t = Base("dt_combo")
      .schemaless()
      .changefeed("2h", { includeOriginal: true })
      .comment("everything")
      .permissions({ select: true, create: surql`$auth.id != NONE` });
    const { pulled } = await roundTrip([t], "dt_combo");
    expect(pulled).toContain(".schemaless()");
    expect(pulled).toContain('.changefeed("2h", { includeOriginal: true })');
    expect(pulled).toContain('.comment("everything")');
    expect(pulled).toContain(".permissions(");
  });

  test("RELATION FROM/TO ENFORCED + CHANGEFEED + COMMENT together", async () => {
    const A = Base("dt_ca");
    const B = Base("dt_cb");
    const Edge = defineRelation("dt_cedge", { weight: s.int() })
      .from(A)
      .to(B)
      .enforced()
      .changefeed("30m")
      .comment("edge");
    const { pulled } = await roundTrip([A, B, Edge], "dt_cedge");
    expect(pulled).toContain(".from(");
    expect(pulled).toContain(".to(");
    expect(pulled).toContain(".enforced()");
    expect(pulled).toContain('.changefeed("30m")');
    expect(pulled).toContain('.comment("edge")');
  });
});

// --- AS SELECT (pre-computed view tables) ------------------------------------------------------

live("AS SELECT (pre-computed view)", () => {
  const Person = () =>
    defineTable("dt_person", {
      id: s.string(),
      name: s.string(),
      age: s.int(),
    });

  test("a plain projection view round-trips; pull renders defineView().as()", async () => {
    const view = defineView("dt_adults").as(
      surql`SELECT name, age FROM dt_person WHERE age >= 18`,
    );
    const { pulled } = await roundTrip([Person(), view], "dt_adults");
    expect(pulled).toContain("defineView(");
    expect(pulled).toContain(".as(surql`SELECT name, age");
    expect(pulled).toContain("SELECT name, age FROM dt_person WHERE age >= 18");
    // a view's TS uses no `s.*` — only the factory + surql are imported.
    expect(pulled).toContain(
      'import { defineView } from "@schemic/surrealdb";',
    );
    expect(pulled).not.toContain(".schemaless()");
  });

  test("an aggregate view (GROUP BY) + .comment() round-trips", async () => {
    const view = defineView("dt_by_name")
      .as(surql`SELECT name, count() AS total FROM dt_person GROUP BY name`)
      .comment("name counts");
    const { pulled } = await roundTrip([Person(), view], "dt_by_name");
    expect(pulled).toContain("defineView(");
    expect(pulled).toContain("GROUP BY name");
    expect(pulled).toContain('.comment("name counts")');
  });
});
