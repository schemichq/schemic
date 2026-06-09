import type { Command } from "commander";
import type { DefineStatement } from "surreal-zod";
import type { Snapshot } from "./meta";
import type { DbStructured } from "./structure";

/**
 * Per-kind object filter for `pull`/`diff`/`sync`/`generate`. Each kind is independently
 * included (optionally name-restricted). `DEFINE ACCESS` is OPT-IN everywhere — excluded
 * unless `--access` is given — so an introspection (which redacts access signing keys) can't
 * silently rotate them. Table-scoped objects (fields/indexes/events) follow their table.
 */
interface Cat {
  on: boolean;
  /** When set, only these names of the kind are included. */
  names?: Set<string>;
}

export interface Filter {
  tables: Cat;
  functions: Cat;
  events: Cat;
  access: Cat;
}

/** Commander's parse of one `--kind [names]` / `--no-kind` flag: `undefined`/`true`/string/`false`. */
type FlagValue = string | boolean | undefined;

export interface FilterOpts {
  tables?: FlagValue;
  functions?: FlagValue;
  events?: FlagValue;
  access?: FlagValue;
}

function cat(v: FlagValue, defaultOn: boolean): Cat {
  if (v === undefined) return { on: defaultOn };
  if (v === false) return { on: false };
  if (v === true) return { on: true };
  const names = new Set(
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return names.size ? { on: true, names } : { on: true };
}

/** Build a {@link Filter} from CLI flags. Access is opt-in (`--access`); the rest default to on. */
export function parseFilter(o: FilterOpts): Filter {
  return {
    tables: cat(o.tables, true),
    functions: cat(o.functions, true),
    events: cat(o.events, true),
    access: cat(o.access, false), // DEFINE ACCESS is explicit everywhere — see module note.
  };
}

/** Attach the per-kind `--tables/--functions/--events/--access [names]` (+ `--no-*`) options. */
export function kindFlags(cmd: Command): Command {
  return cmd
    .option("--tables [names]", "only these tables (comma-separated)")
    .option("--no-tables", "exclude all tables")
    .option("--functions [names]", "only these functions")
    .option("--no-functions", "exclude all functions")
    .option("--events [names]", "only these events")
    .option("--no-events", "exclude all events")
    .option(
      "--access [names]",
      "include access (off by default; key not pulled)",
    )
    .option("--no-access", "exclude all access (the default)");
}

const inCat = (c: Cat, name: string): boolean =>
  c.on && (!c.names || c.names.has(name));

/** Whether a `DefineStatement` passes the filter (table-scoped objects also need their table in). */
export function included(f: Filter, s: DefineStatement): boolean {
  const table = s.table ?? s.name;
  switch (s.kind) {
    case "table":
    case "field":
    case "index":
      return inCat(f.tables, table);
    case "event":
      return inCat(f.tables, table) && inCat(f.events, s.name);
    case "function":
      return inCat(f.functions, s.name);
    case "access":
      return inCat(f.access, s.name);
  }
}

/** Keep only the snapshot statements that pass the filter (for `diff`/`sync`/`generate`). */
export function filterSnapshot(snap: Snapshot, f: Filter): Snapshot {
  const statements: Record<string, DefineStatement> = {};
  for (const [k, s] of Object.entries(snap.statements))
    if (included(f, s)) statements[k] = s;
  return { ...snap, statements };
}

/**
 * The snapshot to persist after a filtered `generate`: included kinds take their new state from
 * `next`, excluded kinds keep their prior state from `prev`. So generating without `--access`
 * leaves the snapshot's access untouched (no phantom add/remove) rather than dropping it.
 */
export function mergeSnapshot(
  prev: Snapshot,
  next: Snapshot,
  f: Filter,
): Snapshot {
  const statements: Record<string, DefineStatement> = {};
  for (const [k, s] of Object.entries(prev.statements))
    if (!included(f, s)) statements[k] = s;
  for (const [k, s] of Object.entries(next.statements))
    if (included(f, s)) statements[k] = s;
  return { ...next, statements };
}

/** Keep only the introspected objects that pass the filter (for `pull`). */
export function filterStructured(db: DbStructured, f: Filter): DbStructured {
  const tables = db.tables
    .filter((t) => inCat(f.tables, t.name))
    .map((t) => ({
      ...t,
      events: t.events.filter((e) => inCat(f.events, e.name)),
    }));
  const functions = db.functions.filter((fn) => inCat(f.functions, fn.name));
  return { tables, functions };
}
