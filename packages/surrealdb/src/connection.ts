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

/** SurrealDB signin scope (mirrors `surreal sql --auth-level`). Defaults to `root`. */
export type SurrealAuthLevel = "root" | "namespace" | "database";

/**
 * A SurrealDB connection's config: the dialect-neutral base (`schema`, optional `key`/`migrations`)
 * plus the SurrealDB-specific connection params. Read env yourself in a resolver if you need it —
 * there is no implicit `SURREAL_*` magic.
 */
export interface SurrealConnectionConfig extends ConnectionConfigBase {
  /** Server RPC endpoint, e.g. `ws://127.0.0.1:8000/rpc` or `https://db.example.com`. */
  url: string;
  /** Namespace to `USE`. */
  namespace: string;
  /** Database to `USE`. */
  database: string;
  /** Auth user (omit for anonymous / no signin). */
  username?: string;
  /** Password paired with `username`. */
  password?: string;
  /** Signin scope; defaults to `root`. */
  authLevel?: SurrealAuthLevel;
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
