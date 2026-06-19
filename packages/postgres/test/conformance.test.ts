import { describeDriverConformance } from "@schemic/core/testing";
import { defineTable, postgresDriver, s } from "../src/index";

// The shared driver-conformance suite: asserts @schemic/postgres satisfies the Driver contract and
// that `s` is a Zod drop-in superset (canonical builders present, carrying the right schemas, lowering
// to the portable IR).
describeDriverConformance({
  name: "postgres",
  s,
  driver: postgresDriver,
  defineEntity: defineTable,
});
