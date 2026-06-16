// The multi-connection RESOLUTION ENGINE (design: @schemic/core docs/MULTI-CONNECTION.md). A project's
// config maps names to CONNECTIONS; this layer turns a CLI invocation + addressing flags into the
// concrete {@link ResolvedConfig}(s) the commands run against:
//   - `--connection <name>`        a single connection (or a whole collection, fanned out)
//   - `--connection <name>:<key>`  one element of a collection
//   - `--all`                      every connection (collections fanned out to all their elements)
//   - default                      `defaultConnection`, or the sole connection, else `"default"`
//   - `--arg k=v` (repeatable)     fed to resolvers via ResolveContext.args
// A resolver may reach SIBLING connections through `ctx.connections.<name>.query(...)`; that proxy
// connects the sibling on demand (the dependency graph falls out of access; cycles error) and we close
// anything it opened once resolution settles. The returned configs are connected FRESH by each command.

import {
  type ConnectionEntry,
  type ConnectionOverrides,
  type Driver,
  driverNames,
  getDriver,
  isConnectionEntry,
  loadProject,
  type ResolveContext,
  type ResolvedConfig,
  type ResolvedConnectionHandle,
  resolveConnectionConfig,
} from "@schemic/core";

/**
 * Dynamically load + register a database driver by name. Drivers are separate packages
 * (`@schemic/<name>`) that self-register with the core registry on import; the CLI itself contains no
 * dialect code and discovers the driver from the project's connection config at runtime. Idempotent.
 */
