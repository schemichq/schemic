/**
 * PARITY — `DEFINE INDEX` syntax round-trip (push + pull) against a real SurrealDB.
 *
 * Covers the index forms — plain, UNIQUE, COUNT, COMMENT, and the VECTOR indexes (HNSW / DISKANN,
 * minimal + tuned) — each asserted to round-trip BOTH ways:
 *   - PUSH: author -> emit -> apply -> introspectAll -> planKinds(live, desired) EMPTY. This proves the
 *     default-stripping canonicalization: `HNSW DIMENSION 4` survives SurrealDB materializing it to
 *     `… DIST EUCLIDEAN TYPE F32 EFC 150 M 12 M0 24 LM …` with no phantom diff.
 *   - PULL: introspect -> renderPerFile regenerates the `.index(…, { … })` call.
 *
 * FULLTEXT search indexes are exercised in the analyzer suite (they need a `defineAnalyzer`).
 * Skipped when no SurrealDB is reachable; isolated in a scratch db reset before each test.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { planKinds } from "@schemic/core";
import { Surreal } from "surrealdb";
import { renderPerFile } from "../../src/cli/pull";
import { introspectStructured } from "../../src/cli/structure";
import { emitDefStatement, emitTable } from "../../src/ddl";
import { introspectAll } from "../../src/kinds/explode";
import { lowerAll, surrealKinds } from "../../src/kinds/registry";
import { defineAnalyzer, defineTable, s, type TableDef } from "../../src/pure";

const NS = "__sz_defindex";
const DB = "defindex";

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
  console.warn("[define-index] SurrealDB unreachable — skipping round-trip");

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

/** apply -> push round-trip (planKinds empty) -> the pulled `.index(...)` lines for `main` (one string,
 *  so `toContain` is a substring match — tolerant of the trailing `;` on the last chained line). */
async function roundTrip(t: AnyTableDef, main: string): Promise<string> {
  await applyEach(db!, emitTable(t, { exists: "overwrite" }));
  const plan = planKinds(surrealKinds, await introspectAll(db!), lowerAll([t]));
  expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });
  const struct = await introspectStructured(db!);
  const ts =
    renderPerFile(struct, (_k, n) => `${n}.ts`).get(`${main}.ts`) ?? "";
  return ts
    .split("\n")
    .filter((l) => l.includes(".index("))
    .join("\n");
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

live("plain / UNIQUE / COUNT / COMMENT", () => {
  test("plain composite index round-trips", async () => {
    const t = defineTable("ix1", {
      id: s.string(),
      a: s.string(),
      b: s.string(),
    }).index("ab", ["a", "b"]);
    expect(await roundTrip(t, "ix1")).toContain('  .index("ab", ["a", "b"])');
  });

  test("UNIQUE round-trips", async () => {
    const t = defineTable("ix2", { id: s.string(), email: s.string() }).index(
      "uq",
      ["email"],
      { unique: true },
    );
    expect(await roundTrip(t, "ix2")).toContain(
      '  .index("uq", ["email"], { unique: true })',
    );
  });

  test("a custom field-index name (field.$unique(name)) round-trips", async () => {
    const t = defineTable("ix2b", {
      id: s.string(),
      email: s.string().$unique("custom_email_uq"),
    });
    // The custom name survives apply -> introspect; pull renders it as a named index.
    expect(await roundTrip(t, "ix2b")).toContain(
      '  .index("custom_email_uq", ["email"], { unique: true })',
    );
  });

  test("COUNT round-trips", async () => {
    const t = defineTable("ix3", { id: s.string() }).index("rows", [], {
      count: true,
    });
    expect(await roundTrip(t, "ix3")).toContain(
      '  .index("rows", [], { count: true })',
    );
  });

  test("COMMENT round-trips", async () => {
    const t = defineTable("ix4", { id: s.string(), email: s.string() }).index(
      "uq",
      ["email"],
      { unique: true, comment: "email is unique" },
    );
    expect(await roundTrip(t, "ix4")).toContain(
      '  .index("uq", ["email"], { unique: true, comment: "email is unique" })',
    );
  });
});

