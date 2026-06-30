import { describe, expect, test } from "bun:test";
import { pgCommands } from "../src/commands";
import type { PgConn } from "../src/connection";
import { postgresDriver } from "../src/driver";

// The driver-contributed CLI commands (sc <kind> <verb>). Core parses argv into ParsedCommandArgs and
// hands run() a CommandContext; here we drive run() directly with a capturing `io` + a real PGlite conn,
// asserting the dialect SQL behaves (and that --dry-run / arg validation work).

type Captured = { ok: string[]; info: string[]; fail: string[] };

async function harness(): Promise<{
  conn: PgConn;
  out: Captured;
  run: (
    kind: string,
    verb: string,
    positionals: string[],
    flags?: Record<string, string | boolean>,
  ) => Promise<void>;
}> {
  const conn = (await postgresDriver.connect({
    params: { url: "" },
  } as never)) as PgConn;
  const out: Captured = { ok: [], info: [], fail: [] };
  const io = {
    ok: (m: string) => out.ok.push(m),
    info: (m: string) => out.info.push(m),
    fail: (m: string) => out.fail.push(m),
    prompt: async () => "",
  };
  const ctx = {
    conn,
    config: {} as never,
    io,
    secrets: { get: async () => undefined } as never,
  };
  const run = (
    kind: string,
    verb: string,
    positionals: string[],
    flags: Record<string, string | boolean> = {},
  ) => {
    const cmd = pgCommands.find((c) => c.kind === kind && c.verb === verb);
    if (!cmd) throw new Error(`no command ${kind} ${verb}`);
    return cmd.run(ctx as never, { positionals, flags });
  };
  return { conn, out, run };
}

describe("postgres driver CLI commands", () => {
  test("every command declares kind/verb/summary/run; no duplicate <kind> <verb>", () => {
    const seen = new Set<string>();
    for (const c of pgCommands) {
      expect(typeof c.kind).toBe("string");
      expect(typeof c.verb).toBe("string");
      expect(typeof c.summary).toBe("string");
      expect(typeof c.run).toBe("function");
      const key = `${c.kind} ${c.verb}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(postgresDriver.commands).toBe(pgCommands);
  });

  test("table count / count --where", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE TABLE acct (id text primary key, n int);`);
      await conn.exec(`INSERT INTO acct VALUES ('a',1),('b',2),('c',2);`);
      await run("table", "count", ["acct"]);
      expect(out.ok).toEqual(["3"]);
      out.ok.length = 0;
      await run("table", "count", ["acct"], { where: "n = 2" });
      expect(out.ok).toEqual(["2"]);
    } finally {
      await conn.close();
    }
  });

  test("table find <col=value> (param type inferred) + bad kv throws", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE TABLE acct (id text primary key, n int);`);
      await conn.exec(`INSERT INTO acct VALUES ('a',1),('b',2);`);
      await run("table", "find", ["acct", "n=2"]); // "2" is coerced to int by pg
      expect(out.ok).toEqual(["1 row(s)"]);
      expect(JSON.parse(out.info[0])).toEqual({ id: "b", n: 2 });
      await expect(run("table", "find", ["acct", "nope"])).rejects.toThrow(
        /expected <col=value>/,
      );
    } finally {
      await conn.close();
    }
  });

  test("matview refresh", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE TABLE t (id text primary key, n int);`);
      await conn.exec(`INSERT INTO t VALUES ('a',1);`);
      await conn.exec(
        `CREATE MATERIALIZED VIEW mv AS SELECT count(*) c FROM t;`,
      );
      await run("matview", "refresh", ["mv"]);
      expect(out.ok).toEqual(["refreshed materialized view mv"]);
    } finally {
      await conn.close();
    }
  });

  test("sequence set + current, and set --dry-run does not execute", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE SEQUENCE seq1;`);
      await run("sequence", "set", ["seq1", "42"]);
      expect(out.ok[0]).toContain("set sequence seq1 to 42");
      out.ok.length = 0;
      await run("sequence", "current", ["seq1"]);
      expect(out.ok).toEqual(["42"]);
      // dry-run: prints SQL, leaves the value at 42
      out.ok.length = 0;
      out.info.length = 0;
      await run("sequence", "set", ["seq1", "999"], { "dry-run": true });
      expect(out.info[0]).toContain("setval");
      expect(out.ok).toEqual([]);
      out.ok.length = 0;
      await run("sequence", "current", ["seq1"]);
      expect(out.ok).toEqual(["42"]); // unchanged by the dry-run
    } finally {
      await conn.close();
    }
  });

  test("enum add (--after) inserts the label; --dry-run prints a literal SQL; both flags throw", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE TYPE mood AS ENUM ('happy','sad');`);
      await run("enum", "add", ["mood", "meh"], { "dry-run": true });
      expect(out.info[0]).toBe(`ALTER TYPE "mood" ADD VALUE 'meh'`);
      out.info.length = 0;
      await run("enum", "add", ["mood", "meh"], { after: "happy" });
      expect(out.ok[0]).toContain("added value 'meh'");
      const { rows } = await conn.query<{ r: string }>(
        `SELECT enum_range(NULL::mood)::text AS r;`,
      );
      expect(rows[0].r).toBe("{happy,meh,sad}");
      await expect(
        run("enum", "add", ["mood", "x"], { before: "sad", after: "happy" }),
      ).rejects.toThrow(/at most one/);
    } finally {
      await conn.close();
    }
  });

  test("index reindex + table vacuum (--analyze)", async () => {
    const { conn, out, run } = await harness();
    try {
      await conn.exec(`CREATE TABLE t (id text primary key, n int);`);
      await conn.exec(`CREATE INDEX t_n_idx ON t(n);`);
      await run("index", "reindex", ["t_n_idx"]);
      expect(out.ok).toEqual(["reindexed t_n_idx"]);
      out.ok.length = 0;
      await run("table", "vacuum", ["t"], { analyze: true });
      expect(out.ok[0]).toContain("vacuumed t");
    } finally {
      await conn.close();
    }
  });

  test("a missing required positional throws a clear error", async () => {
    const { conn, run } = await harness();
    try {
      await expect(run("matview", "refresh", [])).rejects.toThrow(
        /missing required argument <name>/,
      );
    } finally {
      await conn.close();
    }
  });
});
