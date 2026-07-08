# Type-completeness & instantiation-budget testing (@ark/attest)

The shared standard for **type-level test suites** across the monorepo — core, cli, and every driver.
Two guarantees, both enforced in CI:

1. **Type completeness** — `attest<Expected, Actual>()` asserts a type utility produces *exactly* the
   type it should. A generic that silently drifts (a wrapper it stops unwrapping, a flag it drops)
   turns a suite red instead of surfacing later as a mystery inference bug at a call site.
2. **Instantiation budgets** — `bench(...).types([N, "instantiations"])` caps how many type
   instantiations a hot generic costs. A change that makes inference materially more expensive blows
   the budget and fails, guarding the `tsc` instantiation-depth / autocomplete-latency ceiling that
   heavy generic machinery (Flags, `CreateShape`, `Row`/`FieldRef`, the connection typing) runs into.

Worked reference: **`packages/core/test/types/`** (`authoring-types.test.ts` + `authoring-types.bench.ts`).

## The one rule that matters: run under node, NOT bun

attest measures instantiations and checks assertions by driving a TypeScript program and locating the
running source file **via the node call stack**. Under bun that frame reads as `native`, so attest
throws:

```
@ark/attest: TypeScript was unable to resolve expected file at native
    at getSourceFileOrThrow (.../cache/ts.js)
    at getContributedInstantiations (.../bench/type.js)
```

So type-suites run in a **separate node process with TS via `tsx`**, never `bun test`. The shared
runner `scripts/type-perf.ts` does this for you — do not run these files with `bun`.

## Layout & runner

```
<package>/test/types/
  *.assert.ts  # attest type assertions, run via node's test runner
  *.bench.ts   # instantiation budgets, each run directly (exits non-zero if over budget)
```

The `.assert.ts` suffix (not `.test.ts`) is deliberate: it keeps these files OUT of `bun test` — which
would run them under bun and hit the `native` error — while `node --test` runs them fine. `.bench.ts`
is likewise unmatched by bun. So you never have to scope your package's bun `test` script around them.

Each package wires one script (mirrors `packages/core`):

```jsonc
// package.json
"scripts": { "test:types": "bun run ../../scripts/type-perf.ts <group>/<name>" }
```

`bun run scripts/type-perf.ts` (no args) runs **every** workspace package that has a `test/types/`.
CI runs it as a **separate `type-perf` job** — deliberately OUT of the hot `land.ts` gate, because
attest's own TS program is slower and needs node/tsx.

> **Driver suites need a built core.** A driver suite imports `@schemic/core/*` as a *package*, which
> node/tsx resolves via the node condition (`lib/`), not the bun/`src` one — so `@schemic/core` (and
> any cross-imported package) must be **built** first (`bun run --filter '*' build`) or the suite
> throws `ERR_MODULE_NOT_FOUND` at runtime. A package's OWN suite imports its `src/` by relative path
> and needs no build. The CI job builds before running; build locally too when you run a driver suite.
> (attest's *type* pass still reads `src` via `customConditions: ["bun"]`, so instantiation counts stay
> src-based regardless.)

## Adding a suite to a driver

1. `bun add -d @ark/attest tsx` in your package (pin the same attest version core uses — instantiation
   counts are tied to it and to the `typescript` version).
2. Add the `test:types` script above.
3. Create `test/types/` and copy the two file shapes below.

### `*.assert.ts` — type assertions

```ts
import { after, before, describe, it } from "node:test";
import { attest, setup, teardown } from "@ark/attest";
import type { InnerOf } from "../../src/authoring";
import type * as z from "zod";

// attest needs its checker set up once per run — this 6-line block is the shared convention, copy it.
let cleanup: (() => void) | undefined;
before(() => { cleanup = setup() as unknown as () => void; });
after(() => { cleanup?.(); teardown(); });

describe("InnerOf", () => {
  it("unwraps ZodOptional", () => {
    attest<z.ZodString, InnerOf<z.ZodOptional<z.ZodString>>>();
  });
});
```

`attest<Expected, Actual>()` fails to **compile** if `Actual` isn't exactly `Expected`, and attest
re-checks it at runtime.

### `*.bench.ts` — instantiation budgets

```ts
import { bench } from "@ark/attest";
import type { InnerOf } from "../../src/authoring";
import type * as z from "zod";

bench("InnerOf unwraps one wrapper level", () => {
  return {} as InnerOf<z.ZodOptional<z.ZodString>>;
}).types([76415, "instantiations"]);
```

## Baselines

- **Measure first, then pin.** Set the budget to `[0, "instantiations"]`, run once, and copy the
  reported count. Counts are **deterministic per TypeScript version**, so they're stable across
  machines and CI.
- **The default threshold is ±20%** — small refactors stay green; a real blow-up fails.
- **Watch the DELTA, not the magnitude.** Any zod-coupled generic carries the imported type surface
  (~76k instantiations of floor cost), so absolute numbers look large; the budget's job is to catch a
  *regression* against the pinned baseline. Include one import-free generic too (see core's tuple bench)
  for a clean low-count signal.
- **Re-baseline intentionally.** When a change's added cost is known and justified, update the number
  in the same commit (run with `ATTEST_updateSnapshots=1` to rewrite, or edit by hand) — never bump a
  budget to silence a regression you haven't understood.

## What to cover

Prioritise the generics most at risk of silent drift or instantiation blow-up: the `Flags` →
create/update optionality channel, derived `.create`/`.update` shapes, the query builder's `Row`/
`FieldRef` inference and graph-traversal recursion, and the typed `connect(name, args)` resolution.
List the utility, assert its exact output, and pin a budget — so a future refactor can't quietly break
inference or 10× its cost.