live("HNSW vector index", () => {
  test("minimal (only DIMENSION) round-trips — defaults stripped", async () => {
    const t = defineTable("v1", {
      id: s.string(),
      emb: s.array(s.float()),
    }).index("vec", ["emb"], { hnsw: { dimension: 4 } });
    expect(await roundTrip(t, "v1")).toContain(
      '  .index("vec", ["emb"], { hnsw: { dimension: 4 } })',
    );
  });

  test("tuned (DIST/TYPE/EFC/M) round-trips", async () => {
    const t = defineTable("v2", {
      id: s.string(),
      emb: s.array(s.float()),
    }).index("vec", ["emb"], {
      hnsw: { dimension: 8, dist: "cosine", type: "f64", efc: 200, m: 16 },
    });
    expect(await roundTrip(t, "v2")).toContain(
      '  .index("vec", ["emb"], { hnsw: { dimension: 8, dist: "cosine", type: "f64", efc: 200, m: 16 } })',
    );
  });
});

live("DISKANN vector index", () => {
  test("minimal round-trips — defaults stripped", async () => {
    const t = defineTable("d1", {
      id: s.string(),
      emb: s.array(s.float()),
    }).index("vec", ["emb"], { diskann: { dimension: 4 } });
    expect(await roundTrip(t, "d1")).toContain(
      '  .index("vec", ["emb"], { diskann: { dimension: 4 } })',
    );
  });

  test("tuned (DIST/DEGREE/L_BUILD/ALPHA) round-trips", async () => {
    const t = defineTable("d2", {
      id: s.string(),
      emb: s.array(s.float()),
    }).index("vec", ["emb"], {
      diskann: {
        dimension: 8,
        dist: "cosine",
        degree: 32,
        l_build: 50,
        alpha: 1.5,
      },
    });
    expect(await roundTrip(t, "d2")).toContain(
      '  .index("vec", ["emb"], { diskann: { dimension: 8, dist: "cosine", degree: 32, l_build: 50, alpha: 1.5 } })',
    );
  });
});

live("FULLTEXT search index + DEFINE ANALYZER", () => {
  test("an analyzer + a default FULLTEXT index round-trip", async () => {
    const english = defineAnalyzer("english", {
      tokenizers: ["blank", "class"],
      filters: ["lowercase", "snowball(english)"],
    });
    const Doc = defineTable("ftdoc", {
      id: s.string(),
      content: s.string(),
    }).index("ft", ["content"], {
      fulltext: { analyzer: "english", highlights: true },
    });
    await applyEach(db!, emitDefStatement(english).ddl);
    await applyEach(db!, emitTable(Doc, { exists: "overwrite" }));

    // PUSH: the analyzer + index round-trip (BM25 default + materialized analyzer-list match).
    const plan = planKinds(
      surrealKinds,
      await introspectAll(db!),
      lowerAll([Doc], [english]),
    );
    expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });

    // PULL: both regenerate.
    const files = renderPerFile(
      await introspectStructured(db!),
      (_k, n) => `${n}.ts`,
    );
    expect(files.get("english.ts") ?? "").toContain(
      'defineAnalyzer("english", { tokenizers: ["blank", "class"], filters: ["lowercase", "snowball(english)"] })',
    );
    const idx = (files.get("ftdoc.ts") ?? "")
      .split("\n")
      .filter((l) => l.includes(".index("))
      .join("\n");
    expect(idx).toContain(
      'fulltext: { analyzer: "english", highlights: true }',
    );
  });

  test("a tuned BM25 fulltext index round-trips (non-default kept)", async () => {
    const a = defineAnalyzer("simple", { tokenizers: ["blank"] });
    const Doc = defineTable("ftdoc2", {
      id: s.string(),
      body: s.string(),
    }).index("ft", ["body"], {
      fulltext: { analyzer: "simple", bm25: [1.5, 0.5] },
    });
    await applyEach(db!, emitDefStatement(a).ddl);
    await applyEach(db!, emitTable(Doc, { exists: "overwrite" }));
    const plan = planKinds(
      surrealKinds,
      await introspectAll(db!),
      lowerAll([Doc], [a]),
    );
    expect({ up: plan.up, down: plan.down }).toEqual({ up: [], down: [] });
    const idx = (
      renderPerFile(await introspectStructured(db!), (_k, n) => `${n}.ts`).get(
        "ftdoc2.ts",
      ) ?? ""
    )
      .split("\n")
      .filter((l) => l.includes(".index("))
      .join("\n");
    expect(idx).toContain("bm25: [1.5, 0.5]");
  });
});
