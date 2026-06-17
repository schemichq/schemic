# Option-A Flip — execution plan (retire the fixed slots)

> The final, coordinated step of core-v2 (`kind-registry.md` §8 last; `kind-registry-contract.md` §6
> stage 2). Both drivers are slice-2 parity-green behind the facade; this plan **retires the fixed
> `PortableDb` slots + the whole-DB `Driver` methods** and routes the CLI through the kind registry.
> Run ONCE, with both drivers landing together. Drafted ahead of convergence so we execute immediately.
>
> Status: DRAFT for driver sanity-check. Pre-launch → the snapshot format changes freely (no migration).

## 1. Goal & invariant

Core stops speaking `PortableDb` (fixed `tables`/`functions`/`accesses`/`natives` slots). The schema is
a flat `PortableObject[]` (open kinds); the stored snapshot is a `KindSnapshot`; every schema operation
routes through the registry spine (`lowerSchema`/`buildKindDiff`/`emitKinds`/`introspectKinds`). The
**invariant**: for the migrated drivers, the CLI's observable output (diff DDL, migrations, `pull`,
`gen`, `check`) is unchanged from today — the facade parity tests already prove the registry path equals
the fixed-slot path, so the flip is "swap the engine, keep the behavior."

## 2. The `Driver` contract after the flip

The whole-DB IR methods collapse into the registry + a few genuinely driver-level hooks. What each of
today's `Driver` members becomes:

| today (`Driver`) | after the flip |
|---|---|
| `lower(tables, defs): PortableDb` | `explode(tables, defs): Definable[]` (driver) → core `lowerSchema(registry, …)` |
| `emit(db): Statement[]` | core `emitKinds(registry, schema)` |
| `diff(prev, next): Diff` | core `buildKindDiff(registry, prev, next)` |
| `remove(stmt)` / `overwrite(stmt)` | per-kind `KindEngine.remove` / `overwrite` (gone from `Driver`) |
| `introspect(conn, exclude): PortableDb` | `introspectAll(conn, exclude): PortableObject[]` (driver, one read) → core fans per kind |
| `normalize(db)` | folded into each `KindEngine.lower` (lower already canonicalizes; introspect must too) |
| `equal(a, b)` | generic in core (per-kind emit-string / structural compare over `PortableObject[]`) |
| `upgradeSnapshot?` | **removed** (pre-launch; no legacy snapshots) |
| `connect`/`apply`/`close` | **unchanged** (connection lifecycle, driver-owned) |
| `shadow?`/`migrations?` | **unchanged** (capabilities) |
| command caps (`diffLive`/`syncPlan`/`renderSchema`/`diffTsLive`/`checkReplay`/`planPull`/`serverInfo`/`query`/`initScaffold`) | **kept**, but the ones that build/compare schema re-expressed over the registry internally |

So the post-flip `Driver` ≈ `{ name, registry: KindRegistry, explode(...): Definable[],
introspectAll(conn, exclude): PortableObject[], connect/apply/close, + capabilities }`. Core owns the
generic schema engine over `registry`; the driver owns connection, the authoring→`Definable[]` explode,
and the single-read introspection.

**`explode`** is the driver-side fan-out we already sanctioned (one inline-authored table →
`[table, ...index, ...event/constraint]`), formalized as a contract method. **`introspectAll`** is the
"one `INFO STRUCTURE`/`pg_catalog` read fanned per kind" resolution from contract §5, made a single
driver hook (cheaper than N per-kind reads); core slices its result by `kind`.

## 3. Core changes (module by module)

1. **`driver/driver.ts`** — new `Driver` shape (above). Add `registry`, `explode`, `introspectAll`;
   drop `lower`/`emit`/`diff`/`remove`/`overwrite`/`introspect`/`normalize`/`equal`/`upgradeSnapshot`.
   Provide core helpers `schemaLower(driver, tables, defs)` = `lowerSchema(driver.registry,
   driver.explode(...))` and `schemaIntrospect(driver, conn, exclude)` = group `driver.introspectAll`
   by kind, so command code calls those instead of the old methods.
2. **`cli/meta.ts`** — `StoredSnapshot.portable: PortableDb` → `kinds: KindSnapshot`. `EMPTY_STORED`,
   `readSnapshot`/`writeSnapshot` updated. Drop the v1/v2 upgrade path (pre-launch). `checksum` etc.
   unchanged.
3. **`cli/filter.ts`** — `filterPortable(db: PortableDb, …)` (iterates fixed slots) → `filterKinds(
   schema: PortableObject[], …)` filtering generically by `kind` + `name`. `mergeStored`/`intersect`
   re-expressed over `PortableObject[]`.
