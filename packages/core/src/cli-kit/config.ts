import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { SchemicConfig } from "@schemic/core/config";
import { createJiti } from "jiti";
import type { ConnectionConfigBase, ResolveContext } from "../connection";

const CONFIG_NAMES = [
  "schemic.config.ts",
  "schemic.config.mjs",
  "schemic.config.js",
];

const DEFAULT_MIGRATIONS = "./database/migrations";

/**
 * Is the schema path a single file (vs a directory of schema modules)? Determined by `stat` when
 * it exists, else inferred from a `.ts`/`.js`-ish extension.
 */
function schemaIsFilePath(path: string): boolean {
  if (existsSync(path)) return statSync(path).isFile();
  return /\.[mc]?[jt]s$/.test(path);
}

/**
 * Load `.env(.local)` from the project root into `process.env` so the config's own explicit
 * `process.env.X` reads resolve when run under node (bun loads `.env` itself). Does not override
 * already-set variables, so shell env still wins; load `.env.local` first so it beats `.env`.
 */
function loadDotEnv(dir: string): void {
  const proc = process as typeof process & {
    loadEnvFile?: (path: string) => void;
  };
  if (typeof proc.loadEnvFile !== "function") return;
  for (const name of [".env.local", ".env"]) {
    const file = resolve(dir, name);
    if (!existsSync(file)) continue;
    try {
      proc.loadEnvFile(file);
    } catch {
      // ignore a malformed .env file
    }
  }
}

/**
 * A resolved, per-CONNECTION config — the dialect-NEUTRAL shape every command operates on (one
 * connection at a time). `params` are the driver-specific connection params (opaque to core; the
 * driver's `connect` reads them). Built by resolving one entry of `config.connections`.
 */
export interface ResolvedConfig {
  /** Resolved connection name (e.g. `default`, or `tenants:abc` within a collection). */
  connection: string;
  /** The driver this connection uses (the package the CLI dynamically loads). */
  driver: string;
  /** Project root (the directory containing the config file). */
  root: string;
  /** Absolute schema path — a single `.ts` module, or a directory of them. */
  schemaPath: string;
  /** Whether `schemaPath` is a single file (vs a directory of schema modules). */
  schemaIsFile: boolean;
  /** Absolute migrations directory (per connection's schema). */
  migrationsDir: string;
  /** Absolute migration meta directory (the snapshot). */
  metaDir: string;
  /** Name of the table that records applied migrations. */
  migrationsTable: string;
  /** Driver-specific connection params (url/namespace/… or whatever the driver defines). Opaque to core. */
  params: Record<string, unknown>;
  /** Optional seed script (project-level). */
  seed?: string;
}

/**
 * A jiti instance for loading the project's TS/ESM modules. Caches are off so `--watch` re-reads
 * edited schema files. (Bare deps like `@schemic/core` are native-imported, so registries stay shared.)
 */
export function makeJiti() {
  return createJiti(import.meta.url, {
    interopDefault: true,
    fsCache: false,
    moduleCache: false,
  });
}

/** Find + load `schemic.config.ts` into the dialect-neutral {@link SchemicConfig}. */
export async function loadProject(opts?: {
  config?: string;
  cwd?: string;
}): Promise<{ config: SchemicConfig; root: string }> {
  const cwd = opts?.cwd ?? process.cwd();
  const path = opts?.config
    ? resolve(cwd, opts.config)
    : CONFIG_NAMES.map((n) => resolve(cwd, n)).find((p) => existsSync(p));
  if (!path || !existsSync(path)) {
    throw new Error("No schemic.config.ts found — run `schemic init` first.");
  }
  const root = dirname(path);
  loadDotEnv(root); // populate process.env before the config module's explicit reads
  const loaded = (await makeJiti().import(path)) as {
    default?: SchemicConfig;
  } & SchemicConfig;
  const config = loaded.default ?? loaded;
  if (!config?.connections || Object.keys(config.connections).length === 0) {
    throw new Error(`Invalid config at ${path}: expected a "connections" map.`);
  }
  return { config, root };
}

/**
 * Build the {@link ResolvedConfig} for one connection of the project. `ctx` carries the lazy
 * cross-connection proxy + CLI `--arg`s (the CLI provides the real one; a static connection ignores
 * it). A resolver returning a COLLECTION yields one ResolvedConfig per keyed entry.
 *
 * NOTE (WIP — multi-connection): the full resolution engine (lazy proxy DAG, `--connection`/`--all`
 * addressing, collection fan-out) lives in `@schemic/cli`; this builder handles a single resolved
 * connection config. See docs/MULTI-CONNECTION.md.
 */
export function resolveConnectionConfig(
  config: SchemicConfig,
  connection: string,
  conn: ConnectionConfigBase,
  driver: string,
  root: string,
): ResolvedConfig {
  const { schema, migrations, key, ...params } = conn;
  const schemaPath = resolve(root, schema);
  const migrationsDir = resolve(root, migrations ?? DEFAULT_MIGRATIONS);
  return {
    connection: key ? `${connection}:${key}` : connection,
    driver,
    root,
    schemaPath,
    schemaIsFile: schemaIsFilePath(schemaPath),
    migrationsDir,
    metaDir: resolve(migrationsDir, "meta"),
    migrationsTable: config.migrationsTable ?? "_migrations",
    params: params as Record<string, unknown>,
    seed: config.seed,
  };
}

/**
 * Load the project and resolve the DEFAULT connection to a {@link ResolvedConfig} — the single-
 * connection convenience path. (Multi-connection addressing + resolver context are added by the CLI;
 * here a static default connection is resolved with an empty context.)
 */
export async function loadConfig(opts?: {
  config?: string;
  cwd?: string;
}): Promise<ResolvedConfig> {
  const { config, root } = await loadProject(opts);
  const names = Object.keys(config.connections);
  const name =
    config.defaultConnection ?? (names.length === 1 ? names[0] : "default");
  const entry = config.connections[name];
  if (!entry) {
    throw new Error(
      `No connection named "${name}". Set "defaultConnection" or pass --connection. Known: ${names.join(", ")}.`,
    );
  }
  const ctx: ResolveContext = { connections: {}, args: {}, env: process.env };
  const resolved = await entry.resolve(ctx);
  if (resolved.length !== 1) {
    throw new Error(
      `Connection "${name}" resolved to ${resolved.length} connections (a collection); pass --connection ${name}:<key>.`,
    );
  }
  return resolveConnectionConfig(config, name, resolved[0], entry.driver, root);
}

/** Per-command connection flag overrides (CLI args, applied by the driver over `params`). */
export interface ConnectionOverrides {
  url?: string;
  namespace?: string;
  database?: string;
  username?: string;
  password?: string;
  authLevel?: string;
}
