// The neutral foundation for the bound ORM CLIENT (P1) — the runtime read/write handle each driver
// builds on. Core owns only the dialect-agnostic parts: the disposable lifecycle contract and the
// managed-connection resolution. A driver's client (`@schemic/<driver>/client`) extends `OrmClientBase`,
// binds its native connection, and adds its TYPED `select`/`call` (+ writes in P2). See
// docs/proposals/managed-connections-and-orm-client.md.

import {
  loadProject,
  type ResolvedConfig,
  resolveConnectionConfig,
} from "./cli-kit/config";
import type { ResolveContext } from "./connection";

/**
 * The neutral bound-client contract. A driver's client extends this and adds its typed query surface.
 * It is an `AsyncDisposable`, so `await using db = await connect()` closes it at block exit.
 *
 * DISPOSE RULE (hard): a MANAGED client (opened by {@link resolveConnection} + the driver's `connect`)
 * closes the connection it opened; a BYO client (wrapping the user's own pool) MUST make `close` a
 * NO-OP — we never close a connection the user owns. The driver enforces this at construction.
 */
export interface OrmClientBase extends AsyncDisposable {
  /** Close the underlying connection (managed only; a BYO client is a no-op — see the dispose rule). */
  close(): Promise<void>;
}

/** Mixin the default `[Symbol.asyncDispose]` (= `close`) onto a client class's prototype. */
export function asyncDisposable<T extends { close(): Promise<void> }>(
  proto: T,
): void {
  (proto as { [Symbol.asyncDispose]?: () => Promise<void> })[
    Symbol.asyncDispose
  ] = function (this: T) {
    return this.close();
  };
}

/** Options for {@link resolveConnection}: which connection, and where the config lives. */
export interface ResolveConnectionOptions {
  /** Connection name; defaults to `defaultConnection`, else the sole connection, else `"default"`. */
  name?: string;
  /** Address one element of a keyed collection (`<name>:<key>`) — pass the `key`. */
  key?: string;
  /** Path to `schemic.config.ts` (else auto-discovered from `cwd`). */
  config?: string;
  /** Working directory to discover the config + resolve relative paths from. */
  cwd?: string;
  /** `--arg`-style values handed to a resolver connection. */
  args?: Record<string, string>;
}

// Runtime resolution is single-connection: the cross-connection proxy DAG (a resolver reaching
// `ctx.connections.<other>`) lives in the CLI and is out of P1 scope. Accessing it here throws clearly.
const noCrossConnections = new Proxy(
  {},
  {
    get() {
      throw new Error(
        "cross-connection resolution (ctx.connections.<name>) is not supported by the runtime client yet — use a static connection, or resolve via the CLI",
      );
    },
  },
) as ResolveContext["connections"];

/**
 * Resolve ONE named connection from the project config to a {@link ResolvedConfig} — the MANAGED path a
 * driver's `connect(name?)` uses before calling `driver.connect(config)`. Reuses the same
 * `loadProject` + `resolveConnectionConfig` the CLI uses, so the config is the single source of truth.
 * Supports static + arg-based resolver connections; a resolver reaching sibling connections throws
 * (P1 is single-connection — see above).
 */
export async function resolveConnection(
  opts: ResolveConnectionOptions = {},
): Promise<ResolvedConfig> {
  const { config, root } = await loadProject({
    config: opts.config,
    cwd: opts.cwd,
  });
  const names = Object.keys(config.connections);
  const name =
    opts.name ??
    config.defaultConnection ??
    (names.length === 1 ? names[0] : "default");
  const entry = config.connections[name];
  if (!entry) {
    throw new Error(
      `connection "${name}" is not defined in the config (have: ${names.join(", ") || "none"})`,
    );
  }

  const ctx: ResolveContext = {
    connections: noCrossConnections,
    args: opts.args ?? {},
    env: process.env,
  };
  const bases = await entry.resolve(ctx);
  const base = opts.key
    ? bases.find((b) => b.key === opts.key)
    : (bases[0] ?? undefined);
  if (!base) {
    throw new Error(
      opts.key
        ? `connection "${name}" has no element with key "${opts.key}"`
        : `connection "${name}" resolved to no config`,
    );
  }
  return resolveConnectionConfig(config, name, base, entry.driver, root);
}
