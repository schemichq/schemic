// The SurrealDB connection factory — binds the neutral `connectionEntry` (from @schemic/core) to the
// SurrealDB connection shape, so `defineConfig({ connections: { … } })` gets a typed `surrealConnection`
// with no hand-authored `driver: "…"` string. Design: @schemic/core docs/MULTI-CONNECTION.md.

import type { StandardSchemaLike } from "@schemic/core";
import {
  type ConnectionConfigBase,
  type ConnectionEntry,
  type ConnectionInput,
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

/** The typed resolver-`args` OUTPUT inferred from an optional Standard-Schema `args` (a real schema
 *  carries `~standard.types.output`); with no `args` schema, args are plain `Record<string, string>`. */
type ArgsOf<A> = A extends {
  "~standard": { types: { output: infer O extends Record<string, unknown> } };
}
  ? O
  : Record<string, string>;

/** The resolver `ctx` with its `args` typed to the connection's `args` schema output. */
type Ctx<A> = Omit<ResolveContext, "args"> & { args: ArgsOf<A> };

/**
 * Build a SurrealDB {@link ConnectionEntry} for a config's `connections` map. Three forms:
 * a single static config, a resolver returning one config, or a resolver returning a keyed
 * COLLECTION (one connection per entry — `key` is then required and addressable as `<name>:<key>`).
 *
 * The returned entry embeds a lazy client-opener + the optional `args` schema, so `defineConfig(...)`'s
 * typed `connect(name)` hands back a `@schemic/surrealdb` {@link Client} and validates/types `args`.
 */
export function surrealConnection<A extends StandardSchemaLike = never>(
  config: SurrealConnectionConfig,
  opts?: { args?: A },
): ConnectionEntry<Client, ArgsOf<A>>;
export function surrealConnection<A extends StandardSchemaLike = never>(
  resolve: (
    ctx: Ctx<A>,
  ) => SurrealConnectionConfig | Promise<SurrealConnectionConfig>,
  opts?: { args?: A },
): ConnectionEntry<Client, ArgsOf<A>>;
export function surrealConnection<A extends StandardSchemaLike = never>(
  resolve: (
    ctx: Ctx<A>,
  ) =>
    | (SurrealConnectionConfig & { key: string })[]
    | Promise<(SurrealConnectionConfig & { key: string })[]>,
  opts?: { args?: A },
): ConnectionEntry<Client, ArgsOf<A>>;
export function surrealConnection<A extends StandardSchemaLike = never>(
  input: ConnectionInput<SurrealConnectionConfig, ArgsOf<A>>,
  opts?: { args?: A },
): ConnectionEntry<Client, ArgsOf<A>> {
  return connectionEntry<SurrealConnectionConfig, Client, ArgsOf<A>>(
    "surrealdb",
    input,
    {
      // Lazy `import()` so authoring a config never pulls the engine (bundle-splittable).
      client: (config) =>
        import("./client").then((m) => m.connectFromConfig(config)),
      args: opts?.args,
    },
  );
}
