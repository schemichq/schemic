// READ-ONLY inspection — `sc <kind> ls` / `sc <kind> info <name>` / `sc ls` (overview). Core-provided
// for EVERY kind in the neutral kind registry (so every driver gets them for free; no per-driver
// wiring). They compose with diff/pull/push: diff shows the DELTA between snapshot and DB, `ls --from
// both` shows the INVENTORY with drift flags, `info` dumps one entity's resolved DDL.
//
// Grammar is noun-first `sc <kind> <verb>` (matching the driver-command grammar), so `access` stops
// being special — it's just the kind that also carries rotate/push/etc. on top of the universal
// ls/info. `sc ls` (no kind) is the ONE deliberate top-level verb: a cross-kind overview.
//
// Source (`--from`): `snapshot` (DEFAULT — offline, fast, deterministic; drift is diff/check's lane),
// `db` (live introspection), or `both` (snapshot vs DB side-by-side with a drift marker).

import {
  type Driver,
  type KindEngine,
  type KindRegistry,
  type PortableObject,
  type ResolvedConfig,
  readSnapshot,
  snapshotObjects,
  style,
} from "@schemic/core";
import type { Command } from "commander";
import { runAction } from "./action";
import { type ResolveOpts, resolveOne } from "./resolve";

export type Source = "snapshot" | "db" | "both";

/** Drift marker for `--from both`, comparing snapshot (S) vs DB (D). */
type Drift = "=" | "~" | "+" | "-";
const DRIFT_HELP = "= in sync · ~ differs · + only in DB · - only in snapshot";

/** Parse + validate `--from`; DEFAULT snapshot (a read command must be offline/fast by default). */
export function parseSource(raw: unknown): Source {
  const v = (raw as string | undefined) ?? "snapshot";
  if (v !== "snapshot" && v !== "db" && v !== "both")
    throw new Error(`--from must be snapshot|db|both (got "${v}")`);
  return v;
}

// biome-ignore lint/suspicious/noExplicitAny: the registry erases each engine's A/P at this seam.
type AnyEngine = KindEngine<any, any>;

/** kind -> engine, built once from the neutral registry (the public `entries()` enumeration). */
function engineMap(registry: KindRegistry): Map<string, AnyEngine> {
  return new Map(registry.entries());
}

/** The owning object's NAME for a table-scoped kind (index/event/…), via the neutral `owner` hook. */
function ownerName(
  engine: AnyEngine | undefined,
  obj: PortableObject,
): string | undefined {
  return engine?.owner?.(obj)?.name;
}

/** The addressable key: `table.name` for an owned kind, else the bare `name`. */
export function addressOf(
  engine: AnyEngine | undefined,
  obj: PortableObject,
): string {
  const owner = ownerName(engine, obj);
  return owner ? `${owner}.${obj.name}` : obj.name;
}

/** Change-detection form: the kind's `canonical` if any, else its emitted DDL (the documented default). */
function canonicalOf(engine: AnyEngine, obj: PortableObject): string {
  return engine.canonical?.(obj) ?? engine.emit(obj).join("\n");
}

/** Snapshot-side objects (offline). Empty when the project has no snapshot yet. */
function snapshotSide(config: ResolvedConfig): PortableObject[] {
  try {
    return snapshotObjects(readSnapshot(config.metaDir).schema);
  } catch {
    return [];
  }
}

/** DB-side objects (one introspection round-trip); opens + closes the connection. */
async function dbSide(
  driver: Driver,
  config: ResolvedConfig,
): Promise<PortableObject[]> {
  const conn = await driver.connect(config);
  try {
    return await driver.introspectAll(conn);
  } finally {
    await driver.close(conn);
  }
}

/**
 * Load the object sides a `--from` needs. `db`/`both` open a connection; if that fails, `both` DEGRADES
 * to snapshot-only (with a note on stderr — the diagnostic view still works offline), while an explicit
 * `db` re-throws (the user asked for the live DB).
 */
