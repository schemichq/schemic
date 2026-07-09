// READ-ONLY inspection — `sc <kind> ls` / `sc <kind> info <name>` / `sc ls` (overview). Core-provided
// for EVERY kind in the neutral kind registry (so every driver gets them for free; no per-driver
// wiring). A read command shows what you DECLARED by default; drift stays diff/check's lane.
//
// BOTH grammars work: noun-first `sc <kind> ls`/`info` (matching the driver-command grammar, so
// `access` stops being special — it also carries rotate/push/etc.) AND verb-first `sc ls <kind>` /
// `sc info <kind> <name>`. `sc ls` with no kind is the cross-kind overview.
//
// Source (boolean flags, mutually exclusive): DEFAULT the DECLARED schema (the authored `define*` — the
// diff's "desired" side; always available even pre-`gen`, never stale, fully offline); `--snapshot` the
// metaDir baseline (last `gen`); `--live` the DB (introspection; matches `diff --live`, so "the DB" is
// one word across commands).

import {
  type Driver,
  type KindEngine,
  type KindRegistry,
  loadDefs,
  lowerSchema,
  type PortableObject,
  type ResolvedConfig,
  readSnapshot,
  snapshotObjects,
  style,
} from "@schemic/core";
import type { Command } from "commander";
import { runAction } from "./action";
import { type ResolveOpts, resolveOne } from "./resolve";

export type Source = "declared" | "snapshot" | "live";

/** Resolve the source from the boolean flags — default `declared`; `--snapshot`/`--live` are mutually exclusive. */
export function pickSource(opts: {
  snapshot?: boolean;
  live?: boolean;
}): Source {
  if (opts.snapshot && opts.live)
    throw new Error("--snapshot and --live are mutually exclusive");
  if (opts.snapshot) return "snapshot";
  if (opts.live) return "live";
  return "declared";
}

// biome-ignore lint/suspicious/noExplicitAny: the registry erases each engine's A/P at this seam.
type AnyEngine = KindEngine<any, any>;

/** kind -> engine, built once from the neutral registry (the public `entries()` enumeration). */
function engineMap(registry: KindRegistry): Map<string, AnyEngine> {
  return new Map(registry.entries());
}

/** The engine for `kind` (verb-first `sc ls <kind>` / `sc info <kind>`), or a teaching error. */
export function requireKind(
  registry: KindRegistry,
  engines: Map<string, AnyEngine>,
  kind: string,
): AnyEngine {
  const engine = engines.get(kind);
  if (!engine)
    throw new Error(
      `unknown kind "${kind}" — expected one of: ${registry.names().join(", ")}`,
    );
  return engine;
}

/**
 * The NAME of the structural container a nested kind is addressed under: the `parent` hook (addressing)
 * or, failing that, `owner` (diff clustering) — so a kind that only declares `owner` still addresses
 * dotted, while an owner-declining kind can opt into dotted addressing via `parent`.
 */
function parentName(
  engine: AnyEngine | undefined,
  obj: PortableObject,
): string | undefined {
  return (engine?.parent?.(obj) ?? engine?.owner?.(obj))?.name;
}

/** The addressable key: `parent.name` for a nested kind, else the bare `name`. */
export function addressOf(
  engine: AnyEngine | undefined,
  obj: PortableObject,
): string {
  const parent = parentName(engine, obj);
  return parent ? `${parent}.${obj.name}` : obj.name;
}

/**
 * Load the portable objects of the chosen source. `declared` explodes + lowers the authored schema (the
 * diff's desired side — all kinds, incl. out-of-band ones like access); `snapshot` reads the metaDir
 * baseline (migration-managed kinds only — access isn't snapshotted); `live` introspects the DB.
 */
async function loadObjects(
  source: Source,
  driver: Driver,
  config: ResolvedConfig,
): Promise<PortableObject[]> {
  if (source === "declared") {
    const { tables, defs } = await loadDefs(config.schemaPath);
    return lowerSchema(driver.registry, driver.explode(tables, defs));
  }
  if (source === "snapshot") {
    try {
      return snapshotObjects(readSnapshot(config.metaDir).schema);
    } catch {
      return []; // no snapshot yet (pre-`gen`)
    }
  }
  const conn = await driver.connect(config);
  try {
    return await driver.introspectAll(conn);
  } finally {
    await driver.close(conn);
  }
}

/** Addresses of one kind's objects, sorted (the inventory of `ls`). */
export function addressesOfKind(
  engine: AnyEngine,
  kind: string,
  objects: PortableObject[],
): string[] {
  return objects
    .filter((o) => o.kind === kind)
    .map((o) => addressOf(engine, o))
    .sort();
}

