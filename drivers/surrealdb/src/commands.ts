// SurrealDB driver-contributed CLI commands — `sc <kind> <verb> [args]`. Core's dispatch resolves the
// connection + hands `run(ctx, parsed)` a CommandContext; THIS file owns the SurrealDB logic. Authored
// against the landed DriverCommand contract (@schemic/core/driver). The driver validates positional
// arity itself; use `ctx.io` for all output (never stdio directly).
import { isSecretRef, loadDefs } from "@schemic/core";
import type {
  CommandContext,
  DriverCommand,
  ParsedCommandArgs,
} from "@schemic/core/driver";
import { escapeIdent, type Surreal } from "surrealdb";
import { accessBindings, emitDefStatement, secretParam } from "./ddl";
import type { AccessDef } from "./pure";

type Ctx = CommandContext<Surreal>;

/** Read a required positional by index, with a clear error naming the missing arg. */
function pos(a: ParsedCommandArgs, i: number, name: string): string {
  const v = a.positionals[i];
  if (v === undefined || v === "") throw new Error(`missing <${name}>`);
  return v;
}

/** A `surreal.query` returning the first statement's rows. */
async function rows<T = unknown>(
  conn: Surreal,
  sql: string,
  vars?: Record<string, unknown>,
): Promise<T[]> {
  const [first] = await conn.query<[T[]]>(sql, vars);
  return first ?? [];
}

export const surrealCommands: readonly DriverCommand<Surreal>[] = [
  // --- access -----------------------------------------------------------------------------------
  {
    kind: "access",
    verb: "rotate",
    summary:
      "re-apply DEFINE ACCESS <name> with its secret freshly resolved (env()/secret()) — for key rotation",
    args: {
      positionals: [
        { name: "name", required: true, help: "access definition name" },
      ],
      flags: [
        {
          name: "dry-run",
          help: "print the DEFINE ACCESS … OVERWRITE without applying",
        },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const { defs } = await loadDefs(ctx.config.schemaPath);
      const def = defs.find(
        (d): d is AccessDef =>
          (d as Partial<AccessDef>).config !== undefined &&
          (d as AccessDef).name === name &&
          d.constructor?.name === "AccessDef",
      );
      if (!def)
        throw new Error(`no defineAccess named "${name}" in the schema`);
      const bindings = accessBindings(def);
      if (!bindings)
        throw new Error(
          `access "${name}" has no env()/secret() key to rotate (its key is inline or absent)`,
        );
      // Re-emit as OVERWRITE; resolve each $param -> SecretRef -> value via the configured provider.
      const ddl = emitDefStatement(def, { exists: "overwrite" }).ddl;
      const resolved: Record<string, string> = {};
      for (const [param, ref] of Object.entries(bindings))
        resolved[param] = await ctx.secrets.resolve(ref);
      if (a.flags["dry-run"]) {
        ctx.io.info(ddl);
        ctx.io.ok(
          `dry-run — would rotate "${name}" (${Object.keys(resolved).length} secret(s) resolved, not applied)`,
        );
        return;
      }
      await ctx.conn.query(ddl, resolved);
      ctx.io.ok(`rotated access "${name}"`);
    },
  },
  {
    kind: "access",
    verb: "check",
    summary:
      "verify an access works: sign in as <name> with --user/--password (prompted if omitted)",
    args: {
      positionals: [
        { name: "name", required: true, help: "access definition name" },
      ],
      flags: [
        { name: "user", value: true, help: "the signin user/identifier" },
        {
          name: "password",
          value: true,
          help: "the signin password (prompted, hidden, if omitted)",
        },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const name = pos(a, 0, "name");
      const user =
        typeof a.flags.user === "string"
          ? a.flags.user
          : await ctx.io.prompt("user: ");
      // Never require a secret inline (shell-history leak) — prompt hidden when not passed.
      const pass =
        typeof a.flags.password === "string"
          ? a.flags.password
          : await ctx.io.prompt("password: ", { hidden: true });
      try {
        // The connection is already `.use()`d on its namespace/database (ResolvedConfig is
        // dialect-neutral and carries neither), so the access signin rides that context.
        await ctx.conn.signin({
          access: name,
          variables: { user, pass },
        } as Parameters<Surreal["signin"]>[0]);
        ctx.io.ok(`access "${name}" — signin OK`);
      } catch (e) {
        ctx.io.fail(
          `access "${name}" — signin FAILED: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  },
  // --- table ------------------------------------------------------------------------------------
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
        1,
        Math.floor(Number(a.flags.limit ?? 100)) || 100,
      );
      // table + column are identifiers (escaped); the value is a BOUND param.
      const sql = `SELECT * FROM type::table($tbl) WHERE ${escapeIdent(col)} = $val LIMIT ${limit}`;
      const found = await rows(ctx.conn, sql, { tbl: table, val });
      ctx.io.ok(`${found.length} row(s)`);
      for (const r of found) ctx.io.info(JSON.stringify(r));
    },
  },
];
