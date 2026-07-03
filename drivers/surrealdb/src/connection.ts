// The SurrealDB connection factory — binds the neutral `connectionEntry` (from @schemic/core) to the
// SurrealDB connection shape, so `defineConfig({ connections: { … } })` gets a typed `surrealConnection`
// with no hand-authored `driver: "…"` string. Design: @schemic/core docs/MULTI-CONNECTION.md.

import {
  type ConnectionConfigBase,
  type ConnectionEntry,
  connectionEntry,
  type ResolveContext,
} from "@schemic/core/driver";
import type { Client } from "./client";
import type { SurrealZodCheck, SurrealZodConnection } from "./config";

/** SurrealDB connection config types (the `surrealConnection` factory's shapes). */
export type {
  AuthLevel,
  CapabilityList,
  EmbeddedCapabilities,
  SurrealParams,
  SurrealZodCheck,
  SurrealZodCheckEmbedded,
  SurrealZodConnection,
} from "./config";

/**
 * A SurrealDB connection's config: the dialect-neutral base (`schema`, optional `key`/`migrations`)
 * plus the SurrealDB-specific connection params and the optional `check` replay config. Read env
 * yourself in a resolver if you need it — there is no implicit `SURREAL_*` magic. The resolution engine
 * strips the neutral base; the surreal half (url/namespace/…/check) lands in `ResolvedConfig.params`.
 */
export interface SurrealConnectionConfig
  extends ConnectionConfigBase,
    SurrealZodConnection {
  /** `schemic check` overrides — e.g. a dedicated scratch connection for the migration replay. */
  check?: SurrealZodCheck;
}

/**
 * Build a SurrealDB {@link ConnectionEntry} for a config's `connections` map: a single static config,
 * or a resolver — `(ctx, args) => config | config[]`. Declare the resolver's `args` as its (typed) 2nd
 * param; `schemic.connect(name, args)` then autocompletes + type-checks them per connection. A single
 * returned config is directly connectable; an ARRAY is a bulk fleet (migrations enumerate it; `connect`
 * throws a teaching error — pass args selecting one). Inside a resolver, `ctx.connections.<sibling>`
 * lazily opens another connection (e.g. query the control-plane DB to enumerate tenants).
 *
 * The returned entry embeds a lazy client-opener (powering `defineConfig(...)`'s typed `connect`) and
 * a `ns/db @ url` display label for bulk reporting (an explicit config `key` wins over it).
 */
export function surrealConnection(
  config: SurrealConnectionConfig,
): ConnectionEntry<Client, undefined>;
export function surrealConnection<Args = undefined>(
  resolve: (
    ctx: ResolveContext,
    args: Args,
  ) =>
    | SurrealConnectionConfig
    | SurrealConnectionConfig[]
    | Promise<SurrealConnectionConfig | SurrealConnectionConfig[]>,
): ConnectionEntry<Client, Args>;
// The union-input form — what makes the factory itself usable as the CHAIN's driver marker
// (`defineConfig().connection(name, surrealConnection, input)`): core's ChainableDriverFactory
// calls it with `ConnectionInput<C, Args>`, which neither single-shape overload above accepts.
// Last in the list, so direct static/resolver calls keep their precise inference.
export function surrealConnection<Args = undefined>(
  input:
    | SurrealConnectionConfig
    | ((
        ctx: ResolveContext,
        args: Args,
      ) =>
        | SurrealConnectionConfig
        | SurrealConnectionConfig[]
        | Promise<SurrealConnectionConfig | SurrealConnectionConfig[]>),
): ConnectionEntry<Client, Args>;
export function surrealConnection<Args = undefined>(
  input:
    | SurrealConnectionConfig
    | ((
        ctx: ResolveContext,
        args: Args,
      ) =>
        | SurrealConnectionConfig
        | SurrealConnectionConfig[]
        | Promise<SurrealConnectionConfig | SurrealConnectionConfig[]>),
): ConnectionEntry<Client, Args> {
  return connectionEntry<SurrealConnectionConfig, Client, Args>(
    "surrealdb",
    input,
    {
      // Lazy `import()` so authoring a config never pulls the engine (bundle-splittable).
      client: (config) =>
        import("./client").then((m) => m.connectFromConfig(config)),
      // Dialect display identity for bulk reporting/errors — `ns/db @ url`.
      label: (config) => {
        const p = config.params as Partial<
          Record<"url" | "namespace" | "database", string>
        >;
        const nsdb = [p.namespace, p.database].filter(Boolean).join("/");
        return [nsdb, p.url].filter(Boolean).join(" @ ") || config.connection;
      },
    },
  );
}