async function loadSides(
  source: Source,
  driver: Driver,
  config: ResolvedConfig,
): Promise<{
  snapshot?: PortableObject[];
  db?: PortableObject[];
  degraded?: boolean;
}> {
  if (source === "snapshot") return { snapshot: snapshotSide(config) };
  try {
    const db = await dbSide(driver, config);
    return source === "db" ? { db } : { snapshot: snapshotSide(config), db };
  } catch (e) {
    if (source === "db") throw e;
    console.error(
      style.dim(
        `  (no DB connection — showing snapshot only: ${(e as Error).message})`,
      ),
    );
    return { snapshot: snapshotSide(config), degraded: true };
  }
}

/** One row of a merged inventory: an entity keyed by address, present in snapshot and/or DB. */
export interface Row {
  kind: string;
  address: string;
  drift?: Drift;
}

/** Merge snapshot + DB objects of one kind into address-keyed rows with drift markers. */
export function mergeKind(
  engine: AnyEngine,
  kind: string,
  snap: PortableObject[] | undefined,
  db: PortableObject[] | undefined,
): Row[] {
  const s = new Map(
    snap?.filter((o) => o.kind === kind).map((o) => [addressOf(engine, o), o]),
  );
  const d = new Map(
    db?.filter((o) => o.kind === kind).map((o) => [addressOf(engine, o), o]),
  );
  const both = snap !== undefined && db !== undefined;
  const addresses = [...new Set([...s.keys(), ...d.keys()])].sort();
  return addresses.map((address) => {
    if (!both) return { kind, address };
    const inS = s.has(address);
    const inD = d.has(address);
    let drift: Drift;
    if (inS && inD)
      drift =
        canonicalOf(engine, s.get(address) as PortableObject) ===
        canonicalOf(engine, d.get(address) as PortableObject)
          ? "="
          : "~";
    else drift = inD ? "+" : "-";
    return { kind, address, drift };
  });
}

const DRIFT_STYLE: Record<Drift, (s: string) => string> = {
  "=": style.dim,
  "~": style.yellow,
  "+": style.green,
  "-": style.red,
};

function renderRow(row: Row): string {
  if (!row.drift) return `  ${row.address}`;
  return `  ${DRIFT_STYLE[row.drift](`${row.drift} ${row.address}`)}`;
}

/** `sc <kind> ls` — list entities of one kind. */
async function lsKind(
  kind: string,
  engine: AnyEngine,
  registry: KindRegistry,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const { snapshot, db } = await loadSides(source, driver, config);
  const rows = mergeKind(engine, kind, snapshot, db);
  const display = registry.display(kind);
  if (json) {
    console.log(JSON.stringify({ kind, source, entities: rows }, null, 2));
    return;
  }
  console.log(style.bold(`${display.plural} (${rows.length}) — ${source}`));
  if (source === "both") console.log(style.dim(`  ${DRIFT_HELP}`));
  if (!rows.length) console.log(style.dim("  (none)"));
  for (const row of rows) console.log(renderRow(row));
}

/** `sc <kind> info <address>` — one entity's resolved DDL (+ both-source drift). */
async function infoKind(
  kind: string,
  address: string,
  engine: AnyEngine,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const { snapshot, db } = await loadSides(source, driver, config);
  const find = (objs: PortableObject[] | undefined) =>
    objs?.find((o) => o.kind === kind && addressOf(engine, o) === address);
  const s = find(snapshot);
  const d = find(db);
  const found = s ?? d;
  if (!found) throw new Error(`no ${kind} "${address}" in ${source}`);

  if (json) {
    const ddl = (o: PortableObject | undefined) =>
      o ? engine.emit(o) : undefined;
    console.log(
      JSON.stringify(
        { kind, address, source, snapshot: ddl(s), db: ddl(d) },
        null,
        2,
      ),
    );
    return;
  }

  // both + present on each side + differing -> show each labeled; else one block.
  if (source === "both" && s && d) {
    const same = canonicalOf(engine, s) === canonicalOf(engine, d);
    if (same) {
      console.log(style.dim(`= ${address} (snapshot == db)`));
      console.log(engine.emit(s).join("\n"));
      return;
    }
    console.log(style.red(`~ ${address} (snapshot differs from db)`));
    console.log(style.bold("  --- snapshot ---"));
    console.log(engine.emit(s).join("\n"));
    console.log(style.bold("  --- db ---"));
    console.log(engine.emit(d).join("\n"));
    return;
  }
  if (source === "both")
    console.log(
      style.dim(`${d ? "+ only in db" : "- only in snapshot"}: ${address}`),
    );
  console.log(engine.emit(found).join("\n"));
}

