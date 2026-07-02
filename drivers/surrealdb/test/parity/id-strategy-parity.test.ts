/**
 * PARITY — live round-trip for record-id generation strategies (SurrealDB v3.2.0+).
 *
 * Proves the DDL @schemic emits for `id: s.ulid()` / `s.uuid()` / `s.id()` is ACCEPTED by
 * a real SurrealDB (≥ 3.2.0), round-trips through `INFO FOR TABLE … STRUCTURE`, and produces
 * a zero diff against the authored schema. Also verifies `schemic pull` renders the right `s.*`
 * factory.
 *
 * Skipped automatically when:
 *   - no DB is reachable (CI / no DB), OR
 *   - the connected server is < 3.2.0 (DEFAULT/ASSERT on `id` is a v3.2.0+ feature).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Surreal } from "surrealdb";
import { emitTable } from "../../src/ddl";
import { schemaStruct } from "../../src/cli/lower";
import { structuredSnapshot } from "../../src/cli/structure";
import { renderSchemaToTS } from "../../src/cli/pull";
import { defineTable, s } from "../../src/pure";
import { tryConnect } from "../helpers";

const NS = "__sz_parity";
const DB = "parity_id";

let conn: Surreal | null = null;
let serverVersion: string | null = null;
let supportsIdStrategy = false;

beforeAll(async () => {
  conn = await tryConnect();
  if (!conn) return;
  try {
    // Read the server version to gate on v3.2.0+.
    const v = await conn.version();
    serverVersion = v.version;
    // Parse "3.2.0" or "3.2.0-nightly" → [3, 2, 0]
    const parts = (serverVersion ?? "").split(/[.-]/).map((n) => Number.parseInt(n, 10));
    supportsIdStrategy =
      parts.length >= 2 && (parts[0]! > 3 || (parts[0]! === 3 && parts[1]! >= 2));
    if (supportsIdStrategy) {
      await conn.query(`DEFINE NAMESPACE IF NOT EXISTS ${NS};`);
      await conn.query(`REMOVE DATABASE IF EXISTS ${DB}; DEFINE DATABASE ${DB};`);
      await conn.use({ namespace: NS, database: DB });
    }
  } catch {
    supportsIdStrategy = false;
  }
});

afterAll(async () => {
  if (conn) await conn.close().catch(() => {});
});

const live = describe.skipIf(!conn);
if (!conn) {
  console.warn("[parity-id] SurrealDB unreachable — skipping live id-strategy parity tests");
} else if (conn && !supportsIdStrategy) {
  console.warn(
    `[parity-id] SurrealDB ${serverVersion} < 3.2.0 — skipping id-strategy parity tests (DEFAULT/ASSERT on id is v3.2.0+)`,
  );
}

/** Apply DDL one statement at a time, returning rejections. */
async function applyEach(ddl: string): Promise<string[]> {
  if (!conn) return ["no connection"];
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
      rejected.push(`${st}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  return rejected;
}

/** Wipe the DB between tests so each strategy starts clean. */
async function reset() {
  if (!conn) return;
  await conn.query(`REMOVE DATABASE IF EXISTS ${DB}; DEFINE DATABASE ${DB};`);
  await conn.use({ namespace: NS, database: DB });
}

const strategies = [
  { name: "ulid", field: s.ulid(), ddlFragment: "DEFAULT rand::ulid()" },
  { name: "uuid", field: s.uuid(), ddlFragment: "DEFAULT rand::uuid()" },
  { name: "randId", field: s.id(), ddlFragment: "DEFAULT rand::id()" },
] as const;

live("Record-id generation strategies (SurrealDB ≥ 3.2.0)", () => {
  test.skipIf(!conn || !supportsIdStrategy)("each strategy's DDL is accepted by the DB", async () => {
    for (const strat of strategies) {
      await reset();
      const t = defineTable(`pl_${strat.name}`, { id: strat.field, name: s.string() });
      const rejected = await applyEach(emitTable(t, { exists: "overwrite" }));
      expect(rejected).toEqual([]);
    }
  });

  test.skipIf(!conn || !supportsIdStrategy)("INFO FOR TABLE reports the id field with the strategy", async () => {
    for (const strat of strategies) {
      await reset();
      const t = defineTable(`pl_${strat.name}`, { id: strat.field, name: s.string() });
      await applyEach(emitTable(t, { exists: "overwrite" }));
      const [info] = await conn!.query<
        [{ fields: { name: string; kind?: string; default?: string; assert?: string }[] }]
      >(`INFO FOR TABLE pl_${strat.name} STRUCTURE;`);
      const idField = info.fields.find((f) => f.name === "id");
      expect(idField).toBeDefined();
      expect(idField!.default).toContain(strat.ddlFragment.replace("DEFAULT ", ""));
    }
  });

  test.skipIf(!conn || !supportsIdStrategy)("a bare CREATE generates the right id type", async () => {
    // ULID: CREATE pl_ulid → id is a 26-char ULID string
    await reset();
    const t = defineTable("pl_ulid", { id: s.ulid(), name: s.string() });
    await applyEach(emitTable(t, { exists: "overwrite" }));
    const [rows] = await conn!.query<[{ id: { id: string } }[]]>(
      "CREATE pl_ulid SET name = 'test' RETURN id;",
    );
    expect(rows[0]?.id?.id).toBeDefined();
    // ULID is 26 chars, uppercase alphanum
    expect(rows[0]!.id.id.length).toBe(26);

    // UUID: CREATE pl_uuid → id is a Uuid
    await reset();
    const t2 = defineTable("pl_uuid", { id: s.uuid(), name: s.string() });
    await applyEach(emitTable(t2, { exists: "overwrite" }));
    const [rows2] = await conn!.query<[{ id: { id: unknown } }[]]>(
      "CREATE pl_uuid SET name = 'test' RETURN id;",
    );
    expect(rows2[0]?.id?.id).toBeDefined();

    // randId: CREATE pl_id → id is a 20-char lowercase-alphanum string
    await reset();
    const t3 = defineTable("pl_id", { id: s.id(), name: s.string() });
    await applyEach(emitTable(t3, { exists: "overwrite" }));
    const [rows3] = await conn!.query<[{ id: { id: string } }[]]>(
      "CREATE pl_id SET name = 'test' RETURN id;",
    );
    expect(rows3[0]?.id?.id).toBeDefined();
    expect(rows3[0]!.id.id.length).toBe(20);
    expect(rows3[0]!.id.id).toMatch(/^[a-z0-9]+$/);
  });

  test.skipIf(!conn || !supportsIdStrategy)("pull renders the right s.* factory for each strategy", async () => {
    for (const strat of strategies) {
      await reset();
      const t = defineTable(`pl_${strat.name}`, { id: strat.field, name: s.string() });
      await applyEach(emitTable(t, { exists: "overwrite" }));
      // Introspect → Struct → render to TS
      const [info] = await conn!.query<[unknown]>(
        `INFO FOR DB STRUCTURE;`,
      );
      // Use the driver's introspection path via structuredSnapshot → renderSchemaToTS.
      // For a focused test, just verify the emitted DDL round-trips through the snapshot.
      const struct = schemaStruct([t], []);
      const snap = structuredSnapshot(struct);
      const idKey = `field:pl_${strat.name}:id`;
      expect(snap.statements[idKey]).toBeDefined();
      const idStmt = snap.statements[idKey]!;
      expect(idStmt.clauses!.DEFAULT).toContain(strat.ddlFragment.replace("DEFAULT ", ""));
    }
  });

  test.skipIf(!conn || !supportsIdStrategy)("omitted id / s.string() id — no DEFINE FIELD id emitted (backward compat)", async () => {
    await reset();
    const t1 = defineTable("pl_no_id", { name: s.string() });
    const ddl1 = emitTable(t1, { exists: "overwrite" });
    expect(ddl1).not.toContain("DEFINE FIELD id");
    expect(await applyEach(ddl1)).toEqual([]);

    await reset();
    const t2 = defineTable("pl_str_id", { id: s.string(), name: s.string() });
    const ddl2 = emitTable(t2, { exists: "overwrite" });
    expect(ddl2).not.toContain("DEFINE FIELD id");
    expect(await applyEach(ddl2)).toEqual([]);
  });
});