export async function ensureDriver(name: string): Promise<void> {
  if (driverNames().includes(name)) return;
  const pkg = `@schemic/${name}`;
  try {
    await import(pkg);
  } catch (e) {
    throw new Error(
      `could not load the "${name}" database driver (package ${pkg}). Install it (e.g. \`bun add ${pkg}\`).\n  ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!driverNames().includes(name))
    throw new Error(`package ${pkg} did not register a "${name}" driver.`);
}

/** Addressing + connection overrides every command accepts. */
export interface ResolveOpts extends ConnectionOverrides {
  config?: string;
  /** Address a single connection: `<name>` (whole connection/collection) or `<name>:<key>` (one element). */
  connection?: string;
  /** Resolve EVERY connection, fanning collections out to all their keyed elements. */
  all?: boolean;
  /** `--arg k=v` (repeatable) → ResolveContext.args, so a resolver can yield a subset. */
  arg?: string[];
}

/** A commander `collect` reducer for repeatable `--arg` flags. */
export function collectArg(value: string, prev: string[]): string[] {
  return [...prev, value];
}

/** Parse `["k=v", ...]` into `{ k: v }`; rejects an entry without `=`. */
function parseArgs(arg: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of arg ?? []) {
    const i = a.indexOf("=");
    if (i < 0) throw new Error(`--arg must be key=value (got "${a}").`);
    out[a.slice(0, i)] = a.slice(i + 1);
  }
  return out;
}

/** Split a `<name>` / `<name>:<key>` address on the FIRST colon. */
function splitAddress(address: string): [name: string, key: string | undefined] {
  const i = address.indexOf(":");
  return i < 0 ? [address, undefined] : [address.slice(0, i), address.slice(i + 1)];
}

/**
 * Resolve the addressed connection(s) to {@link ResolvedConfig}s. Builds the lazy cross-connection
 * proxy (a resolver touching `ctx.connections.<other>` connects `<other>` on demand; cycles error),
 * resolves the target entry/entries (one, a fanned-out collection, or all), then closes any sibling the
 * proxy opened during resolution. Each returned connection's driver package is loaded/registered.
 */
export async function resolveTargets(
  opts: ResolveOpts,
): Promise<ResolvedConfig[]> {
  const { config, root } = await loadProject({ config: opts.config });
  const args = parseArgs(opts.arg);
  const names = Object.keys(config.connections);

  // Siblings the lazy proxy connected during resolution — closed before we return.
  const opened = new Map<
    string,
    { driver: Driver<unknown>; conn: unknown; driverName: string }
  >();
  const resolving = new Set<string>();

  const entryOf = (name: string): ConnectionEntry => {
    const entry = config.connections[name];
    if (!isConnectionEntry(entry))
      throw new Error(
        `No connection named "${name}". Known: ${names.join(", ") || "(none)"}.`,
      );
    return entry;
  };

  // Resolve ONE connection to a single config. A bare collection is ambiguous → require a `:key`.
  const resolveOneConfig = async (
    name: string,
    key?: string,
  ): Promise<ResolvedConfig> => {
    const entry = entryOf(name);
    const list = await entry.resolve(ctx);
    const picked =
      key !== undefined
        ? list.find((c) => c.key === key)
        : list.length === 1
          ? list[0]
          : undefined;
    if (!picked) {
      if (key !== undefined)
        throw new Error(`Connection "${name}" has no element with key "${key}".`);
      throw new Error(
        `Connection "${name}" resolved to ${list.length} connections (a collection); address one with --connection ${name}:<key> or use --all.`,
      );
    }
    return resolveConnectionConfig(config, name, picked, entry.driver, root);
  };

  // Connect a sibling on demand for a resolver's `ctx.connections.<name>.query(...)`. Cached; cyclic
  // access (A resolves via B resolves via A) throws instead of looping.
  const openConnection = async (name: string) => {
    const cached = opened.get(name);
    if (cached) return cached;
    if (resolving.has(name))
      throw new Error(`Connection cycle detected while resolving "${name}".`);
    resolving.add(name);
    try {
      const resolved = await resolveOneConfig(name);
      await ensureDriver(resolved.driver);
      const driver = getDriver(resolved.driver) as Driver<unknown>;
      const conn = await driver.connect(resolved, opts);
      const handle = { driver, conn, driverName: resolved.driver };
      opened.set(name, handle);
      return handle;
    } finally {
      resolving.delete(name);
    }
  };

  const connections = new Proxy(
    {} as Record<string, ResolvedConnectionHandle>,
    {
      get(_t, prop): ResolvedConnectionHandle | undefined {
        if (typeof prop !== "string") return undefined;
        return {
          async query(sql, vars) {
            const { driver, conn, driverName } = await openConnection(prop);
            if (!driver.query)
              throw new Error(
                `the "${driverName}" driver has no \`query\` capability (needed by a connection resolver).`,
              );
            return driver.query(conn, sql, vars);
          },
        };
      },
    },
  );

  const ctx: ResolveContext = { connections, args, env: process.env };

  // Fan a whole connection (single or collection) out to its config(s).
  const fanOut = async (name: string): Promise<ResolvedConfig[]> => {
    const entry = entryOf(name);
    const list = await entry.resolve(ctx);
    return list.map((conn) =>
      resolveConnectionConfig(config, name, conn, entry.driver, root),
    );
  };

  try {
    let targets: ResolvedConfig[];
    if (opts.all) {
      targets = [];
      for (const name of names) targets.push(...(await fanOut(name)));
    } else if (opts.connection) {
      const [name, key] = splitAddress(opts.connection);
      targets =
        key !== undefined
          ? [await resolveOneConfig(name, key)]
          : await fanOut(name);
    } else {
      const name =
        config.defaultConnection ?? (names.length === 1 ? names[0] : "default");
      if (!config.connections[name])
        throw new Error(
          `No default connection. Set "defaultConnection" or pass --connection. Known: ${names.join(", ") || "(none)"}.`,
        );
      targets = [await resolveOneConfig(name)];
    }
    if (!targets.length)
      throw new Error("No connections matched — nothing to do.");
    for (const driver of new Set(targets.map((t) => t.driver)))
      await ensureDriver(driver);
    return targets;
  } finally {
    for (const { driver, conn } of opened.values()) {
      try {
        await driver.close(conn);
      } catch {
        // best-effort: a sibling opened only to compute the connection list
      }
    }
  }
}

/**
 * Resolve to EXACTLY ONE connection — for commands that operate on a single connection (`diff`,
 * `gen`, `check`, `new`, `snapshot`, `doctor`). `--connection <name>` picks it; `--all` and a bare
 * collection are rejected with the command-appropriate guidance.
 */
export async function resolveOne(opts: ResolveOpts): Promise<ResolvedConfig> {
  if (opts.all)
    throw new Error(
      "--all is not supported here — this command operates on a single connection. Use --connection <name>.",
    );
  const targets = await resolveTargets(opts);
  if (targets.length !== 1)
    throw new Error(
      `--connection addressed ${targets.length} connections (a collection) — pin one with --connection <name>:<key>.`,
    );
  return targets[0];
}
