// Driver conformance — asserts the @schemic/core Driver contract (registration + IR/exec ops) and the
// Zod drop-in philosophy (s.* is a Zod superset with the canonical type set). Shared suite lives in
// @schemic/core/testing; each driver wires it to its own s / driver / defineEntity.
import {
  type DriverConformanceOptions,
  describeDriverConformance,
} from "@schemic/core/testing";
import { defineTable, s } from "@schemic/surrealdb";
import { surrealDriver } from "@schemic/surrealdb/driver";

describeDriverConformance({
  name: "surrealdb",
  // `s` is a Zod SUPERSET — it has non-function members (e.g. `s.coerce`) that don't fit the suite's
  // loose `Record<string, fn>` shape. The suite duck-types the canonical methods at runtime, so cast.
  s: s as unknown as DriverConformanceOptions["s"],
  driver: surrealDriver,
  defineEntity: defineTable,
});
