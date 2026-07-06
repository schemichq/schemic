// The shared coverage-reconcile helper (@schemic/core/testing) — proves the PURE reconcileCoverage
// logic passes a well-formed manifest and flags each drift mode. Uses a minimal fake registry so the
// checks are exercised without a real driver.
import { describe, expect, test } from "bun:test";
import {
  type CoverageReconcileInput,
  type FeatureCoverage,
  type KindCoverage,
  reconcileCoverage,
} from "../../src/testing";

// A stand-in for KindRegistry — reconcileCoverage only calls registry.names().
function fakeRegistry(names: string[]) {
  return {
    names: () => names,
  } as unknown as CoverageReconcileInput["registry"];
}

const KINDS: KindCoverage[] = [
  { name: "table", status: "x" },
  { name: "index", status: "x" },
  { name: "view", status: "~", note: "name-only change detection" },
];

const FEATURES: FeatureCoverage[] = [
  {
    key: "table.strict",
    kind: "table",
    status: "x",
    coveredBy: "STRICT table",
  },
  {
    key: "index.unique",
    kind: "index",
    status: "x",
    coveredBy: "unique index",
  },
  { key: "view.body", kind: "view", status: "~" }, // partial: no coveredBy required
];

// Test source with the two covering titles present as REAL test() calls, plus a decoy.
const TEST_SRC = `
  test("STRICT table round-trips", () => {});
  test("unique index round-trips", () => {});
  // a comment mentioning INDEX ONLY should not count as a title
  test.skip("skipped coverage does not count", () => {});
`;

function base(): CoverageReconcileInput {
  return {
    registry: fakeRegistry(["table", "index", "view"]),
    kinds: KINDS,
    features: FEATURES,
    testSrc: TEST_SRC,
  };
}

function fail(input: CoverageReconcileInput, checkName: string): string[] {
  const r = reconcileCoverage(input);
  return (
    r.checks.find((c) => c.name === checkName)?.failures ?? ["<no such check>"]
  );
}

describe("reconcileCoverage", () => {
  test("a well-formed manifest passes every check", () => {
    expect(reconcileCoverage(base()).failures).toEqual([]);
  });

  test("a registered kind missing from the manifest fails", () => {
    const input = {
      ...base(),
      registry: fakeRegistry(["table", "index", "view", "trigger"]),
    };
    expect(fail(input, "registered kinds match the manifest")).toEqual([
      'kind "trigger" is registered but missing from the manifest',
    ]);
  });

  test("a manifest kind that isn't registered fails", () => {
    const input = { ...base(), registry: fakeRegistry(["table", "index"]) };
    expect(fail(input, "registered kinds match the manifest")).toEqual([
      'kind "view" is in the manifest but not registered',
    ]);
  });

  test("a feature pointing at an unknown kind fails", () => {
    const input = {
      ...base(),
      features: [
        ...FEATURES,
        { key: "x.y", kind: "sequence", status: " " } as FeatureCoverage,
      ],
    };
    expect(fail(input, "every feature maps to a registered kind")).toEqual([
      'feature "x.y" -> unknown kind "sequence"',
    ]);
  });

  test("an [x] feature with no coveredBy fails", () => {
    const input = {
      ...base(),
      features: [
        { key: "table.strict", kind: "table", status: "x" } as FeatureCoverage,
      ],
    };
    expect(fail(input, "every [x] feature names a covering test")[0]).toContain(
      "declares no coveredBy test",
    );
  });

  test("coveredBy matching only a comment (not a real test title) fails", () => {
    const input = {
      ...base(),
      features: [
        {
          key: "index.only",
          kind: "index",
          status: "x",
          coveredBy: "INDEX ONLY",
        } as FeatureCoverage,
      ],
    };
    expect(fail(input, "every [x] feature names a covering test")[0]).toContain(
      "no matching (non-skipped) test title",
    );
  });

  test("coveredBy matching only a skipped test fails", () => {
    const input = {
      ...base(),
      features: [
        {
          key: "cov.skip",
          kind: "table",
          status: "x",
          coveredBy: "skipped coverage does not count",
        } as FeatureCoverage,
      ],
    };
    expect(fail(input, "every [x] feature names a covering test")[0]).toContain(
      "no matching (non-skipped) test title",
    );
  });

  test("duplicate feature keys are flagged", () => {
    const dup = {
      key: "table.strict",
      kind: "table",
      status: "~",
    } as FeatureCoverage;
    const input = { ...base(), features: [...FEATURES, dup] };
    expect(fail(input, "no duplicate feature keys")).toEqual([
      'duplicate feature key "table.strict"',
    ]);
  });

  test("duplicate kind entries are flagged", () => {
    const input = {
      ...base(),
      kinds: [...KINDS, { name: "table", status: "x" } as KindCoverage],
    };
    // table now appears twice in the manifest; the dup check flags it.
    expect(fail(input, "no duplicate kind entries")).toEqual([
      'duplicate kind entry "table"',
    ]);
  });
});
