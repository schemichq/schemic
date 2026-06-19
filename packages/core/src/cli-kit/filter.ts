import type { Command } from "commander";
import type { KindRegistry, PortableObject } from "../kind";
import { snapshotKinds, snapshotObjects } from "../kind";
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
// `filterStructured`) live in `./surreal-filter`. Below are the dialect-free kind-registry filters.

// --- kind-registry filters (the stored-snapshot path) -------------------------------------------

const objKey = (o: PortableObject) => `${o.kind}:${o.name}`;

/** Which Filter category gates a TOP-LEVEL kind (and whose name-set its name is matched against). */
function category(kind: string): keyof Filter {
  if (kind === "function") return "functions";
  if (kind === "access") return "access";
  return "tables"; // a table (and any future top-level structural kind)
}

/**
 * Whether a portable object passes the filter. A TOP-LEVEL object (no owner) is gated by its kind's
 * category + name. An OWNED object (owner set — an index/event/constraint) FOLLOWS its owner table's
 * inclusion; an `event` is ADDITIONALLY gated by the `events` category. (Fields are substrate nested
 * in their table object, never standalone here.)
 */
export function passesFilter(
  registry: KindRegistry,
  o: PortableObject,
  f: Filter,
): boolean {
  const owner = registry.engine(o.kind)?.owner?.(o);
  if (owner) {
    if (!inCat(f.tables, owner.name)) return false;
    return o.kind === "event" ? inCat(f.events, o.name) : true;
  }
  return inCat(f[category(o.kind)], o.name);
}

/** Keep only the portable objects that pass the filter (the {@link filterStructured} analog). */
export function filterKinds(
  registry: KindRegistry,
  objects: PortableObject[],
  f: Filter,
): PortableObject[] {
  return objects.filter((o) => passesFilter(registry, o, f));
}

/**
 * The stored snapshot to persist after a filtered `generate`: INCLUDED objects take their new state
 * from `next`, EXCLUDED objects keep `prev`'s. Dedup by `kind:name` (an included `next` object wins).
 * `files` overlays next on prev.
 */
export function mergeStored(
  registry: KindRegistry,
  prev: StoredSnapshot,
  next: StoredSnapshot,
  f: Filter,
): StoredSnapshot {
  const merged = new Map<string, PortableObject>();
  for (const o of snapshotObjects(prev.schema))
    if (!passesFilter(registry, o, f)) merged.set(objKey(o), o);
  for (const o of snapshotObjects(next.schema))
    if (passesFilter(registry, o, f)) merged.set(objKey(o), o);
  return {
    version: 3,
    driver: next.driver,
    schema: snapshotKinds([...merged.values()]),
    files: { ...(prev.files ?? {}), ...(next.files ?? {}) },
  };
}

/**
 * Restrict the `disk` objects to those that ALSO exist `live` (intersect by `kind:name`) AND pass the
 * filter — for `baseline`. Hand-written schema not yet in the DB stays pending; what's really there is
 * captured. Each field/index/event/constraint is its own object, so intersect-by-key handles them.
 */
export function intersectKinds(
  registry: KindRegistry,
  disk: PortableObject[],
  live: PortableObject[],
  f: Filter,
): PortableObject[] {
  const liveKeys = new Set(live.map(objKey));
  return disk.filter(
    (o) => liveKeys.has(objKey(o)) && passesFilter(registry, o, f),
  );
}
