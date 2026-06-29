// Driver-contributed CLI commands for Postgres — `sc <kind> <verb> [args]`. Core discovers
// `postgresDriver.commands`, parses argv against each command's `args`, resolves the connection, and
// dispatches to `run(ctx, parsed)`; THIS file owns the pg dialect logic. Authored against the landed
// DriverCommand contract — inert until core's CLI dispatch (piece B) lands.
//
// Conventions: validate positional arity here (core only collects them); throw a clear Error on bad
// input (core reports it + sets a non-zero exit); use `ctx.io` for all output (never stdio directly).
// Mutating commands (`enum add`, `sequence set`) honor a `--dry-run` boolean that prints the SQL
// instead of running it. Identifiers are quoted via `identifier()`; user-supplied `--where` is spliced
// raw (a CLI author is trusted, like psql).

import type {
  CommandContext,
  DriverCommand,
  ParsedCommandArgs,
} from "@schemic/core/driver";
import { identifier, type PgConn, pgSql, raw } from "./connection";

type Ctx = CommandContext<PgConn>;

/** Quote a SQL string literal (for clauses that can't take a bound param, e.g. ALTER TYPE ADD VALUE). */
const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`;

/** A required positional, else a clear error. */
function pos(a: ParsedCommandArgs, i: number, name: string): string {
  const v = a.positionals[i];
  if (v === undefined || v === "")
    throw new Error(`missing required argument <${name}>`);
  return v;
}

/** `--dry-run`: print the SQL (params inlined for readability) and return true to skip execution. */
function dryRun(
  ctx: Ctx,
  a: ParsedCommandArgs,
  q: { query: string; params: unknown[] },
): boolean {
  if (a.flags["dry-run"] !== true) return false;
  const inlined = q.params.length
    ? `${q.query}   -- params: ${JSON.stringify(q.params.map(String))}`
    : q.query;
  ctx.io.info(inlined);
  return true;
}

export const pgCommands: readonly DriverCommand<PgConn>[] = [
  // --- materialized views ---
  {
    kind: "matview",
    verb: "refresh",
    summary: "REFRESH MATERIALIZED VIEW [CONCURRENTLY] <name>",
    args: {
      positionals: [
        { name: "name", required: true, help: "materialized view name" },
      ],
      flags: [
        {
          name: "concurrently",
          help: "REFRESH … CONCURRENTLY (requires a unique index on the matview)",
        },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const conc =
        a.flags.concurrently === true ? raw("CONCURRENTLY ") : raw("");
      const q = pgSql`REFRESH MATERIALIZED VIEW ${conc}${identifier(name)}`;
      await ctx.conn.query(q.query, q.params);
      ctx.io.ok(`refreshed materialized view ${name}`);
    },
  },

  // --- sequences ---
  {
    kind: "sequence",
    verb: "set",
    summary: "set a sequence's current value (setval)",
    args: {
      positionals: [
        { name: "name", required: true, help: "sequence name" },
        { name: "value", required: true, help: "new value (integer)" },
      ],
      flags: [
        {
          name: "is-called",
          value: true,
          help: "true (default) -> next nextval is value+1; false -> value",
        },
        { name: "dry-run", help: "print the SQL, don't run it" },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const value = pos(a, 1, "value");
      const isCalled = a.flags["is-called"] !== "false";
      const q = pgSql`SELECT setval(${name}, ${BigInt(value)}, ${isCalled})`;
      if (dryRun(ctx, a, q)) return;
      await ctx.conn.query(q.query, q.params);
      ctx.io.ok(`set sequence ${name} to ${value} (is_called=${isCalled})`);
    },
  },
  {
    kind: "sequence",
    verb: "current",
    summary: "show a sequence's last_value",
    args: {
      positionals: [{ name: "name", required: true, help: "sequence name" }],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const q = pgSql`SELECT last_value FROM ${identifier(name)}`;
      const { rows } = await ctx.conn.query<{ last_value: unknown }>(
        q.query,
        q.params,
      );
      ctx.io.ok(String(rows[0]?.last_value));
    },
  },

  // --- enums ---
  {
    kind: "enum",
    verb: "add",
    summary: "ALTER TYPE <type> ADD VALUE <value> [--before|--after <label>]",
    args: {
      positionals: [
        { name: "type", required: true, help: "enum type name" },
        { name: "value", required: true, help: "new label to add" },
      ],
      flags: [
        {
          name: "before",
          value: true,
          help: "insert before this existing label",
        },
        {
          name: "after",
          value: true,
          help: "insert after this existing label",
        },
        { name: "dry-run", help: "print the SQL, don't run it" },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const type = pos(a, 0, "type");
      const value = pos(a, 1, "value");
      const before = a.flags.before;
      const after = a.flags.after;
      if (typeof before === "string" && typeof after === "string")
        throw new Error("pass at most one of --before / --after");
      // ALTER TYPE … ADD VALUE takes string LITERALS, not bound params ($1 is a syntax error there), so
      // the value + BEFORE/AFTER label are quoted via `lit` and spliced raw. (pg forbids ADD VALUE
      // inside a txn before pg12; core's dispatch runs commands outside an explicit transaction.)
      const place =
        typeof before === "string"
          ? raw(` BEFORE ${lit(before)}`)
          : typeof after === "string"
            ? raw(` AFTER ${lit(after)}`)
            : raw("");
      const q = pgSql`ALTER TYPE ${identifier(type)} ADD VALUE ${raw(lit(value))}${place}`;
      if (dryRun(ctx, a, q)) return;
      await ctx.conn.query(q.query, q.params);
      ctx.io.ok(`added value '${value}' to enum ${type}`);
    },
  },

  // --- tables: peek + maintenance ---
  {
    kind: "table",
    verb: "count",
    summary: "SELECT count(*) FROM <table> [--where <expr>]",
    args: {
      positionals: [{ name: "table", required: true, help: "table name" }],
      flags: [{ name: "where", value: true, help: "raw WHERE expression" }],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const table = pos(a, 0, "table");
      const where =
        typeof a.flags.where === "string"
          ? raw(` WHERE ${a.flags.where}`)
          : raw("");
      const q = pgSql`SELECT count(*)::int AS n FROM ${identifier(table)}${where}`;
      const { rows } = await ctx.conn.query<{ n: number }>(q.query, q.params);
      ctx.io.ok(String(rows[0]?.n ?? 0));
    },
  },
  {
    kind: "table",
    verb: "find",
    summary: "SELECT * FROM <table> WHERE <col=value> [--limit N]",
    args: {
      positionals: [
        { name: "table", required: true, help: "table name" },
        {
          name: "col=value",
          required: true,
          help: "equality filter, e.g. id=123",
        },
      ],
      flags: [{ name: "limit", value: true, help: "max rows (default 100)" }],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const table = pos(a, 0, "table");
      const kv = pos(a, 1, "col=value");
      const eq = kv.indexOf("=");
      if (eq < 1) throw new Error(`expected <col=value>, got "${kv}"`);
      const col = kv.slice(0, eq);
      const val = kv.slice(eq + 1);
      const limit = Math.max(
        0,
        Math.floor(Number(a.flags.limit ?? 100)) || 100,
      );
      // bind `val` as a param: Postgres infers its type from the column, so "123" matches an int column.
      const q = pgSql`SELECT * FROM ${identifier(table)} WHERE ${identifier(col)} = ${val}${raw(` LIMIT ${limit}`)}`;
      const { rows } = await ctx.conn.query(q.query, q.params);
      ctx.io.ok(`${rows.length} row(s)`);
      for (const r of rows) ctx.io.info(JSON.stringify(r));
    },
  },
  {
    kind: "table",
    verb: "vacuum",
    summary: "VACUUM [FULL] [ANALYZE] <table>",
    args: {
      positionals: [{ name: "table", required: true, help: "table name" }],
      flags: [
        {
          name: "full",
          help: "VACUUM FULL (rewrites the table; takes a lock)",
        },
        { name: "analyze", help: "also ANALYZE" },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const table = pos(a, 0, "table");
      const opts = [
        a.flags.full === true ? "FULL" : "",
        a.flags.analyze === true ? "ANALYZE" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const q = pgSql`VACUUM ${raw(opts ? `${opts} ` : "")}${identifier(table)}`;
      // VACUUM cannot run inside a transaction block — use exec (no implicit txn wrapping).
      await ctx.conn.exec(q.query);
      ctx.io.ok(`vacuumed ${table}${opts ? ` (${opts})` : ""}`);
    },
  },

  // --- indexes ---
  {
    kind: "index",
    verb: "reindex",
    summary: "REINDEX INDEX <name>",
    args: {
      positionals: [{ name: "name", required: true, help: "index name" }],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const q = pgSql`REINDEX INDEX ${identifier(name)}`;
      await ctx.conn.exec(q.query);
      ctx.io.ok(`reindexed ${name}`);
    },
  },
];