/** `sc <kind> ls` — list entities of one kind from the chosen source. */
async function lsKind(
  kind: string,
  engine: AnyEngine,
  registry: KindRegistry,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const objects = await loadObjects(source, driver, config);
  const addresses = addressesOfKind(engine, kind, objects);
  if (json) {
    console.log(JSON.stringify({ kind, source, entities: addresses }, null, 2));
    return;
  }
  console.log(
    style.bold(
      `${registry.display(kind).plural} (${addresses.length}) — ${source}`,
    ),
  );
  if (!addresses.length) console.log(style.dim("  (none)"));
  for (const address of addresses) console.log(`  ${address}`);
}

/** `sc <kind> info <address>` — one entity's resolved DDL from the chosen source. */
async function infoKind(
  kind: string,
  address: string,
  engine: AnyEngine,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const objects = await loadObjects(source, driver, config);
  const found = objects.find(
    (o) => o.kind === kind && addressOf(engine, o) === address,
  );
  if (!found) throw new Error(`no ${kind} "${address}" in ${source}`);
  if (json) {
    console.log(
      JSON.stringify(
        { kind, address, source, ddl: engine.emit(found) },
        null,
        2,
      ),
    );
    return;
  }
  console.log(engine.emit(found).join("\n"));
}

/** `sc ls` — cross-kind OVERVIEW: every kind + entity count from the chosen source. */
async function overview(
  registry: KindRegistry,
  driver: Driver,
  config: ResolvedConfig,
  source: Source,
  json: boolean,
): Promise<void> {
  const objects = await loadObjects(source, driver, config);
  const engines = engineMap(registry);
  const rows = registry.names().map((kind) => ({
    kind,
    label: registry.display(kind).plural,
    count: addressesOfKind(engines.get(kind) as AnyEngine, kind, objects)
      .length,
  }));
  if (json) {
    console.log(JSON.stringify({ source, kinds: rows }, null, 2));
    return;
  }
  console.log(style.bold(`Schema overview — ${source}`));
  const width = Math.max(0, ...rows.map((r) => r.label.length));
  for (const r of rows) console.log(`  ${r.label.padEnd(width)}  ${r.count}`);
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
  // The three source flags (default declared); `--live` matches `diff --live` so "the DB" is one word.
  const srcOpts = (c: Command): Command =>
    c
      .option("--snapshot", "inspect the metaDir baseline (last `gen`)")
      .option("--live", "inspect the live database (introspection)")
      .option("--json", "output JSON");
  type Opts = { snapshot?: boolean; live?: boolean; json?: boolean };

  for (const kind of registry.names()) {
    const engine = engines.get(kind) as AnyEngine;
    const group = groupFor(kind);

    srcOpts(
      group
        .command("ls")
        .summary(`list ${registry.display(kind).plural.toLowerCase()}`),
    ).action((opts: Opts) =>
      runAction(async () => {
        const config = await resolveOne(resolveOpts());
        await lsKind(
          kind,
          engine,
          registry,
          driver,
          config,
          pickSource(opts),
          !!opts.json,
        );
      }),
    );

    srcOpts(
      group
        .command("info <name>")
        .summary(`show one ${kind}'s resolved definition`),
    ).action((name: string, opts: Opts) =>
      runAction(async () => {
        const config = await resolveOne(resolveOpts());
        await infoKind(
          kind,
          name,
          engine,
          driver,
          config,
          pickSource(opts),
          !!opts.json,
        );
      }),
    );
  }

  // Verb-first forms, alongside the noun-first `sc <kind> ls`/`info`: `sc ls [kind]` (a cross-kind
  // overview when omitted, else that kind's entities) and `sc info <kind> <name>`. Same actions, so both
  // grammars behave identically; an unknown kind gets a teaching error.
  srcOpts(
    program
      .command("ls [kind]")
      .summary("overview of all kinds, or list one kind's entities")
      .description(
        "With no KIND: a cross-kind overview (kinds + counts). With a KIND: that kind's entities — the verb-first form of `sc <kind> ls`. `--snapshot`/`--live` switch the source (default: declared).",
      ),
  ).action((kind: string | undefined, opts: Opts) =>
    runAction(async () => {
      const config = await resolveOne(resolveOpts());
      if (kind)
        await lsKind(
          kind,
          requireKind(registry, engines, kind),
          registry,
          driver,
          config,
          pickSource(opts),
          !!opts.json,
        );
      else
        await overview(registry, driver, config, pickSource(opts), !!opts.json);
    }),
  );

  srcOpts(
    program
      .command("info <kind> <name>")
      .summary(
        "show one entity's resolved definition (verb-first form of `sc <kind> info`)",
      ),
  ).action((kind: string, name: string, opts: Opts) =>
    runAction(async () => {
      const config = await resolveOne(resolveOpts());
      await infoKind(
        kind,
        name,
        requireKind(registry, engines, kind),
        driver,
        config,
        pickSource(opts),
        !!opts.json,
      );
    }),
  );
}
