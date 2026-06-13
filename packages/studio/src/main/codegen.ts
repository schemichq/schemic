import { pathToFileURL } from "node:url";

// Generate SurrealQL DDL from a `.ts`/`.js` schema file by loading it with jiti and
// running surreal-zod's public emit functions over the exported sz.* defs. Runs in the
// main process (node) — the renderer can't execute the user's TS. (Engine bridge, Slice 2.)
//
// We duck-type the loaded objects rather than `instanceof`: the opened project has its
// OWN surreal-zod instance (resolved from its node_modules), distinct from studio's, but
// emit's structural access works across instances — same approach as the CLI's loadDefs.

export interface CodegenResult {
  ok: boolean;
  surql?: string;
  error?: string;
}

type AnyTable = {
  name: string;
  fields: object;
  config: { relation?: unknown };
  record: (...args: unknown[]) => unknown;
};
type AnyDef = { kind: "event" | "function" | "access"; name: string };

function isTableDef(v: unknown): v is AnyTable {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.name === "string" &&
    typeof t.fields === "object" &&
    t.fields !== null &&
    typeof t.config === "object" &&
    t.config !== null &&
    typeof t.record === "function"
  );
}

function isStandaloneDef(v: unknown): v is AnyDef {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    (d.kind === "event" || d.kind === "function" || d.kind === "access") &&
    typeof d.name === "string"
  );
}

/**
 * Generate SurrealQL for a schema file. When `content` is given, the in-memory editor
 * buffer is evaluated (with the real path as resolution context, so sibling/`surreal-zod`
 * imports still resolve) — live preview without saving. Otherwise the on-disk file is read.
 */
export async function generateSurql(file: string): Promise<CodegenResult> {
  try {
    const { createJiti } = await import("jiti");
    // Base jiti at the schema file so `surreal-zod` + sibling imports resolve from the
    // opened project. fsCache off so every call re-reads from disk (regenerates on save).
    // moduleCache ON so, within THIS call, surreal-zod is evaluated once and shared
    // between the emit import below and the schema's own `import "surreal-zod"` — one
    // codec registry, so native fields aren't misread as sz.custom(). A fresh jiti per
    // call keeps it current. (jiti.evalModule on the in-memory buffer would resolve a
    // SECOND surreal-zod instance — false sz.custom — so we read the saved file.)
    const jiti = createJiti(pathToFileURL(file).href, {
      interopDefault: true,
      fsCache: false,
      moduleCache: true,
    });
    // Load emit through the SAME jiti instance the schema uses, so both share one
    // surreal-zod module — and one codec registry.
    const sz = (await jiti.import("surreal-zod")) as {
      emitTable: (t: unknown) => string;
      emitDefStatement: (d: unknown) => { ddl: string };
    };
    const mod = (await jiti.import(file)) as Record<string, unknown>;

    const tables: AnyTable[] = [];
    const defs: AnyDef[] = [];
    for (const value of Object.values(mod)) {
      if (isTableDef(value)) tables.push(value);
      else if (isStandaloneDef(value)) defs.push(value);
    }
    // Stable order: normal tables before relations, then by name (matches `sz pull`).
    const rank = (t: AnyTable) => (t.config.relation ? 1 : 0);
    tables.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    if (tables.length === 0 && defs.length === 0) {
      return { ok: true, surql: "" };
    }
    const parts: string[] = [];
    for (const t of tables) parts.push(sz.emitTable(t));
    for (const d of defs) parts.push(sz.emitDefStatement(d).ddl);
    return { ok: true, surql: parts.join("\n\n") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
