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
import { lowerAccess } from "./cli/lower";
import { introspectStructured, type StructAccess } from "./cli/structure";
import { accessBindings, emitDefStatement, secretParam } from "./ddl";
import type { AccessDef, ParamDef } from "./pure";

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

/** Type-guard for a standalone access def. Realm-safe + subclass-agnostic: every access builder
 *  (Record/Jwt/Bearer/Database/Namespace) tags `kind: "access"` — matched instead of `constructor.name`. */
function isAccessDef(d: unknown): d is AccessDef {
  return (
    (d as { kind?: string }).kind === "access" &&
    (d as Partial<AccessDef>).config !== undefined
  );
}

/** Load the authored access defs from the schema (lazily; only access commands pay for it). */
async function loadAccessDefs(ctx: Ctx): Promise<AccessDef[]> {
  const { defs } = await loadDefs(ctx.config.schemaPath);
  return defs.filter(isAccessDef);
}

/** Type-guard + loader for authored `defineParam` defs (realm-safe: matched by `kind`). */
function isParamDef(d: unknown): d is ParamDef {
  return (
    (d as { kind?: string }).kind === "param" &&
    (d as Partial<ParamDef>).config !== undefined
  );
}
async function loadParamDefs(ctx: Ctx): Promise<ParamDef[]> {
  const { defs } = await loadDefs(ctx.config.schemaPath);
  return defs.filter(isParamDef);
}

/** The live params (name -> canonical value text) via `INFO FOR DB STRUCTURE`. */
async function liveParams(ctx: Ctx): Promise<Map<string, string>> {
  const db = await introspectStructured(ctx.conn);
  return new Map(db.params.map((p) => [p.name, p.value]));
}

/** Resolve an access's `$param -> SecretRef` bindings to concrete values via the provider (empty when the
 *  access has no env()/secret() keys). Values are passed as query bindings at apply — never spliced. */
async function resolveBindings(
  ctx: Ctx,
  def: AccessDef,
): Promise<Record<string, string>> {
  const bindings = accessBindings(def);
  const resolved: Record<string, string> = {};
  if (bindings)
    for (const [param, ref] of Object.entries(bindings))
      resolved[param] = await ctx.secrets.resolve(ref);
  return resolved;
}

/** Whitespace-collapse a body/expression so trivial reformatting (SurrealDB re-indents introspected
 *  bodies) doesn't read as a change. */