4. **`driver/portable-diff.ts`** — the `Statement`-level generic diff is **superseded** by
   `planKinds`/`buildKindDiff`. Retire `diffPortable`/`planPortable`/`buildDiff` (or keep as thin
   deprecated shims if any non-schema consumer remains — audit first).
5. **`driver/portable-ir.ts`** — `PortableDb` + the fixed-slot interfaces (`PortableTable`/`Function`/
   `Access`/`Native`) **retire**. `PortableField`/`PortableType` (the substrate) **stay**. Drivers keep
   their own portable object shapes (already do).
6. **`cli/*` commands** — re-route each schema touchpoint:
   - `diff` (offline + `--live` + `--ts`), `push`, `pull`, `gen`, `migrate`, `check`, `doctor`, `seed`.
   - Pattern: wherever a command did `driver.lower(...)` / `driver.emit(...)` / `driver.diff(prev,next)`
     / `driver.introspect(...)` / read-write a `PortableDb` snapshot → call the registry spine + the
     new `Driver` hooks + `KindSnapshot`.
   - The driver command-capabilities (`diffLive`/`renderSchema`/`planPull`/…) keep their signatures;
     their internals move from fixed-slot building to the registry.
7. **`index.ts`** — drop the retired `PortableDb`/`Portable*`/`diffPortable` exports; keep the kind
   registry exports + `PortableField`/`PortableType`.

## 4. Driver changes (both, landing together)

- Expose `registry` (already built), `explode(tables, defs): Definable[]` (already have it internally),
  `introspectAll(conn, exclude): PortableObject[]` (wrap existing introspect → decompose).
- **Delete the facade adapter** (`decompose`/PortableDb assembly) — no longer needed; the boundary IS
  the registry now.
- Keep `connect`/`apply`/`close`, `migrations`, `shadow`, `initScaffold`, `query`, etc.
- Re-run the full gate: unit + parity + live + e2e. The facade parity tests become direct tests of the
  live path.

## 5. Landing strategy (coordinated, green-at-the-seam)

This touches the `Driver` contract + the CLI + BOTH drivers at once — it cannot land piecemeal (the
shared CLI can't speak two contracts). So:

1. Core cuts the flip on a branch off `feat/kind-registry`; both drivers cut adaptation branches off it.
2. Core lands the contract + CLI changes with an in-core fake-driver registry (extend slice-1's test)
   driving every re-routed command path — green before any real driver.
3. Integrate driver-by-driver into the flip branch; run each driver's full gate (surreal: unit + 19
   e2e + live + parity; pg: unit + PGlite round-trips). Fix contract friction as it surfaces.
4. When both are green on the flip branch, merge to `feat/kind-registry`, then to `main`.
5. Post-flip: promote long-tail opaque kinds (pg sequence/enum/domain/view/trigger; surreal param/
   analyzer/model) to first-class, incrementally — each a `define` + parity test, no core change.

## 6. Risks & mitigations

- **Introspect canonicalization parity.** The reverse path (`introspectAll`) must yield objects that
  canonicalize identically to lowering, or every introspect phantom-diffs. This is the exact
  normalize/equal problem the multi-DB spike already solved per-driver; preserve it inside each
  `KindEngine.lower` + the driver's introspect. The facade's PGlite/live round-trip tests already guard
  it — keep them.
- **CLI breadth.** Many command paths touch `PortableDb`. Mitigate with the in-core fake-driver test
  (step 2) exercising each re-routed path before real drivers, so the contract is proven generically.
- **Big-bang coordination.** Both drivers + core must converge on one branch. Mitigate by drafting this
  now and keeping the facade parity green throughout, so each side's behavior is pinned.
- **Hidden PortableDb consumers.** Audit for any non-command consumer of `PortableDb`/`diffPortable`
  before deleting; shim only if found.

## 7. Open items to finalize at execution

- `introspectAll` signature — does `exclude` stay a `Set<string>` of table names, or generalize to a
  per-kind predicate? (Lean: keep table-name exclude; it's what the CLI passes.)
- Whether `normalize`/`equal` need any residual driver hook or are fully generic (lean: generic +
  per-kind `lower` canonicalization; confirm against surreal's INFO-STRUCTURE canonical forms).
- Exact home of the per-command re-routing helpers (a `cli/engine.ts` that wraps the spine + driver
  hooks, so commands depend on one seam).
- Confirm no migration shim is needed (pre-launch: existing `_snapshot.json` files are throwaway).

**Sanity-check requested from both drivers:** does the post-flip `Driver` shape (§2) + the `explode`/
`introspectAll` hooks cover everything your live path needs? Flag any capability that doesn't fit before
we cut the flip branch.
