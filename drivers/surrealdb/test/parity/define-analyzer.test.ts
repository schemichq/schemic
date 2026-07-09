/**
 * PARITY — `DEFINE ANALYZER` clauses round-trip (push + pull) against a real SurrealDB.
 *
 * Covers the clauses that aren't pinned by pure emit alone — FUNCTION (a name, a defineFunction
 * reference, and the inline `input => surql`…`` form that auto-creates a function), and COMMENT — and
 * asserts each PUSHes with an EMPTY plan (author == DB) and PULLs back to faithful authoring. Skipped
 * when no SurrealDB is reachable (CI).
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
import { Surreal, surql } from "surrealdb";
import { renderPerFile } from "../../src/cli/pull";
import { introspectStructured } from "../../src/cli/structure";
import { emitDefStatement } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import {
  type AnalyzerDef,
  defineAnalyzer,
  defineFunction,
  s,
} from "../../src/pure";

// The workspace gate runs every package's suite IN PARALLEL — PGlite's CPU burst can slow a live
// connect/DDL past bun's 5s DEFAULT hook timeout, failing the `beforeEach`/`afterAll` below as an
// "(unnamed)" test. `beforeAll`s that say `120_000` explicitly are already covered; the default
// applies to every hook that doesn't. Isolated runs are unaffected.
setDefaultTimeout(120_000);

const NS = "__sz_defanalyzer";
const DB = "defanalyzer";

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
  console.warn("[define-analyzer] SurrealDB unreachable — skipping round-trip");

/** Apply an analyzer (and its inline auto-function, if any), then assert PUSH is an EMPTY plan. */
async function roundTrip(a: AnalyzerDef): Promise<Map<string, string>> {
  if (a.config.functionDef)
    await db!.query(emitDefStatement(a.config.functionDef).ddl);
  await db!.query(emitDefStatement(a, { exists: "overwrite" }).ddl);
  const plan = planKinds(
    surrealKinds,
    await introspectAll(db!),
    lowerAll([], [a]),
  );
  expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });
  return renderPerFile(await introspectStructured(db!), (_k, n) => `${n}.ts`);
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

live("DEFINE ANALYZER", () => {
  test("FUNCTION (string name) + TOKENIZERS round-trips", async () => {
    const files = await roundTrip(
      defineAnalyzer("a_fnname").function("my_tok").tokenizers("blank"),
    );
    expect(files.get("a_fnname.ts") ?? "").toContain('.function("my_tok")');
  });

  test("FUNCTION via a defineFunction reference round-trips", async () => {
    const tok = defineFunction("a_reffn_fn", { t: s.string() }).body(
      surql`RETURN [$t]`,
    );
    await db!.query(emitDefStatement(tok).ddl);
    const a = defineAnalyzer("a_reffn").function(tok).tokenizers("blank");
    const plan = planKinds(
      surrealKinds,
      await introspectAll(db!),
      lowerAll([], [tok, a]),
    );
    // apply the analyzer too
    await db!.query(emitDefStatement(a, { exists: "overwrite" }).ddl);
    const plan2 = planKinds(
      surrealKinds,
      await introspectAll(db!),
      lowerAll([], [tok, a]),
    );
    expect({ up: plan2.up, down: plan2.down }).toEqual({ up: [], down: [] });
    void plan;
  });

  test("inline .function(input => surql`…`) auto-creates the function + round-trips", async () => {
    const a = defineAnalyzer("a_inline")
      .function((input) => surql`RETURN string::lowercase(${input})`)
      .tokenizers("class");
    const files = await roundTrip(a);
    // pull desugars into a separate function + a name reference
    expect(files.get("a_inline.ts") ?? "").toContain(
      '.function("a_inline_fn")',
    );
    expect(files.get("a_inline_fn.ts") ?? "").toContain(
      'defineFunction("a_inline_fn"',
    );
    expect(files.get("a_inline_fn.ts") ?? "").toContain("string::lowercase");
  });

  test("COMMENT round-trips", async () => {
    const files = await roundTrip(
      defineAnalyzer("a_cmt").tokenizers("blank").comment("search"),
    );
    expect(files.get("a_cmt.ts") ?? "").toContain('.comment("search")');
  });
});
