// The files `schemic init` writes for a fresh SurrealDB project — a connections-only config via the
// surrealConnection factory, a sample s.* schema, a seed stub, and a .env.example. The CLI (dialect-
// free) calls surrealDriver.initScaffold() and writes these verbatim, then records the neutral snapshot.

const CONFIG = `import { defineConfig } from "@schemic/core/config";
import { surrealConnection } from "@schemic/surrealdb";

// Connections-only config: each named connection comes from a driver's \`<driver>Connection(...)\`
// factory, so there's no \`driver: "…"\` string to keep in sync. Values are explicit — read env here
// yourself (no implicit SURREAL_* magic). Add more named connections for multi-tenant / multi-DB setups.
export default defineConfig({
  connections: {
    default: surrealConnection({
      schema: "./database/schema",
      url: process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
      namespace: process.env.SURREAL_NAMESPACE ?? "app",
      database: process.env.SURREAL_DATABASE ?? "app",
      username: process.env.SURREAL_USER,
      password: process.env.SURREAL_PASS,
      authLevel: "root", // "root" | "namespace" | "database"
      // \`schemic check\` replays migrations into a throwaway engine; defaults to an ephemeral in-memory
      // SurrealDB from your local \`surreal\` CLI. Override here, e.g.:
      // check: { engine: "remote", db: { url: "ws://localhost:8000", namespace: "scratch" } },
    }),
  },
});
`;

const USER_TABLE = `import { defineTable, s, surql } from "@schemic/surrealdb";

// A SCHEMAFULL \`user\` table. Each field is a \`s.*\` builder (a drop-in for Zod's \`z.*\`) that also
// carries its SurrealQL DDL — \`s.email()\` validates the address, \`.$unique()\` defines a UNIQUE index,
// and \`$default\`/\`$readonly\` map to the DEFAULT / READONLY clauses.
export const User = defineTable("user", {
  name: s.string().$assert(surql\`string::len($value) > 0\`),
  email: s.email().$unique(),
  createdAt: s.datetime().$default(surql\`time::now()\`).$readonly(),
}).schemafull();
`;

const SEED = `import { defineSeed } from "@schemic/surrealdb";
import { User } from "../schema/tables/user";

// The default seed — \`schemic seed\` (no arg) runs this \`index.ts\`. Add more named seeds alongside it:
// \`database/seed/01-users.ts\` runs as \`schemic seed users\` (the numeric prefix orders \`seed --all\`).
// \`defineSeed\` types \`db\` (the SurrealDB client) and \`ctx\` (a fs helper) — no imports needed.
export default defineSeed(async (db, ctx) => {
  // \`User.record().for("ada")\` is the typed \`user:ada\` record id (no \`RecordId\` import). \`User.encode\`
  // turns app values into the wire payload — and applies the field codecs (a Date -> a SurrealQL
  // datetime, etc.). \`User.decode(row)\` is the read direction.
  await db.create(User.record().for("ada")).content(
    User.encode({
      name: "Ada Lovelace",
      email: "ada@example.com",
    }),
  );
  // Bulk-load raw SurrealQL kept next to this seed: await db.query(ctx.file("seed.surql"));
});
`;

const ENV_EXAMPLE = `# Point these at your SurrealDB. The config reads them explicitly (no implicit SURREAL_* magic).
SURREAL_URL=ws://127.0.0.1:8000/rpc
SURREAL_NAMESPACE=app
SURREAL_DATABASE=app
SURREAL_USER=root
SURREAL_PASS=root
`;

/** The dialect-specific files `schemic init` writes, keyed by project-relative path. */
export function initScaffold(): Record<string, string> {
  return {
    "schemic.config.ts": CONFIG,
    "database/schema/tables/user.ts": USER_TABLE,
    "database/seed/index.ts": SEED,
    ".env.example": ENV_EXAMPLE,
  };
}

// --- `schemic new <kind> <name>` — per-kind starter modules ----------------------------------------

/** `"user_profile"` -> `"UserProfile"` (the exported const name). Non-alphanumerics split words. */
function pascalCase(name: string): string {
  const parts = name.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const pascal = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join("");
  // Keep it a valid identifier: prefix a leading digit, fall back to a generic name.
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal || "Entity";
}

