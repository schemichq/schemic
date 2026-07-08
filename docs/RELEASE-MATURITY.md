# Release maturity — alpha → beta → stable

A living checklist for graduating Schemic's release stage. Each stage is a **promise to users about
API stability and data safety**, not a feature count. Tick a box only when it's *durably* true (not
"works once"). **core-dev owns this doc** — it's cross-cutting and directly informs when a beta/stable
tag gets cut; package owners update the rows they own.

The stage promise:

- **alpha** — the shape is still moving; expect breaking changes.
- **beta** — the public surface is frozen; we're hardening, not reshaping.
- **stable (1.0)** — we commit to semver (breaking = major bump); it won't eat your data.

Current stage: **alpha** (`0.1.0-alpha.*`). The array-default write-model flip (2026-07) was a breaking
API change — textbook alpha.

---

## alpha → beta — gate: **API + Driver-contract freeze**

Graduate when you'd be embarrassed to make another breaking change.

- [ ] **Authoring surface settled** — `s.*` / `define*`, no more reshaping (types/defaults/modifiers).
- [ ] **Query-builder surface settled** — reads + writes + graph + schemaless; no more breaking flips
      (the write-model array-default flip was the last big one — hold this line now).
- [ ] **Driver contract stable** — it stops churning. Proof: a second driver reaches parity **without
      forcing core-contract changes**.
- [ ] **PostgreSQL at parity with SurrealDB** — the "the abstraction is actually dialect-neutral" proof;
      one driver can be over-fit, two validate core.
- [ ] **CLI surface settled** — commands + flags; no renames/removals expected.
- [ ] **Core loop round-trips** for the flagship driver: author → emit DDL → diff → migrate →
      introspect/pull, drift-free.
- [ ] **COVERAGE.md not gap-riddled** for common syntax on each active driver.
- [ ] **Migration safety exists** — destructive-op guards + a shadow/dry-run verify. Entry ticket to
      beta for a schema tool, not a stable-only luxury.
- [ ] **Dogfooding without walls** — the dogfood projects run without constantly hitting missing pieces.

## beta → stable (1.0) — gate: **battle-tested data safety + real users**

Mostly a hardening road, not a build road.

- [ ] **Migration engine proven on production-shaped schemas** — no corruption; destructive guards +
      rollback exercised for real. *This is the dominant risk* — everything else is secondary to
      "will it ever lose my data."
- [ ] **Coverage substantially complete** per driver (author → emit → introspect → diff across the DB's
      real surface, not the happy path).
- [ ] **External adoption + a soak period** — beta baked long enough with users who aren't us (beyond
      the dogfood repo) that the sharp edges surfaced and got filed.
- [ ] **Self-serve docs** — the docs site + migration/upgrade guides; users can learn it without us.
- [ ] **Test depth green in CI** — the repo-wide type-test suite (attest, per-expression instantiation
      budgets), e2e-vs-live, parity, and the example-cookbook goldens.
- [ ] **Upgrade story** — versioned snapshots + a path to migrate projects from older Schemic versions
      (1.0 implies we support that).
- [ ] **Semver commitment documented** — a public policy: what "breaking" means, deprecation windows.

---

## Where we are now (snapshot — keep dated)

**2026-07-08** — mid-alpha. Engine + SurrealDB are capable; the query builder is rich (graph reads,
array-default writes, bulk/upsert/relate, schemaless). Still alpha because the API is actively reshaping
and PostgreSQL isn't at parity.

The two things that most gate **beta**, in order:

1. **PostgreSQL at parity without contract changes** — the "the abstraction is real" proof.
2. **Freeze the authoring + query surface** — stop the breaking flips.
