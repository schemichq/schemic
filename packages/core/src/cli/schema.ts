import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Shape, StandaloneDef, TableDef } from "surreal-zod";
import { makeJiti } from "./config";

export type AnyTable = TableDef<string, Shape>;

/**
 * Duck-typed `TableDef` check. We avoid `instanceof` on purpose: the user's schema and the
 * CLI may end up with different module instances of `surreal-zod`, so we recognize a table
 * by shape instead. (Structural access into `emitStatements` works regardless.)
 */
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

/** Duck-typed standalone-def check (`defineEvent`/`defineFunction`) — see `isTableDef` on why not `instanceof`. */
function isStandaloneDef(v: unknown): v is StandaloneDef {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    (d.kind === "event" || d.kind === "function" || d.kind === "access") &&
    typeof d.name === "string"
  );
}

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (/\.(ts|mts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts"))
      out.push(p);
  }
  return out;
}

/** The schema module file(s) for a path: the file itself, or every module under the directory. */
function schemaFiles(path: string): string[] {
  return statSync(path).isFile() ? [path] : tsFiles(path);
}

/** Import a schema module file and yield its exported tables/relations, paired with the file. */
async function* tablesIn(
  jiti: ReturnType<typeof makeJiti>,
  file: string,
): AsyncGenerator<AnyTable> {
  const mod = (await jiti.import(file)) as Record<string, unknown>;
  for (const value of Object.values(mod)) if (isTableDef(value)) yield value;
}

/**
 * Load every schema object from `schemaPath` (a single `.ts` module, or a directory of them): the
 * tables/relations (ordered normal-before-relation, then by name, for stable DDL) and the standalone
 * defs (`defineEvent`/`defineFunction`). One pass over the files.
 */
export async function loadDefs(
  schemaPath: string,
): Promise<{ tables: AnyTable[]; defs: StandaloneDef[] }> {
  if (!existsSync(schemaPath)) {
    throw new Error(`Schema path not found: ${schemaPath}`);
  }
  const jiti = makeJiti();
  const tables = new Map<string, AnyTable>();
  const defs: StandaloneDef[] = [];
  for (const file of schemaFiles(schemaPath)) {
    const mod = (await jiti.import(file)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (isTableDef(value))
        tables.set(value.name, value); // last def of a name wins
      else if (isStandaloneDef(value)) defs.push(value);
    }
  }
  const rank = (t: AnyTable) => (t.config.relation ? 1 : 0);
  const sorted = [...tables.values()].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
  );
  return { tables: sorted, defs };
}

/** The tables/relations from `schemaPath` (standalone events excluded — see {@link loadDefs}). */
export async function loadSchemas(schemaPath: string): Promise<AnyTable[]> {
  return (await loadDefs(schemaPath)).tables;
}

/** Map of table name → the file that defines it (for `pull`'s duplicate-definition check). */
export async function existingTables(
  schemaPath: string,
): Promise<Map<string, string>> {
  if (!existsSync(schemaPath)) return new Map();
  const jiti = makeJiti();
  const out = new Map<string, string>();
  for (const file of schemaFiles(schemaPath)) {
    for await (const t of tablesIn(jiti, file)) out.set(t.name, file);
  }
  return out;
}

/**
 * Names defined in more than one place, mapped to the files that define them (a file repeats if it
 * defines the same name twice). `loadSchemas` silently lets the last definition win, so this is how
 * `doctor` surfaces the otherwise-invisible conflict.
 */
export async function duplicateTables(
  schemaPath: string,
): Promise<Map<string, string[]>> {
  if (!existsSync(schemaPath)) return new Map();
  const jiti = makeJiti();
  const seen = new Map<string, string[]>();
  for (const file of schemaFiles(schemaPath)) {
    for await (const t of tablesIn(jiti, file)) {
      const files = seen.get(t.name);
      if (files) files.push(file);
      else seen.set(t.name, [file]);
    }
  }
  return new Map([...seen].filter(([, files]) => files.length > 1));
}
