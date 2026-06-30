import { expect, test } from "bun:test";
import { SFieldBase as CoreSFieldBase } from "@schemic/core/authoring";
import { s } from "../../src/index";

// DRIFT GUARD. surrealdb's `SField` can't extend core's `SFieldBase` (smart-id table covariance vs the
// erased `AnyField` — see surrealdb-sfieldbase-unification-blocked), so shared-base methods are MIRRORED
// onto our local base. This test fails LOUDLY the next time core adds a base method we haven't mirrored,
// so the surface can't silently drift the way `~standard` did. We own it (only this package imports both
// core's SFieldBase and our SField); core announces every base addition in #drivers.
test("SField mirrors every method/getter on core's SFieldBase", () => {
  const coreNames = Object.getOwnPropertyNames(CoreSFieldBase.prototype).filter(
    (n) => n !== "constructor",
  );
  // A concrete field walks the full prototype chain, so `in` catches inherited + own members.
  const field = s.string() as unknown as Record<string, unknown>;
  const missing = coreNames.filter((n) => !(n in field));
  expect({ missing }).toEqual({ missing: [] });
});
