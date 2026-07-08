// TYPE-INSTANTIATION BUDGETS for core's authoring type utilities (@ark/attest `bench().types()`).
// Run under node/tsx (NOT bun — see docs/TYPE-PERF-TESTING.md): `bun run --cwd packages/core test:types`.
//
// The number is the instantiations the expression's TYPE triggers; the budget guards REGRESSION — a
// change that makes a generic materially more expensive blows the +20% threshold and fails. Absolute
// counts for zod-coupled generics include the imported type surface (~76k floor), so watch the DELTA,
// not the magnitude. Re-baseline intentionally (with `ATTEST_updateSnapshots=1`) when a change is a
// known, justified cost.
import { bench } from "@ark/attest";
import type * as z from "zod";
import type { InnerOf, SchemaOf } from "../../src/authoring";

// A pure generic with no imports — the clean end of the range (deterministic per TS version).
bench("recursive tuple reverse (pure, no imports)", () => {
  type Rev<T extends unknown[], A extends unknown[] = []> = T extends [
    infer H,
    ...infer R,
  ]
    ? Rev<R, [H, ...A]>
    : A;
  return {} as Rev<[1, 2, 3, 4, 5]>;
}).types([137, "instantiations"]);

// Real core utilities — the numbers carry zod's type surface; the budget catches a blow-up.
bench("InnerOf unwraps one wrapper level", () => {
  return {} as InnerOf<z.ZodOptional<z.ZodString>>;
}).types([76415, "instantiations"]);

bench("SchemaOf passes a raw zod schema through", () => {
  return {} as SchemaOf<z.ZodString>;
}).types([76259, "instantiations"]);
