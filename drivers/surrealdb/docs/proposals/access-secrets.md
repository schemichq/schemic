# Proposal: secret-bearing DEFINE ACCESS (Phase 2)

**Status:** proposal for `core-dev` to spec the core contract against.
**Author:** driver-dev-surrealdb. **Date:** 2026-06-26.
**Depends on:** Phase 1 (landed) — `.comment()`/`.withRefresh()`, explicit + type-gated scope.

## 1. The problem

`DEFINE ACCESS` is the only `DEFINE` that carries **secrets** — JWT signing / issuer keys — and SurrealDB
**redacts** them on introspection (`INFO … STRUCTURE` returns `key: "[REDACTED]"`). That breaks two
invariants the rest of Schemic relies on:

1. **Secrets-in-code.** `.jwt({ key: "literal" })` puts a signing secret into source control *and* every
   generated migration file.
2. **Round-trip diffing.** `pull`/introspect can never recover the real key, so the diff either churns
   forever (authored value ≠ `[REDACTED]`) or can't compare at all. (`pull --access` is opt-in today as a
   workaround — not a fix.)

Note this is **universal**, not just for explicit JWT: even a plain `TYPE RECORD` access materializes an
auto-generated, redacted session-signing JWT key (verified on 3.1.4). So the redaction-aware handling is
needed for *all* access, and Phase 1 already drops that auto key from the canonical so record access
round-trips. Phase 2 generalizes it to *user-supplied* keys.

## 2. Goals

1. **No secret ever in source or migration files** — only references.
2. **No diff churn** on opaque (redacted) keys.
3. **Explicit, safe rotation** — changing a secret is a deliberate op, never an accidental migration.
4. Keep the **secret-free forms** (`TYPE JWT URL` JWKS, public-key PEM verify, plain `TYPE RECORD`) the
   easy default — most apps only *verify* and never author a secret.

## 3. Authoring surface (driver — mine)

A secret is authored as a **reference**, resolved at apply time, never a literal:

```ts
import { defineAccess, env, secret } from "@schemic/surrealdb";

defineAccess("api").onDatabase()
  .jwt({ alg: "HS512", key: env("JWT_SECRET") })          // from process.env at apply
  .duration({ session: "12h" });

defineAccess("svc").onDatabase()
  .jwt({ alg: "RS256", key: secret("jwt/signing-key") })  // from a configured secret source
```

- `env(name)` and `secret(name)` return a `SecretRef = { kind: "env" | "secret"; name: string }`.
- `key` accepts `string | SecretRef`. A raw `string` literal stays allowed but emits a **lint warning**
  ("inline access key — prefer env()/secret()"); refs are the blessed path.
- The same `SecretRef` feeds the key-bearing clauses this unlocks (see §8).

## 4. Emit (driver) — placeholder, never the value

A `SecretRef` key emits as a **bound parameter placeholder**, not the value:

```
DEFINE ACCESS api ON DATABASE TYPE JWT ALGORITHM HS512 KEY $JWT_SECRET;
```

with an attached binding descriptor `{ JWT_SECRET: { kind: "env", name: "JWT_SECRET" } }`. The committed
migration/DDL contains **only the placeholder** — nothing secret hits git.

> **Verified (3.1.4):** SurrealDB accepts a bound `$param` in the `KEY` position —
> `DEFINE ACCESS … KEY $secret` applied with `{ secret: "…" }` works and stores the key (redacted on
> read). So the placeholder can be a real **query binding**, not string interpolation — injection-safe.

## 5. What the driver needs from core (the contract)

Two cross-cutting pieces `core-dev` owns (matching your two-piece outline):

### (a) Apply-time resolution
The runner must, at `apply`, resolve each binding descriptor (`env`/`secret`) to its value and pass it as
a **query binding** alongside the statement. Proposed shape: `emitDefStatement` (and the snapshot) carry,
per statement, an optional `bindings: Record<string, SecretRef>`; the apply runner resolves them just
before `db.query(ddl, resolvedBindings)`.
- **Open Q1:** is per-statement `bindings` on the `DefineStatement`/migration the right carrier, or do you
  prefer a side-channel? Driver fills it; core resolves it.
- Resolution sources: `env` from `process.env`; `secret` from a configurable provider (default: same env;
  pluggable for vault/file). Provider config lives in the project config — **Open Q2:** core or driver owns
  that config surface?

### (b) Write-only IR flag (redaction-aware diff)
The access key clause must be marked **`writeOnly`** in the IR so the diff **excludes it from the
structural compare**. Then:
- introspected side: key is `[REDACTED]` → dropped from canonical (already done for the auto key);
- authored side: the canonical for *comparison* also drops the key (the placeholder is not compared);
- so both sides canonicalize **without** the key → no churn. The key is (re)applied on create/overwrite but
  never *causes* a diff by itself.
- **Open Q3:** the `writeOnly` marker shape on the IR — a per-clause flag on the access kind, or a more
  general field-level marker reusable by Postgres (which has its own redacted-secret cases)?

## 6. Diff / rotation behavior

- Because the key is write-only, **changing the secret value does not trigger a migration** (the diff can't
  see it, by design).
