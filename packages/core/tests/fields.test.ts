import { describe } from "bun:test";
import { setupSurrealTests } from "./common";
import z from "../src";
import { testCase } from "./utils";

describe("fields", () => {
  const { defineTest } = setupSurrealTests();

  defineTest("$default()", z.date(), {
    type: "datetime",
    default: {
      value: "time::now()",
    },
    tests: [
      testCase({
        value: undefined,
        parse: undefined,
      }),
    ],
  });
});