/** `sc ls` — cross-kind OVERVIEW: every kind + entity counts (the one top-level verb). */
async function overview(
  registry: KindRegistry,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const { snapshot, db } = await loadSides(source, driver, config);
  const engines = engineMap(registry);
  const rows = registry.names().map((kind) => {
    const engine = engines.get(kind) as AnyEngine;
    const merged = mergeKind(engine, kind, snapshot, db);
    return {
      kind,
      label: registry.display(kind).plural,
      count: merged.length,
      rows: merged,
    };
  });
  if (json) {
    console.log(
      JSON.stringify(
        {
          source,
          kinds: rows.map(({ kind, label, count }) => ({ kind, label, count })),
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(style.bold(`Schema overview — ${source}`));
  if (source === "both") console.log(style.dim(`  ${DRIFT_HELP}`));
  const width = Math.max(0, ...rows.map((r) => r.label.length));
  for (const r of rows) {
    const drifted =
      source === "both"
        ? r.rows.filter((x) => x.drift && x.drift !== "=").length
        : 0;
    const suffix = drifted ? style.yellow(`  (${drifted} drifted)`) : "";
    console.log(`  ${r.label.padEnd(width)}  ${r.count}${suffix}`);
  }
}

/**
 * Register `sc <kind> ls`/`info` for EVERY registered kind (into the shared kind groups, so they sit
 * beside any driver verbs like `access rotate`), plus the top-level `sc ls` overview. Called from the
 * driver-command registration with the same `groupFor` map + `resolveOpts`.
 */
export function registerInspectVerbs(
  program: Command,
  driver: Driver,
  groupFor: (kind: string) => Command,
  resolveOpts: () => ResolveOpts,
): void {
  const registry = driver.registry;
  const engines = engineMap(registry);
  const fromOpt = "--from <source>";
  const fromHelp = "inspect snapshot | db | both (default: snapshot)";

  for (const kind of registry.names()) {
    const engine = engines.get(kind) as AnyEngine;
    const group = groupFor(kind);

    group
      .command("ls")
      .summary(`list ${registry.display(kind).plural.toLowerCase()}`)
      .option(fromOpt, fromHelp)
      .option("--json", "output JSON")
      .action((opts: { from?: string; json?: boolean }) =>
        runAction(async () => {
          const config = await resolveOne(resolveOpts());
          await lsKind(
            kind,
            engine,
            registry,
            driver,
            config,
            parseSource(opts.from),
            !!opts.json,
          );
        }),
      );

    group
      .command("info <name>")
      .summary(`show one ${kind}'s resolved definition`)
      .option(fromOpt, fromHelp)
      .option("--json", "output JSON")
      .action((name: string, opts: { from?: string; json?: boolean }) =>
        runAction(async () => {
          const config = await resolveOne(resolveOpts());
          await infoKind(
            kind,
            name,
            engine,
            driver,
            config,
            parseSource(opts.from),
            !!opts.json,
          );
        }),
      );
  }

  program
    .command("ls")
    .summary("overview: every kind and its entity count")
    .description(
      "Cross-kind overview (kinds + counts). Drill in with `sc <kind> ls`; inspect one with `sc <kind> info <name>`.",
    )
    .option(fromOpt, fromHelp)
    .option("--json", "output JSON")
    .action((opts: { from?: string; json?: boolean }) =>
      runAction(async () => {
        const config = await resolveOne(resolveOpts());
        await overview(
          registry,
          driver,
          config,
          parseSource(opts.from),
          !!opts.json,
        );
      }),
    );
}