- Rotation is therefore an **explicit op**, decoupled from the diff: `sc access rotate <name>` (or
  `apply --rotate-keys`) re-emits `DEFINE ACCESS … OVERWRITE` with the currently-resolved secret. Driver
  provides the re-emit; core owns the CLI verb. **Open Q4:** dedicated `rotate` verb vs an `apply` flag.

## 7. Secret-free defaults (no contract needed — driver can do now)

Independent of the contract, to steer users away from secrets:
- document **`.jwt({ url })`** (JWKS) and **public-key (PEM) verify** as the recommended verify path (no
  secret, fully round-trips — `url`/public key are not redacted);
- the inline-literal-key lint warning (§3).

## 8. Clauses this unlocks (Phase-2 deliverables, after the contract)

All deferred in Phase 1 precisely because they carry keys:
- `TYPE JWT … WITH ISSUER KEY @key` — a JWT access that *issues* tokens (issuer key = secret → ref).
- `RECORD WITH JWT (ALGORITHM @alg KEY @key | URL @url)` — record token config (key → ref; url is
  secret-free).
- `RECORD WITH ISSUER KEY @key` — issuer key for the record JWT (→ ref).

## 9. Suggested phasing

- **2a (contract + plumbing):** `env()`/`secret()` ref type + emit placeholder + `bindings` carrier +
  `writeOnly` diff + rotation. No new key-bearing clauses yet — proven against the existing JWT
  `ALGORITHM KEY` form and the auto record key.
- **2b (clauses):** the §8 key-bearing clauses on top, each routing its key through `SecretRef`.

## 10. Open questions (recap, for core-dev)

1. Per-statement `bindings` carrier shape (Q1).
2. Secret-provider config ownership (Q2).
3. `writeOnly` IR marker shape — driver-specific vs reusable (Q3).
4. Rotation UX — `rotate` verb vs `apply --rotate-keys` (Q4).

---

## 11. RESOLVED answers (per core-dev's leans, 2026-06-27 — **for ratification**)

core-dev ratifies/adjusts; this is the agreed shape unless flagged.

### Contract ownership (the 3 core-owned pieces)
- **(a) Apply-time resolution — CORE.** The IR carries `SecretRef` **placeholders only** (write-only,
  never the value). Each statement carries `bindings: Record<string, SecretRef>`. The **CLI/apply layer**
  resolves `env()`/`secret()` → values at apply (it owns the runtime env + provider access) and passes
  them as **query bindings** alongside the DDL (`db.query(ddl, resolved)`). Core defines `SecretRef` +
  the "apply resolves" contract; the **driver emits `KEY $param`** + populates `bindings`. *(Answers Q1:
  per-statement `bindings` carrier, not a side-channel.)*
- **(b) `writeOnly` marker — CORE, reusable.** A neutral field-level `writeOnly`/secret flag on the IR
  value: the **diff excludes it** from the structural compare (a redacted secret never churns) and the
  **snapshot omits it**. NOT surreal-specific — postgres shares it for its redacted secrets. The driver
  only *marks* which clauses are write-only. *(Answers Q3: reusable neutral marker.)*
- **(c) Rotation + provider config — CORE.** Rotation = an **`apply --rotate-keys` flag** (no new verb —
  keep the CLI small) → re-emits `DEFINE ACCESS … OVERWRITE` with the freshly-resolved secret. The
  **secret-provider config lives in core** (neutral + pluggable: env default, vault/file providers); the
  driver supplies only the dialect emit. *(Answers Q2 + Q4.)*

### One refinement to ratify: where do `env()`/`secret()` live?
Since **core owns `SecretRef`** and **both drivers need secrets**, recommend `env()`/`secret()` are
**core neutral authoring helpers** (return a `SecretRef`), **re-exported by each driver** so
`import { env, secret } from "@schemic/surrealdb"` still works (the proposal's §3 ergonomics) without
duplicating the type. (Alternative: driver-local factories returning the core `SecretRef` — also fine,
just duplicates trivia. Lean: core helpers + driver re-export.)

### Resulting split (build order = §9 phasing)
- **CORE (2a):** `SecretRef` type + `env()`/`secret()` helpers; the per-statement `bindings` carrier on
  the define-statement IR; the `writeOnly` field marker + diff-exclude + snapshot-omit; apply-time
  resolution + `--rotate-keys`; the pluggable provider config surface.
- **DRIVER / surreal (2a):** emit `KEY $param` placeholder from a `SecretRef`; populate `bindings`; mark
  the access key clause `writeOnly`; route `.jwt({ key })` through `SecretRef`; the dialect re-export.
- **DRIVER / surreal (2b):** the §8 key-bearing clauses (`WITH ISSUER KEY`, `RECORD WITH JWT`,
  `RECORD WITH ISSUER KEY`), each routing its key through `SecretRef`.

### Shipping NOW, independent of the contract (per core-dev — no secrets involved)
- `.jwt({ url })` JWKS + public-key (PEM) verify documented as the recommended **secret-free** path.
- the **inline-literal-key lint** ("inline access key — prefer `env()`/`secret()`").
