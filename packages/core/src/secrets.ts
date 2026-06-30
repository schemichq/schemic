// Secret references for secret-bearing DDL (e.g. SurrealDB `DEFINE ACCESS` keys). A `SecretRef` is an
// authoring-time PLACEHOLDER — it never carries the secret value. The value is resolved at APPLY time by
// the CLI through a `SecretProvider` and handed to the database as a BOUND PARAMETER (never spliced into
// the DDL string), so secrets stay out of the schema source, the snapshot, and the migration files.
//
//   key: env("JWT_SECRET")            // resolved from process.env at apply
//   key: secret("jwt/signing-key")    // resolved from the configured SecretProvider at apply
//
// The clause carrying a `SecretRef` is marked `writeOnly` in the IR (diff-excluded + snapshot-omitted),
// so a redacted secret never reads as drift; because the diff can't see the value, rotation is the
// explicit `apply --rotate-keys` (it can't be auto-detected).

/** An author-time reference to a secret, resolved to its value at apply time — never the value itself. */
export interface SecretRef {
  /** `env` → resolved from `process.env`; `secret` → resolved from the configured {@link SecretProvider}. */
  readonly kind: "env" | "secret";
  /** The environment-variable / secret name to resolve at apply. */
  readonly name: string;
}

/** Bind a value to an environment variable, resolved at apply from `process.env[name]`. */
export function env(name: string): SecretRef {
  return { kind: "env", name };
}

/** Bind a value to a named secret, resolved at apply from the configured {@link SecretProvider}. */
export function secret(name: string): SecretRef {
  return { kind: "secret", name };
}

/** Runtime guard: is `v` a {@link SecretRef} (vs a raw `string` literal key)? */
export function isSecretRef(v: unknown): v is SecretRef {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<SecretRef>;
  return (r.kind === "env" || r.kind === "secret") && typeof r.name === "string";
}

/**
 * Resolves {@link SecretRef}s to their values at apply time. Pluggable: the default
 * {@link envSecretProvider} reads every ref from `process.env`; swap it for a vault / file source by
 * passing a custom provider to the apply layer. The resolved value is handed to the DB as a BOUND
 * PARAMETER — never string-spliced into the DDL.
 */
export interface SecretProvider {
  resolve(ref: SecretRef): string | Promise<string>;
}

/** Default provider: resolves every {@link SecretRef} from `process.env[ref.name]`; throws if unset. */
export const envSecretProvider: SecretProvider = {
  resolve(ref: SecretRef): string {
    const value = process.env[ref.name];
    if (value === undefined) {
      throw new Error(
        `schemic: secret ${ref.kind}(${JSON.stringify(ref.name)}) is not set in the environment`,
      );
    }
    return value;
  },
};