/**
 * Author a starter module for `kind`/`name`. One template per authorable SurrealDB object, each a
 * realistic starting point (not a bare stub). THROWS for a kind SurrealDB doesn't author standalone
 * (notably `index`/`field`, which live inline on a table) or an unknown kind — the CLI surfaces the
 * message. Used by `schemic new`; the CLI writes the result under the kind's display folder.
 */
export function scaffoldEntity(kind: string, name: string): string {
  const C = pascalCase(name);
  switch (kind) {
    case "table":
      return `import { defineTable, s, surql } from "@schemic/surrealdb";

// A SCHEMAFULL table. Each field is an \`s.*\` builder (a drop-in for Zod's \`z.*\`) that also carries
// its SurrealQL DDL. Add fields, then run \`schemic gen\`.
export const ${C} = defineTable("${name}", {
  name: s.string(),
  createdAt: s.datetime().$default(surql\`time::now()\`).$readonly(),
}).schemafull();
`;
    case "relation":
      return `import { defineRelation, s, surql } from "@schemic/surrealdb";

// A graph edge (\`TYPE RELATION\`). Chain \`.from(A).to(B)\` to restrict the endpoints and
// \`.enforced()\` to require both records to exist on RELATE.
export const ${C} = defineRelation("${name}", {
  since: s.datetime().$default(surql\`time::now()\`),
});
// .from(SomeTable).to(OtherTable).enforced()
`;
    case "view":
      return `import { defineView, s, surql } from "@schemic/surrealdb";

// A pre-computed (materialized) view — SurrealDB keeps its rows in sync with the source query.
// The optional shape on defineView(name, shape) types the projected rows (App + decode); .as() sets
// the SELECT. A shapeless defineView("${name}").as(...) leaves the rows untyped.
export const ${C} = defineView("${name}", { name: s.string() }).as(
  surql\`SELECT name FROM thing WHERE true\`,
);
`;
    case "function":
      return `import { defineFunction, s, surql } from "@schemic/surrealdb";

// A custom function (\`fn::${name}\`). Functions referenced from fields/events/access become
// dependency edges, so a caller emits after its callee.
export const ${C} = defineFunction("${name}", { arg: s.string() })
  .returns(s.string())
  .body(surql\`RETURN $arg\`);
`;
    case "access":
      return `import { defineAccess, surql } from "@schemic/surrealdb";

// A RECORD access method (signup/signin). See \`.jwt({ … })\` / \`.bearer({ … })\` for other types.
export const ${C} = defineAccess("${name}")
  .record()
  .signup(surql\`CREATE user SET email = $email, pass = crypto::argon2::generate($pass)\`)
  .signin(surql\`SELECT * FROM user WHERE email = $email AND crypto::argon2::compare(pass, $pass)\`)
  .duration({ token: "1h", session: "12h" });
`;
    case "event":
      return `import { defineEvent, surql } from "@schemic/surrealdb";

// A standalone event — replace "thing" with the table it fires on. \`then\` takes one expression or
// an ordered array.
export const ${C} = defineEvent("thing", "${name}", {
  when: surql\`$event = "CREATE"\`,
  then: surql\`CREATE log SET at = time::now()\`,
});
`;
    case "analyzer":
      return `import { defineAnalyzer } from "@schemic/surrealdb";

// A text analyzer for FULLTEXT search. A \`.index(field, { fulltext: { analyzer: "${name}" } })\` on a
// table depends on it.
export const ${C} = defineAnalyzer("${name}", {
  tokenizers: ["blank"],
  filters: ["lowercase"],
});
`;
    case "index":
    case "field":
      throw new Error(
        `SurrealDB ${kind}s are authored inline on a table, not as their own file — add it to a table (e.g. \`defineTable("…", { … }).index("${name}", [field])\` or \`s.string().$unique()\`). Try \`schemic new table <name>\`.`,
      );
    default:
      throw new Error(
        `the surrealdb driver can't scaffold a "${kind}" — known kinds: table, relation, view, function, access, event, analyzer.`,
      );
  }
}