function normBody(s: string | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Structurally compare an authored access ({@link lowerAccess}) against the live one (introspected),
 *  returning a list of changed fields. **Keys are excluded** (SurrealDB redacts them — a key change is
 *  invisible here; that's what `rotate` is for). RECORD's auto-generated JWT + materialized default
 *  durations are ignored, so an unchanged access doesn't phantom-diff. */
function compareAccess(a: StructAccess, l: StructAccess): string[] {
  const out: string[] = [];
  if (a.kind.kind !== l.kind.kind)
    return [`type ${l.kind.kind} -> ${a.kind.kind}`];
  const ak = a.kind;
  const lk = l.kind;
  if (ak.kind === "BEARER" && ak.subject !== lk.subject)
    out.push(`subject ${lk.subject} -> ${ak.subject}`);
  // Compare the JWT verify method for TYPE JWT always; for RECORD only when the author set WITH JWT
  // (else we'd diff against SurrealDB's auto-generated record JWT).
  if (ak.kind !== "RECORD" || ak.jwt) {
    const av = ak.jwt?.verify;
    const lv = lk.jwt?.verify;
    if ((av?.url ?? "") !== (lv?.url ?? "")) out.push("jwt url");
    else if (!av?.url && (av?.alg ?? "") !== (lv?.alg ?? ""))
      out.push("jwt alg");
  }
  if (ak.kind === "RECORD") {
    if (normBody(ak.signup) !== normBody(lk.signup)) out.push("signup");
    if (normBody(ak.signin) !== normBody(lk.signin)) out.push("signin");
    if (normBody(ak.authenticate) !== normBody(lk.authenticate))
      out.push("authenticate");
    if (Boolean(ak.refresh) !== Boolean(lk.refresh)) out.push("refresh");
  }
  if ((a.comment ?? "") !== (l.comment ?? "")) out.push("comment");
  // Durations: compare only the ones the author explicitly set (SurrealDB materializes defaults on read).
  for (const key of ["grant", "token", "session"] as const)
    if (a.duration?.[key] && a.duration[key] !== l.duration?.[key])
      out.push(`duration ${key}`);
  return out;
}

export const surrealCommands: readonly DriverCommand<Surreal>[] = [
  // --- param ------------------------------------------------------------------------------------
  // Secret/declared params are OUT-OF-BAND (mirrors access): SurrealDB stores param values
  // READABLY (INFO returns them), so their values must never reach snapshots or migrations —
  // these verbs are how they deploy. Managed (inline-literal) params ride normal migrations.
  {
    kind: "param",
    verb: "push",
    summary:
      "apply DEFINE PARAM out-of-band (all secret/declared params, or <name>) — values from env()/secret(), --value, or --env",
    args: {
      positionals: [
        {
          name: "name",
          required: false,
          help: "a single param to push (default: all secret/declared params)",
        },
      ],
      flags: [
        { name: "value", value: true, help: "an explicit value (declared params)" },
        {
          name: "env",
          value: true,
          help: "read the value from this environment variable",
        },
        {
          name: "dry-run",
          help: "print the DEFINE PARAM … statements (values REDACTED) without applying",
        },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const only = a.positionals[0];
      const flagValue =
        typeof a.flags.value === "string"
          ? a.flags.value
          : typeof a.flags.env === "string"
            ? process.env[a.flags.env]
            : undefined;
      if (typeof a.flags.env === "string" && flagValue === undefined)
        throw new Error(`environment variable ${a.flags.env} is not set`);
      const params = (await loadParamDefs(ctx)).filter(
        (d) => (only ? d.name === only : d.config.mode !== "value"),
      );
      if (!params.length)
        throw new Error(
          only
            ? `no defineParam named "${only}" in the schema`
            : "no secret/declared defineParam definitions in the schema",
        );
      const dryRun = Boolean(a.flags["dry-run"]);
      for (const def of params) {
        const stmt = emitDefStatement(def, { exists: "overwrite" });
        let vars: Record<string, unknown> | undefined;
        if (def.config.mode === "secret" && def.config.secret) {
          vars = { __value: await ctx.secrets.resolve(def.config.secret) };
        } else if (def.config.mode === "declared") {
          if (flagValue === undefined)
            throw new Error(
              `param "${def.name}" is declared without a value — pass --value or --env (or give it env()/secret() in the schema)`,
            );
          vars = { __value: flagValue };
        }
        if (dryRun) {
          ctx.io.info(stmt.ddl); // the value is a $__value placeholder — nothing to redact
          continue;
        }
        await ctx.conn.query(stmt.ddl, vars);
        ctx.io.ok(`pushed param "$${def.name}"`);
      }
      if (dryRun) ctx.io.ok(`dry-run — ${params.length} param(s) not applied`);
    },
  },
  {
    kind: "param",
    verb: "check",
    summary:
      "compare authored params against the live database (presence; secret values verified without printing)",
    args: { positionals: [], flags: [] },
    async run(ctx: Ctx) {
      const authored = await loadParamDefs(ctx);
      if (!authored.length) throw new Error("no defineParam definitions in the schema");
      const live = await liveParams(ctx);
      let bad = 0;
      for (const def of authored) {
        const liveValue = live.get(def.name);
        if (liveValue === undefined) {
          ctx.io.fail(`missing  $${def.name} — not defined live (sc param push${def.config.mode === "value" ? " or sc push" : ""})`);
          bad++;
          continue;
        }
        if (def.config.mode === "secret" && def.config.secret) {
          // Compare quietly: the live value is readable to root, but never printed here.
          const want = await ctx.secrets.resolve(def.config.secret);
          const ok = liveValue === `'${want.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
          if (ok) ctx.io.ok(`ok       $${def.name} (secret, matches ${def.config.secret.kind}:${def.config.secret.name})`);
          else {
            ctx.io.fail(`stale    $${def.name} — live value differs from ${def.config.secret.kind}:${def.config.secret.name} (sc param push ${def.name})`);
            bad++;
          }
        } else {
          ctx.io.ok(`present  $${def.name}`);
        }
      }
      if (bad) throw new Error(`${bad} param(s) need attention`);
    },
  },
  {
    kind: "param",
    verb: "list",
    summary:
      "list live DEFINE PARAMs (values of authored secret params are REDACTED)",
    args: { positionals: [], flags: [] },
    async run(ctx: Ctx) {
      const authored = await loadParamDefs(ctx).catch(() => [] as ParamDef[]);
      const secretNames = new Set(
        authored.filter((d) => d.config.mode !== "value").map((d) => d.name),
      );
      const db = await introspectStructured(ctx.conn);
      if (!db.params.length) return ctx.io.info("no params defined");
      for (const p of db.params) {
        const value = secretNames.has(p.name) ? "<redacted>" : p.value;
        ctx.io.info(`$${p.name} = ${value}${p.permissions === false ? "  [PERMISSIONS NONE]" : ""}`);
      }
    },
  },
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
      const def = (await loadAccessDefs(ctx)).find((d) => d.name === name);
      if (!def)
        throw new Error(`no defineAccess named "${name}" in the schema`);
      if (!accessBindings(def))
        throw new Error(
          `access "${name}" has no env()/secret() key to rotate (its key is inline or absent)`,
        );
      // Re-emit as OVERWRITE; resolve each $param -> SecretRef -> value via the configured provider.
      const ddl = emitDefStatement(def, { exists: "overwrite" }).ddl;
      const resolved = await resolveBindings(ctx, def);
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
    verb: "push",
    summary:
      "apply DEFINE ACCESS to the database (all, or <name>) — deploys access out-of-band from migrations",
    args: {
      positionals: [
        {
          name: "name",
          required: false,
          help: "a single access to push (default: all authored accesses)",
        },
      ],
      flags: [
        {
          name: "dry-run",
          help: "print the DEFINE ACCESS … OVERWRITE statements without applying",
        },
      ],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const only = a.positionals[0];
      const accesses = (await loadAccessDefs(ctx)).filter(
        (d) => !only || d.name === only,
      );
      if (!accesses.length)
        throw new Error(
          only
            ? `no defineAccess named "${only}" in the schema`
            : "no defineAccess definitions in the schema",
        );
      const dryRun = Boolean(a.flags["dry-run"]);
      for (const def of accesses) {
        // OVERWRITE so push is idempotent (create-or-replace); secrets resolve to bound params at apply.
        const ddl = emitDefStatement(def, { exists: "overwrite" }).ddl;
        const resolved = await resolveBindings(ctx, def);
        if (dryRun) {
          ctx.io.info(ddl);
          continue;
        }
        await ctx.conn.query(ddl, resolved);
        ctx.io.ok(`pushed access "${def.name}"`);
      }
      if (dryRun)
        ctx.io.ok(`dry-run — ${accesses.length} access(es) not applied`);
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
  {
    kind: "access",
    verb: "diff",
    summary:
      "compare authored DEFINE ACCESS vs the live database (structure only — keys are redacted)",
    args: {
      positionals: [
        {
          name: "name",
          required: false,
          help: "a single access to diff (default: all)",
        },
      ],
      flags: [],
    },
    async run(ctx: Ctx, a: ParsedCommandArgs) {
      const only = a.positionals[0];
      const defs = (await loadAccessDefs(ctx)).filter(
        (d) => !only || d.name === only,
      );
      if (only && !defs.length)
        throw new Error(`no defineAccess named "${only}" in the schema`);
      const live = (await introspectStructured(ctx.conn, new Set())).accesses;
      const liveByName = new Map(live.map((l) => [l.name, l]));
      const authoredNames = new Set(defs.map((d) => d.name));
      let differ = 0;
      for (const def of defs) {
        const authored = lowerAccess(def);
        const l = liveByName.get(def.name);
        if (!l) {
          ctx.io.info(
            `+ ${def.name}  new — not in database (sc access push ${def.name})`,
          );
          differ++;
        } else {
          const changed = compareAccess(authored, l);
          if (changed.length) {
            ctx.io.info(`~ ${def.name}  changed: ${changed.join(", ")}`);
            differ++;
          } else {
            ctx.io.info(`= ${def.name}  in sync`);
          }
        }
        // Keys are redacted on read, so a key change is invisible to diff — flag the explicit path.
        if (accessBindings(def))
          ctx.io.info(
            `    (has secret key — key changes aren't detected here; use: sc access rotate ${def.name})`,
          );
      }
      // Orphans: live accesses with no authored def (only when diffing the whole set, not a single name).
      if (!only)
        for (const l of live)
          if (!authoredNames.has(l.name)) {
            ctx.io.info(
              `- ${l.name}  orphan — in database, not in schema (not removed)`,
            );
            differ++;
          }
      ctx.io.ok(
        differ ? `${differ} access(es) differ` : "all accesses in sync",
      );
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
