import type { Command } from "commander";
import type { PortableDb, PortableTable } from "../driver/portable-ir";
import type { StoredSnapshot } from "./meta";

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

/** Whether a name passes a category gate (kind on + name allowed). Shared with the surreal filters. */
export const inCat = (c: Cat, name: string): boolean =>
  c.on && (!c.names || c.names.has(name));

// The SurrealDB statement/struct filters (`included`/`filterSnapshot`/`mergeSnapshot`/
// `filterStructured`) live in `./surreal-filter`. Below are the dialect-free portable-IR filters.

// --- portable-IR filters (the stored-snapshot path) ---------------------------------------------

/** Keep only the portable-IR objects that pass the filter (the {@link filterStructured} analog). */
export function filterPortable(db: PortableDb, f: Filter): PortableDb {
  const tables = db.tables
    .filter((t) => inCat(f.tables, t.name))
    .map((t) => ({
      ...t,
      events: t.events.filter((e) => inCat(f.events, e.name)),
    }));
  const functions = db.functions.filter((fn) => inCat(f.functions, fn.name));
  const accesses = db.accesses.filter((a) => inCat(f.access, a.name));
  return { tables, functions, accesses };
}

/**
 * The stored snapshot to persist after a filtered `generate` (the {@link mergeSnapshot} analog over
 * the portable IR): included kinds take their new state from `next`, excluded kinds keep `prev`'s.
 * For a table that stays, its events are merged per the events filter. `files` overlays next on prev.
 */
export function mergeStored(
  prev: StoredSnapshot,
  next: StoredSnapshot,
  f: Filter,
): StoredSnapshot {
  const tables = new Map<string, PortableTable>();
  for (const t of prev.portable.tables)
    if (!inCat(f.tables, t.name)) tables.set(t.name, t);
  for (const t of next.portable.tables) {
    if (!inCat(f.tables, t.name)) continue;
    const prevT = prev.portable.tables.find((x) => x.name === t.name);
    const events = [
      ...t.events.filter((e) => inCat(f.events, e.name)),
      ...(prevT?.events.filter((e) => !inCat(f.events, e.name)) ?? []),
    ];
    tables.set(t.name, { ...t, events });
  }
  const functions = [
    ...prev.portable.functions.filter((fn) => !inCat(f.functions, fn.name)),
    ...next.portable.functions.filter((fn) => inCat(f.functions, fn.name)),
  ];
  const accesses = [
    ...prev.portable.accesses.filter((a) => !inCat(f.access, a.name)),
    ...next.portable.accesses.filter((a) => inCat(f.access, a.name)),
  ];
  return {
    version: 2,
    driver: next.driver,
    portable: { tables: [...tables.values()], functions, accesses },
    files: { ...(prev.files ?? {}), ...(next.files ?? {}) },
  };
}

/**
 * Restrict the `disk` portable IR to objects that ALSO exist in the `live` portable IR (intersect by
 * name) AND pass the filter — for `baseline`. So hand-written schema not yet in the DB stays pending,
 * while what's really there is captured in the snapshot's canonical (generator) form.
 */
export function intersectPortable(
  disk: PortableDb,
  live: PortableDb,
  f: Filter,
): PortableDb {
  const liveByName = new Map(live.tables.map((t) => [t.name, t]));
  const tables = disk.tables.flatMap((t) => {
    const lt = liveByName.get(t.name);
    if (!lt || !inCat(f.tables, t.name)) return [];
    const liveFields = new Set(lt.fields.map((fl) => fl.name));
    const liveIndexes = new Set(lt.indexes.map((i) => i.name));
    const liveEvents = new Set(lt.events.map((e) => e.name));
    return [
      {
        ...t,
        fields: t.fields.filter((fl) => liveFields.has(fl.name)),
        indexes: t.indexes.filter((i) => liveIndexes.has(i.name)),
        events: t.events.filter(
          (e) => liveEvents.has(e.name) && inCat(f.events, e.name),
        ),
      },
    ];
  });
  const liveFns = new Set(live.functions.map((fn) => fn.name));
  const liveAccess = new Set(live.accesses.map((a) => a.name));
  const functions = disk.functions.filter(
    (fn) => liveFns.has(fn.name) && inCat(f.functions, fn.name),
  );
  const accesses = disk.accesses.filter(
    (a) => liveAccess.has(a.name) && inCat(f.access, a.name),
  );
  return { tables, functions, accesses };
}
