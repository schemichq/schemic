// The SurrealDB connection factory — binds the neutral `connectionEntry` (from @schemic/core) to the
// SurrealDB connection shape, so `defineConfig({ connections: { … } })` gets a typed `surrealConnection`
// with no hand-authored `driver: "…"` string. Design: @schemic/core docs/MULTI-CONNECTION.md.

import {
  type ConnectionConfigBase,
  type ConnectionEntry,
  type ConnectionInput,
  connectionEntry,
  type ResolveContext,
} from "@schemic/core/driver";
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
 * Build a SurrealDB {@link ConnectionEntry} for a config's `connections` map. Three forms:
 * a single static config, a resolver returning one config, or a resolver returning a keyed
 * COLLECTION (one connection per entry — `key` is then required and addressable as `<name>:<key>`).
 */
export function surrealConnection(
  config: SurrealConnectionConfig,
): ConnectionEntry;
export function surrealConnection(
  resolve: (
    ctx: ResolveContext,
  ) => SurrealConnectionConfig | Promise<SurrealConnectionConfig>,
): ConnectionEntry;
export function surrealConnection(
  resolve: (
    ctx: ResolveContext,
  ) =>
    | (SurrealConnectionConfig & { key: string })[]
    | Promise<(SurrealConnectionConfig & { key: string })[]>,
): ConnectionEntry;
export function surrealConnection(
  input: ConnectionInput<SurrealConnectionConfig>,
): ConnectionEntry {
  return connectionEntry<SurrealConnectionConfig>("surrealdb", input);
}
