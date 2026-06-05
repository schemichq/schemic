import { describe, expect, expectTypeOf, test } from "bun:test";
import z from "../src/index";
import { setupSurrealTests } from "./common";
import { issue, issues, testCase } from "./utils";
import {
  DateTime,
  Duration,
  RecordId,
  StringRecordId,
  Uuid,
  type RecordIdValue,
} from "surrealdb";

describe("zod", () => {
  const { defineTest } = setupSurrealTests();

  defineTest("string", z.string(), {
    type: "string",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({
        value: 12345,
        parse: {
          error: issues([issue.invalid_type("string")]),
        },
        error: /expected `string` but found `12345`/i,
      }),
      testCase({
        value: true,
        parse: {
          error: issues([issue.invalid_type("string")]),
        },
        error: /expected `string` but found `true`/i,
      }),
      testCase({
        value: null,
        parse: {
          error: issues([issue.invalid_type("string")]),
        },
        error: /expected `string` but found `null`/i,
      }),
      testCase({
        value: undefined,
        parse: {
          error: issues([issue.invalid_type("string")]),
        },
        error: /expected `string` but found `none`/i,
      }),
    ],
  });

  // // @original
  // describe("iso", () => {
  //   defineTest("date", z.iso.date(), {
  //     type: "string",
  //     tests: [
  //       testCase({
  //         value: "2025-01-01",
  //         parse: { data: "2025-01-01" },
  //       }),
  //       testCase({
  //         value: "2025-01-01T00:00:00.000Z",
  //         parse: { error: issues([issue.invalid_format("date")]) },
  //       }),
  //     ],
  //   });

  //   defineTest("dateTime", z.iso.datetime(), {
  //     type: "string",
  //     tests: [
  //       testCase({
  //         value: "2025-01-01T00:00:00.000Z",
  //         parse: { data: "2025-01-01T00:00:00.000Z" },
  //       }),
  //       testCase({
  //         value: "2025-01-01",
  //         parse: { error: issues([issue.invalid_format("datetime")]) },
  //       }),
  //     ],
  //   });

  //   defineTest("duration", z.iso.duration(), {
  //     type: "string",
  //     tests: [
  //       testCase({ value: "P1Y", parse: { data: "P1Y" } }),
  //       testCase({ value: "P1M", parse: { data: "P1M" } }),
  //       testCase({ value: "P1D", parse: { data: "P1D" } }),
  //       testCase({ value: "PT1H", parse: { data: "PT1H" } }),
  //       testCase({ value: "PT1M", parse: { data: "PT1M" } }),
  //       testCase({ value: "PT1S", parse: { data: "PT1S" } }),
  //       testCase({ value: "P1DT2H3M4S", parse: { data: "P1DT2H3M4S" } }),
  //       testCase({
  //         value: "1d2h3m4s",
  //         parse: { error: issues([issue.invalid_format("duration")]) },
  //       }),
  //     ],
  //   });

  //   defineTest("time", z.iso.time(), {
  //     type: "string",
  //     tests: [
  //       testCase({
  //         value: "00:00:00.000",
  //         parse: { data: "00:00:00.000" },
  //       }),
  //       testCase({
  //         value: "00:00:00",
  //         parse: { data: "00:00:00" },
  //       }),
  //       testCase({
  //         value: "00:00",
  //         parse: { data: "00:00" },
  //       }),
  //       testCase({
  //         value: "00",
  //         parse: { error: issues([issue.invalid_format("time")]) },
  //       }),
  //       testCase({
  //         value: "00:00:00.000Z",
  //         parse: { error: issues([issue.invalid_format("time")]) },
  //       }),
  //     ],
  //   });
  // });

  defineTest("email", z.email(), {
    type: "string",
    tests: [
      testCase({
        value: "manuel@msanchez.dev",
        parse: { data: "manuel@msanchez.dev" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("email")]),
        },
      }),
    ],
  });

  defineTest("guid", z.guid(), {
    type: "string",
    tests: [
      testCase({
        value: "123e4567-e89b-42d3-a456-426614174000",
        parse: { data: "123e4567-e89b-42d3-a456-426614174000" },
      }),
      testCase({
        value: new Uuid("123e4567-e89b-42d3-a456-426614174000"),
        parse: { data: "123e4567-e89b-42d3-a456-426614174000" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("guid")]),
        },
        // error: /expected `uuid` but found `''`/i,
      }),
    ],
  });

  defineTest("uuid", z.uuid(), {
    type: "string",
    tests: [
      testCase({
        value: "123e4567-e89b-42d3-a456-426614174000",
        parse: { data: "123e4567-e89b-42d3-a456-426614174000" },
      }),
      testCase({
        value: new Uuid("123e4567-e89b-42d3-a456-426614174000"),
        parse: { data: "123e4567-e89b-42d3-a456-426614174000" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("uuid")]),
        },
        // TODO: Use surreal uuid type instead
        // error: /expected `uuid` but found `''`/i,
      }),
    ],
  });

  defineTest("uuidv4", z.uuidv4(), {
    type: "string",
    tests: [
      testCase({
        value: "35a7ed3b-ac21-4c7f-8596-73610200deab",
        parse: { data: "35a7ed3b-ac21-4c7f-8596-73610200deab" },
      }),
      testCase({
        value: new Uuid("35a7ed3b-ac21-4c7f-8596-73610200deab"),
        parse: { data: "35a7ed3b-ac21-4c7f-8596-73610200deab" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("uuid")]),
        },
        // TODO: Use surreal uuid type instead
        // error: /expected `uuid` but found `''`/i,
      }),
    ],
  });

  defineTest("uuidv6", z.uuidv6(), {
    type: "string",
    tests: [
      testCase({
        value: "1f0d507c-0afa-67f0-a264-115e8c51f2e4",
        parse: { data: "1f0d507c-0afa-67f0-a264-115e8c51f2e4" },
      }),
      testCase({
        value: new Uuid("1f0d507c-0afa-67f0-a264-115e8c51f2e4"),
        parse: { data: "1f0d507c-0afa-67f0-a264-115e8c51f2e4" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("uuid")]),
        },
        // TODO: Use surreal uuid type instead
        // error: /expected `uuid` but found `''`/i,
      }),
    ],
  });

  defineTest("uuidv7", z.uuidv7(), {
    // TODO: Use surreal uuid type instead
    type: "string",
    tests: [
      testCase({
        value: "019b036b-980f-701e-8fef-6570a0d9a371",
        parse: { data: "019b036b-980f-701e-8fef-6570a0d9a371" },
      }),
      testCase({
        value: new Uuid("019b036b-980f-701e-8fef-6570a0d9a371"),
        parse: { data: "019b036b-980f-701e-8fef-6570a0d9a371" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("uuid")]),
        },
        // TODO: Use surreal uuid type instead
        // error: /expected `uuid` but found `''`/i,
      }),
    ],
  });

  // TODO: DB Validation?
  // TODO: Normalization?
  defineTest("url", z.url(), {
    type: "string",
    tests: [
      testCase({
        value: "https://www.google.com",
        parse: { data: "https://www.google.com" },
      }),
      testCase({
        value: "ftp://www.google.com",
        parse: { data: "ftp://www.google.com" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("url")]),
        },
      }),
    ],
  });

  defineTest("number", z.number(), {
    type: "number",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({ value: 123.456, parse: { data: 123.456 } }),
      testCase({ value: -123.456, parse: { data: -123.456 } }),
      testCase({ value: Math.E, parse: { data: Math.E } }),
      testCase({ value: Math.PI, parse: { data: Math.PI } }),
      testCase({ value: Math.LN2, parse: { data: Math.LN2 } }),
      testCase({ value: Math.LN10, parse: { data: Math.LN10 } }),
      testCase({ value: Math.LOG2E, parse: { data: Math.LOG2E } }),
      testCase({ value: Math.LOG10E, parse: { data: Math.LOG10E } }),
      testCase({ value: Math.SQRT1_2, parse: { data: Math.SQRT1_2 } }),
      testCase({ value: Math.SQRT2, parse: { data: Math.SQRT2 } }),
      testCase({
        value: Number.MAX_SAFE_INTEGER,
        parse: { data: Number.MAX_SAFE_INTEGER },
      }),
      testCase({
        value: Number.MIN_SAFE_INTEGER,
        parse: { data: Number.MIN_SAFE_INTEGER },
      }),
      // NOTE: SurrealDB.js throws: Number too big to be encoded
      // testCase({
      //   value: Number.MAX_VALUE,
      //   parse: { data: Number.MAX_VALUE },
      // }),
      testCase({
        value: Number.MIN_VALUE,
        parse: { data: Number.MIN_VALUE },
      }),
      testCase({
        value: "123",
        parse: {
          error: issues([issue.invalid_type("number")]),
        },
        error: /expected `number` but found `'123'`/i,
      }),
      testCase({
        value: true,
        parse: {
          error: issues([issue.invalid_type("number")]),
        },
        error: /expected `number` but found `true`/i,
      }),
      testCase({ value: null, error: /expected `number` but found `null`/i }),
    ],
  });

  defineTest("int", z.int(), {
    type: "int",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({
        value: 123.456,
        parse: {
          error: issues([issue.invalid_type("int")]),
        },
        error: /expected `int` but found `123.456f`/i,
      }),
      testCase({
        value: -123.456,
        parse: { error: issues([issue.invalid_type("int")]) },
        error: /expected `int` but found `-123.456f`/i,
      }),
      testCase({
        value: Number.MAX_SAFE_INTEGER,
        parse: { data: Number.MAX_SAFE_INTEGER },
      }),
      testCase({
        value: Number.MIN_SAFE_INTEGER,
        parse: { data: Number.MIN_SAFE_INTEGER },
      }),
      testCase({
        value: Number.MAX_SAFE_INTEGER + 1,
        parse: { error: issues([issue.too_big(Number.MAX_SAFE_INTEGER)]) },
        // FIXME: SurrealDB should error instead but passes as surrealdb's number
        // supports any size
        // error: /expected `int` but found `Number.MAX_SAFE_INTEGER + 1`/i,
      }),
      testCase({
        value: Number.MIN_SAFE_INTEGER - 1,
        parse: { error: issues([issue.too_small(Number.MIN_SAFE_INTEGER)]) },
        // FIXME: SurrealDB should error instead but passes as surrealdb's number
        // supports any size
        // error: /expected `int` but found `Number.MIN_SAFE_INTEGER - 1`/i,
      }),
    ],
  });

  defineTest("float32", z.float32(), {
    type: "float",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({ value: 123.456, parse: { data: 123.456 } }),
      testCase({ value: -123.456, parse: { data: -123.456 } }),
      testCase({
        value: Number.MAX_SAFE_INTEGER,
        parse: { data: Number.MAX_SAFE_INTEGER },
      }),
      testCase({
        value: Number.MIN_SAFE_INTEGER,
        parse: { data: Number.MIN_SAFE_INTEGER },
      }),
      // testCase({
      //   value: Number.MIN_SAFE_INTEGER - 1,
      //   parse: { error: issues([issue.too_small(Number.MIN_SAFE_INTEGER)]) },
      // }),
    ],
  });

  // TODO: Test saturation/overflow
  defineTest("float64", z.float64(), {
    type: "float",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({ value: 123.456, parse: { data: 123.456 } }),
      testCase({ value: -123.456, parse: { data: -123.456 } }),
      testCase({
        value: Number.MAX_SAFE_INTEGER,
        parse: { data: Number.MAX_SAFE_INTEGER },
      }),
      testCase({
        value: Number.MIN_SAFE_INTEGER,
        parse: { data: Number.MIN_SAFE_INTEGER },
      }),
    ],
  });

  // TODO: DB Validation?
  defineTest("int32", z.int32(), {
    type: "int",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({
        value: Number((1n << 31n) - 1n),
        parse: { data: Number((1n << 31n) - 1n) },
      }),
      testCase({
        value: Number(1n << 31n),
        parse: { error: issues([issue.too_big(Number((1n << 31n) - 1n))]) },
      }),
      testCase({
        value: Number(-1n << 31n),
        parse: { data: Number(-1n << 31n) },
      }),
      testCase({
        value: Number((-1n << 31n) - 1n),
        parse: { error: issues([issue.too_small(Number(-1n << 31n))]) },
      }),
    ],
  });

  // TODO: DB Validation?
  defineTest("uint32", z.uint32(), {
    type: "int",
    tests: [
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({
        value: Number((1n << 32n) - 1n),
        parse: { data: Number((1n << 32n) - 1n) },
      }),
      testCase({
        value: Number(1n << 32n),
        parse: { error: issues([issue.too_big(Number((1n << 32n) - 1n))]) },
      }),
      testCase({
        value: -1,
        parse: { error: issues([issue.too_small(0)]) },
      }),
    ],
  });

  defineTest("boolean", z.boolean(), {
    type: "bool",
    tests: [
      testCase({ value: true, parse: { data: true } }),
      testCase({ value: false, parse: { data: false } }),
      testCase({
        value: 123,
        parse: { error: issues([issue.invalid_type("boolean")]) },
        error: /expected `bool` but found `123`/i,
      }),
    ],
  });

  defineTest("bigint", z.bigint(), {
    type: "int",
    tests: [
      testCase({
        value: 123n,
        parse: { data: 123n },
        // @ts-expect-error - surrealdb returns number or bigint depending on the value
        equals: 123,
      }),
      testCase({
        value: 123,
        parse: {
          error: issues([issue.invalid_type("bigint")]),
        },
        equals: 123,
      }),
      testCase({
        value: "Hello World",
        error: /expected `int` but found `'Hello World'`/i,
      }),
      testCase({ value: true, error: /expected `int` but found `true`/i }),
      testCase({ value: null, error: /expected `int` but found `null`/i }),
      testCase({
        value: undefined,
        error: /expected `int` but found `none`/i,
      }),
    ],
  });

  defineTest("int64", z.int64(), {
    type: "int",
    tests: [
      testCase({
        value: (1n << 63n) - 1n,
        parse: { data: (1n << 63n) - 1n },
      }),
      testCase({
        value: 9223372036854775808n,
        parse: {
          error: issues([issue.too_big(9223372036854775807n)]),
        },
        // BUG_REPORT: SurrealDB overflows and starts counting from negative.
        // This will break if they fix it.
        equals: -9223372036854775808n,
      }),
    ],
  });

  // TODO: May needs patching to work with SurrealDB. As surrealdb doesnt support unsigned int.
  // An option would be to use decimal but that may break something on the db side if user is not aware.
  defineTest("uint64", z.uint64(), {
    type: "int",
    tests: [
      testCase({
        value: (1n << 64n) - 1n,
        parse: { data: (1n << 64n) - 1n },
        // NOTE: SurrealDB doesnt support unsigned int so it just overflows.
        // We will accept this for now.
        // @ts-expect-error ignore bigint to number conversion
        equals: -1,
      }),
      // testCase({
      //   value: 9223372036854775808n,
      //   parse: {
      //     error: issues([issue.too_big(9223372036854775807n)]),
      //   },
      //   // BUG_REPORT: SurrealDB overflows and starts counting from negative.
      //   // This will break if they fix it.
      //   equals: -9223372036854775808n,
      // }),
    ],
  });

  defineTest("symbol", z.symbol(), {
    error: /Symbol type cannot be used as a field type/i,
  });

  defineTest("undefined", z.undefined(), {
    type: "none",
    tests: [
      testCase({ value: undefined }),
      testCase({ value: null, error: /expected `none` but found `null`/i }),
      testCase({ value: 123, error: /expected `none` but found `123`/i }),
      testCase({ value: true, error: /expected `none` but found `true`/i }),
      testCase({ value: false, error: /expected `none` but found `false`/i }),
      testCase({ value: [], error: /expected `none` but found `\[\]`/i }),
      testCase({ value: {}, error: /expected `none` but found `{\s+}`/i }),
    ],
  });

  const anyTests = [
    testCase({ value: "Hello World" }),
    testCase({ value: 12345 }),
    testCase({ value: true }),
    testCase({ value: false }),
    testCase({ value: null }),
    testCase({ value: undefined }),
    testCase({ value: [] }),
    testCase({ value: {} }),
  ];

  defineTest("any", z.any(), {
    type: "any",
    tests: anyTests,
  });

  defineTest("unknown", z.unknown(), {
    type: "any",
    tests: anyTests,
  });

  defineTest("never", z.never(), {
    type: "none",
    tests: [
      testCase({
        value: undefined,
      }),
      testCase({
        value: "Hello World",
        error: /expected `none` but found `'Hello World'`/i,
      }),
      testCase({
        value: 12345,
        error: /expected `none` but found `12345`/i,
      }),
      testCase({
        value: true,
        error: /expected `none` but found `true`/i,
      }),
      testCase({
        value: false,
        error: /expected `none` but found `false`/i,
      }),
      testCase({
        value: null,
        error: /expected `none` but found `NULL`/i,
      }),
      testCase({
        value: [],
        error: /expected `none` but found `\[\]`/i,
      }),
      testCase({
        value: {},
        error: /expected `none` but found `{\s+}`/i,
      }),
    ],
  });

  // @original
  defineTest("void", z.void(), {
    type: "none",
    tests: [
      testCase({
        value: undefined,
      }),
      testCase({
        value: "Hello World",
        error: /expected `none` but found `'Hello World'`/i,
      }),
      testCase({
        value: 12345,
        error: /expected `none` but found `12345`/i,
      }),
      testCase({
        value: true,
        error: /expected `none` but found `true`/i,
      }),
      testCase({
        value: false,
        error: /expected `none` but found `false`/i,
      }),
      testCase({
        value: null,
        error: /expected `none` but found `NULL`/i,
      }),
      testCase({
        value: [],
        error: /expected `none` but found `\[\]`/i,
      }),
      testCase({
        value: {},
        error: /expected `none` but found `{\s+}`/i,
      }),
    ],
  });

  defineTest("null", z.null(), {
    type: "null",
    tests: [
      testCase({ value: null, parse: { data: null } }),
      testCase({
        value: undefined,
        parse: { error: issues([issue.invalid_type("null")]) },
        error: /expected `null` but found `none`/i,
      }),
    ],
  });

  defineTest("date", z.date(), {
    type: "datetime",
    tests: [
      testCase({
        value: new Date("2025-01-01T00:00:00.000Z"),
        parse: { data: new Date("2025-01-01T00:00:00.000Z") },
        // @ts-expect-error - surrealdb does type conversion from date to datetime
        // this might be troublesome, needs overriding
        equals: new DateTime("2025-01-01T00:00:00.000Z"),
      }),
      testCase({
        value: new DateTime("2025-01-01T00:00:00.000Z"),
        parse: { data: new Date("2025-01-01T00:00:00.000Z") },
        // @ts-expect-error - surrealdb does type conversion from date to datetime
        // this might be troublesome, needs overriding
        equals: new DateTime("2025-01-01T00:00:00.000Z"),
      }),
    ],
  });

  describe("array", () => {
    defineTest("array<any>", z.array(z.any()), {
      type: "array",
      tests: [
        testCase({
          value: ["Hello World", 12345, true, false, null, undefined],
          parse: { data: ["Hello World", 12345, true, false, null, undefined] },
        }),
      ],
    });
    defineTest("array<string>", z.array(z.string()), {
      type: "array<string>",
      tests: [testCase({ value: ["Hello World", "Hello", "World"] })],
    });
    defineTest("array<number>", z.array(z.number()), {
      type: "array<number>",
      tests: [testCase({ value: [1, 2, 3] })],
    });
    defineTest("array<boolean>", z.array(z.boolean()), {
      type: "array<bool>",
      tests: [
        testCase({ value: [true, false] }),
        testCase({
          value: [1, 2, 3],
          error: /expected `bool` but found `1`/i,
        }),
      ],
    });
  });

  // // @original
  // defineTest(
  //   "keyof { name: string, age: number }",
  //   z.keyof(z.object({ name: z.string(), age: z.number() })),
  //   {
  //     type: '"name" | "age"',
  //     tests: [
  //       testCase({ value: "name" }),
  //       testCase({ value: "age" }),
  //       testCase({
  //         value: "unknown",
  //         error: /expected `'name' | 'age'` but found `'unknown'`/i,
  //       }),
  //     ],
  //   },
  // );

  // @original
  defineTest(
    "object { name: string, age: number }",
    z.object({ name: z.string(), age: z.number() }),
    {
      type: "object",
      children: [
        { name: "name", type: "string" },
        { name: "age", type: "number" },
      ],
      tests: [
        testCase({ value: { name: "John Doe", age: 17 } }),
        testCase({
          value: {
            name: "John Doe",
            age: 17,
            meta: { created: new Date("2025-01-01T00:00:00.000Z") },
          },
          equals: {
            name: "John Doe",
            age: 17,
            meta: { created: new DateTime("2025-01-01T00:00:00.000Z") },
          },
          // @FIXME should error, but we dont know how to make objects strict
          // current syntax with object literal doesnt work properly
          // error:
          //   /but found .*? meta: \{ created: d'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,})?Z' \}/i,
        }),
      ],
    },
  );

  defineTest(
    "strict object { name: string, age: number | none }",
    z.strictObject({ name: z.string(), age: z.number().optional() }),
    {
      type: "object",
      children: [
        { name: "name", type: "string" },
        { name: "age", type: "number | none" },
      ],
      tests: [
        testCase({ value: { name: "John Doe", age: 17 } }),
        testCase({
          value: {
            name: "John Doe",
            age: 17,
            meta: { created: new Date("2025-01-01T00:00:00.000Z") },
          },
          parse: {
            error: issues([issue.unrecognized_keys(["meta"])]),
          },
          equals: {
            name: "John Doe",
            age: 17,
            meta: { created: new DateTime("2025-01-01T00:00:00.000Z") },
          },
          // @FIXME should error, but we dont know how to make objects strict
          // current syntax with object literal doesnt work properly
          // error:
          //   /but found .*? meta: \{ created: d'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,})?Z' \}/i,
        }),
      ],
    },
  );

  defineTest(
    "loose object { name: string, age: number }",
    z.looseObject({ name: z.string(), age: z.number() }),
    {
      type: "object",
      children: [
        { name: "name", type: "string" },
        { name: "age", type: "number" },
      ],
      tests: [
        testCase({ value: { name: "John Doe", age: 17 } }),
        testCase({
          value: {
            name: "John Doe",
            age: 17,
            meta: { created: new Date("2025-01-01T00:00:00.000Z") },
          },
          parse: {
            data: {
              name: "John Doe",
              age: 17,
              meta: { created: new Date("2025-01-01T00:00:00.000Z") },
            },
          },
          equals: {
            name: "John Doe",
            age: 17,
            meta: { created: new DateTime("2025-01-01T00:00:00.000Z") },
          },
        }),
      ],
    },
  );

  describe("union", () => {
    defineTest("string | number", z.union([z.string(), z.number()]), {
      type: "string | number",
      tests: [testCase({ value: "Hello World" }), testCase({ value: 12345 })],
    });

    defineTest(
      "string | number | boolean",
      z.union([z.string(), z.number(), z.boolean()]),
      {
        type: "string | number | bool",
        tests: [
          testCase({ value: "Hello World" }),
          testCase({ value: 12345 }),
          testCase({ value: true }),
        ],
      },
    );

    defineTest("string | undefined", z.string().optional(), {
      type: "string | none",
      tests: [
        testCase({ value: "Hello World" }),
        testCase({ value: undefined }),
      ],
    });

    defineTest("string | null", z.string().nullable(), {
      type: "string | null",
      tests: [testCase({ value: "Hello World" }), testCase({ value: null })],
    });

    defineTest("string | null | undefined", z.string().nullish(), {
      type: "string | null | none",
      tests: [
        testCase({ value: "Hello World" }),
        testCase({ value: null }),
        testCase({ value: undefined }),
      ],
    });

    // REVISIT when we have a clear way to handle discriminated unions
    // may require database side checks
    // defineTest(
    //   "{ type: 'number', value: number } | { type: 'string', value: string }",
    //   z.discriminatedUnion("type", [
    //     z.object({ type: z.literal("number"), value: z.number() }),
    //     z.object({ type: z.literal("string"), value: z.string() }),
    //   ]),
    //   {
    //     type: "{ type: 'number', value: number } | { type: 'string', value: string }",
    //     tests: [
    //       testCase({ value: { type: "number", value: 12345 } }),
    //       testCase({ value: { type: "string", value: "Hello World" } }),
    //     ],
    //   },
    // );
  });

  describe("intersection", () => {
    defineTest(
      // TODO: After finding a way to handle intersections
      "(string | number) & (string | boolean)",
      z.intersection(z.string().or(z.number()), z.string().or(z.boolean())),
      {
        // TODO: After finding a way to handle intersections
        // type: "string | number | bool",
        type: "any",
        tests: [
          testCase({ value: "Hello World", parse: { data: "Hello World" } }),
          testCase({
            value: 12345,
            parse: {
              error: issues([
                issue.invalid_union(
                  [issue.invalid_type("string")],
                  [issue.invalid_type("boolean")],
                ),
              ]),
            },
          }),
          // testCase({
          //   value: true,
          //   parse: { error: issues([issue.invalid_type("number")]) },
          // }),
        ],
      },
    );
    // defineTest("{ name: string, age: number } & { name: string, age: number | none }", z.intersection([z.string(), z.number(), z.boolean()]), {
    //   type: "string & number & bool",
    //   tests: [testCase({ value: "Hello World" }), testCase({ value: 12345 }), testCase({ value: true })],
    // });
    // defineTest("string & undefined", z.string().optional(), {
    //   type: "string & none",
    //   tests: [testCase({ value: "Hello World" }), testCase({ value: undefined })],
    // });
  });

  describe("tuple", () => {
    defineTest("[any]", z.tuple([z.any()]), {
      type: "[any]",
      tests: [
        testCase({
          value: ["Hello World"],
          parse: { data: ["Hello World"] },
        }),
        testCase({
          value: [12345],
          parse: { data: [12345] },
        }),
      ],
    });

    defineTest("[string, number]", z.tuple([z.string(), z.number()]), {
      type: "[string, number]",
      tests: [
        testCase({
          value: ["Hello World", 12345],
          parse: { data: ["Hello World", 12345] },
        }),
        testCase({
          value: [12345, "Hello World"],
          parse: {
            error: issues([
              issue.invalid_type("string"),
              issue.invalid_type("number"),
            ]),
          },
          error:
            /expected `\[string, number\]` but found `\[12345, 'Hello World'\]`/i,
        }),
      ],
    });

    // TODO: Tuples with rest elements are not supported yet
    defineTest("[string, ...number]", z.tuple([z.string()]).rest(z.number()), {
      type: "array",
      tests: [testCase({ value: ["Hello World", 12345] })],
    });
  });

  // // @original
  // describe("record", () => {
  //   defineTest(
  //     `record<"2025-01" | "2025-02" | "2025-03" | "2025-04", number>`,
  //     z.record(
  //       z.enum(["2025-01", "2025-02", "2025-03", "2025-04"]),
  //       z.number(),
  //     ),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       tests: [
  //         testCase({
  //           value: {
  //             "2025-01": 100,
  //             "2025-02": 88,
  //             "2025-03": 99,
  //             "2025-04": 60,
  //           },
  //           parse: {
  //             data: {
  //               "2025-01": 100,
  //               "2025-02": 88,
  //               "2025-03": 99,
  //               "2025-04": 60,
  //             },
  //           },
  //         }),
  //       ],
  //     },
  //   );
  //   defineTest("record<string, number>", z.record(z.string(), z.number()), {
  //     type: "object",
  //     children: [{ name: "*", type: "number" }],
  //     tests: [
  //       testCase({
  //         value: {
  //           "2025-01": 100,
  //           "2025-02": 88,
  //           "2025-03": 99,
  //           "2025-04": 60,
  //         },
  //         parse: {
  //           data: {
  //             "2025-01": 100,
  //             "2025-02": 88,
  //             "2025-03": 99,
  //             "2025-04": 60,
  //           },
  //         },
  //       }),
  //       testCase({
  //         value: {
  //           "2025-01": "100",
  //           "2025-02": "88",
  //           "2025-03": "99",
  //           "2025-04": "60",
  //         },
  //         parse: {
  //           error: issues([issue.invalid_type("number")]),
  //         },
  //         error: /expected `number` but found `'100'`/i,
  //       }),
  //     ],
  //   });
  //   defineTest(
  //     "record<number, number>",
  //     z.record(z.coerce.number(), z.number()),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       tests: [
  //         testCase({
  //           value: { 1: 100, 2: 88, 3: 99, 4: 60 },
  //           parse: {
  //             data: { 1: 100, 2: 88, 3: 99, 4: 60 },
  //           },
  //         }),
  //       ],
  //     },
  //   );
  // });

  // // @original
  // describe("partial record", () => {
  //   defineTest(
  //     `partial record<"2025-01" | "2025-02" | "2025-03" | "2025-04", number>`,
  //     z.partialRecord(
  //       z.enum(["2025-01", "2025-02", "2025-03", "2025-04"]),
  //       z.number(),
  //     ),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       tests: [
  //         testCase({
  //           value: {
  //             "2025-01": 100,
  //             "2025-02": 88,
  //             "2025-03": 99,
  //           },
  //           parse: {
  //             data: {
  //               "2025-01": 100,
  //               "2025-02": 88,
  //               "2025-03": 99,
  //             },
  //           },
  //         }),
  //       ],
  //     },
  //   );

  //   defineTest(
  //     "partial record<string, number>",
  //     z.partialRecord(z.string(), z.number()),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       tests: [
  //         testCase({
  //           value: {
  //             "2025-01": 100,
  //             "2025-02": 88,
  //             "2025-03": 99,
  //           },
  //           parse: {
  //             data: {
  //               "2025-01": 100,
  //               "2025-02": 88,
  //               "2025-03": 99,
  //             },
  //           },
  //         }),
  //       ],
  //     },
  //   );
  //   defineTest(
  //     "partial record<number, number>",
  //     z.partialRecord(z.coerce.number(), z.number()),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       tests: [
  //         testCase({
  //           value: { 1: 100, 2: 88, 3: 99 },
  //           parse: {
  //             data: { 1: 100, 2: 88, 3: 99 },
  //           },
  //         }),
  //       ],
  //     },
  //   );
  // });

  // // @original
  // describe("map", () => {
  //   defineTest("map<string, number>", z.map(z.string(), z.number()), {
  //     type: "object",
  //     children: [{ name: "*", type: "number" }],
  //     tests: [
  //       testCase({
  //         value: new Map([
  //           ["Hello World", 100],
  //           ["Hello World 2", 88],
  //           ["Hello World 3", 99],
  //         ]),
  //         equals: {
  //           "Hello World": 100,
  //           "Hello World 2": 88,
  //           "Hello World 3": 99,
  //         },
  //       }),
  //     ],
  //   });
  //   defineTest("map<number, number>", z.map(z.number(), z.number()), {
  //     type: "object",
  //     children: [{ name: "*", type: "number" }],
  //     tests: [
  //       testCase({
  //         value: new Map([
  //           ["1", 100],
  //           ["2", 88],
  //           ["3", 99],
  //         ]),
  //         equals: {
  //           1: 100,
  //           2: 88,
  //           3: 99,
  //         },
  //       }),
  //     ],
  //   });
  //   defineTest(
  //     "map<{ user_id: number }, number>",
  //     z.map(z.object({ user_id: z.number() }), z.number()),
  //     {
  //       type: "object",
  //       children: [{ name: "*", type: "number" }],
  //       error: /Unsupported key type: object/i,
  //     },
  //   );
  // });

  // FIXME: They are currently buggy in SurrealDB, lets use arrays for now
  describe("set", () => {
    defineTest("set<string>", z.set(z.string()), {
      type: "array<string>",
      tests: [
        testCase({
          value: [
            ...new Set(["Hello World", "Hello World 2", "Hello World 3"]),
          ],
          // parse: {
          //   data: new Set(["Hello World", "Hello World 2", "Hello World 3"]),
          // },
        }),
      ],
    });
  });

  describe("enum", () => {
    defineTest(
      "'active' | 'inactive' | 'pending'",
      z.enum(["active", "inactive", "pending"]),
      {
        type: `"active" | "inactive" | "pending"`,
        tests: [
          testCase({ value: "active" }),
          testCase({ value: "inactive" }),
          testCase({ value: "pending" }),
          testCase({
            value: "unknown",
            parse: {
              error: issues([
                issue.invalid_value(["active", "inactive", "pending"]),
              ]),
            },
            error:
              /expected `'active' | 'inactive' | 'pending'` but found `'unknown'`/i,
          }),
        ],
      },
    );
  });

  describe("nativeEnum", () => {
    defineTest(
      "nativeEnum<'active' | 'inactive' | 'pending'>",
      z.nativeEnum({
        active: "active",
        inactive: "inactive",
        pending: "pending",
      }),
      {
        type: `"active" | "inactive" | "pending"`,
        tests: [
          testCase({ value: "active" }),
          testCase({ value: "inactive" }),
          testCase({ value: "pending" }),
        ],
      },
    );
  });

  describe("literal", () => {
    defineTest("'active'>", z.literal("active"), {
      type: `"active"`,
      tests: [
        testCase({ value: "active", parse: { data: "active" } }),
        testCase({
          value: "inactive",
          parse: { error: issues([issue.invalid_value(["active"])]) },
          error: /expected `'active'` but found `'inactive'`/i,
        }),
      ],
    });

    defineTest(
      "'active' | 'inactive' | 'pending'>",
      z.literal(["active", "inactive", "pending"]),
      {
        type: `"active" | "inactive" | "pending"`,
        tests: [
          testCase({ value: "active", parse: { data: "active" } }),
          testCase({ value: "inactive", parse: { data: "inactive" } }),
          testCase({ value: "pending", parse: { data: "pending" } }),
          testCase({
            value: "unknown",
            parse: {
              error: issues([
                issue.invalid_value(["active", "inactive", "pending"]),
              ]),
            },
            error:
              /expected `'active' | 'inactive' | 'pending'` but found `'unknown'`/i,
          }),
        ],
      },
    );
  });

  defineTest("file", z.file(), {
    error: /File type cannot be used as a field type/i,
  });

  defineTest(
    "transform",
    z.transform((value: string) => value.toUpperCase()),
    {
      type: "any",
    },
  );

  defineTest("optional", z.optional(z.string()), {
    type: "string | none",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: undefined, parse: { data: undefined } }),
    ],
  });

  defineTest("nullable", z.nullable(z.string()), {
    type: "string | null",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: null, parse: { data: null } }),
    ],
  });

  defineTest("nullish", z.nullish(z.string()), {
    type: "string | null | none",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: null, parse: { data: null } }),
      testCase({ value: undefined, parse: { data: undefined } }),
    ],
  });

  defineTest("default", z._default(z.string(), "Hello World"), {
    type: "string",
    tests: [
      testCase({
        value: "Hello World",
        parse: { data: "Hello World" },
      }),
      testCase({
        value: "Hello World 2",
        parse: { data: "Hello World 2" },
      }),
    ],
  });

  defineTest("prefault", z.prefault(z.string(), "Hello World"), {
    type: "string",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: "Hello World 2", parse: { data: "Hello World 2" } }),
    ],
  });

  defineTest("nonoptional", z.nonoptional(z.string()), {
    type: "string",
    tests: [testCase({ value: "Hello World", parse: { data: "Hello World" } })],
  });

  defineTest("success", z.success(z.string()), {
    type: "string",
    tests: [
      testCase({
        value: "Hello World",
        parse: { data: true },
        // @ts-expect-error - this just turns into true on a successful parse
        equals: "Hello World",
      }),
    ],
  });

  defineTest("catch", z.catch(z.string(), ""), {
    type: "string",
    tests: [
      testCase({
        value: "Hello World",
        parse: { data: "Hello World" },
      }),
    ],
  });

  defineTest("nan", z.nan(), {
    type: "number",
    tests: [testCase({ value: NaN, parse: { data: NaN } })],
  });

  defineTest(
    "pipe",
    z.pipe(
      z.string(),
      z.transform((value) => value.toUpperCase()),
    ),
    {
      type: "string",
      tests: [
        testCase({ value: "Hello World", parse: { data: "HELLO WORLD" } }),
      ],
    },
  );

  // // TODO: Support codecs (type = pipe)
  // defineTest(
  //   "codec",
  //   z.codec(z.string(), z.number(), {
  //     encode: (value: number) => String(value),
  //     decode: (value: string) => Number(value),
  //   }),
  //   {
  //     type: "string | number",
  //     tests: [
  //       testCase({ value: "123", parse: { data: 123 }, equals: 123 }),
  //       // testCase({ value: "123", parse: { data: 123 }, equals: 123 }),
  //     ],
  //   },
  // );

  defineTest("readonly", z.readonly(z.string()), {
    type: "string",
    tests: [testCase({ value: "Hello World", parse: { data: "Hello World" } })],
  });

  // TODO: DB Validation?
  defineTest(
    "template_literal",
    z.templateLiteral([z.literal("user."), z.enum(["age", "name"])]),
    {
      type: "string",
      tests: [
        testCase({ value: "user.age", parse: { data: "user.age" } }),
        testCase({ value: "user.name", parse: { data: "user.name" } }),
        testCase({
          value: "user.unknown",
          parse: {
            error: issues([
              issue.invalid_format("template_literal", {
                pattern: /^(user\.)(age|name)$/,
              }),
            ]),
          },
          // error: /expected `string` but found `'user.unknown'`/i,
        }),
      ],
    },
  );

  const object = z.object({
    name: z.string(),
    age: z.number(),
    children: z.array(z.string().or(z.lazy((): any => object))),
  });
  defineTest("lazy", object, {
    type: "object",
    children: [
      { name: "name", type: "string" },
      { name: "age", type: "number" },
      { name: "children", type: "array" },
    ],
    tests: [
      testCase({ value: { name: "John Doe", age: 17, children: [] } }),
      testCase({
        value: { name: "John Doe", age: 17, children: ["user:1", "user:2"] },
      }),
      testCase({
        value: {
          name: "John Doe",
          age: 17,
          children: [{ name: "Jane Doe", age: 16 }],
        },
      }),
      testCase({
        value: {
          name: "John Doe",
          age: 17,
          children: [{ age: 16 }],
        },
        parse: {
          error: issues([
            issue.invalid_union(
              [issue.invalid_type("string")],
              [
                issue.invalid_type("string", { path: ["name"] }),
                issue.invalid_type("array", { path: ["children"] }),
              ],
            ),
          ]),
        },
      }),
    ],
  });

  // We will not support promises for now, this can be uncommented after
  // support is added
  // @original
  defineTest("promise<string>", z.promise(z.string()), {
    error: /Promise type cannot be used as a field type/i,
    //   type: "string",
    //   async: true,
    //   tests: [
    //     testCase({
    //       value: Promise.resolve("Hello World"),
    //       parse: { data: "Hello World" },
    //     }),
    //   ],
  });

  // @original
  defineTest("function", z.function(), {
    error: /Function type cannot be used as a field type/i,
  });

  // @original
  defineTest("custom", z.custom(), {
    error: /Custom type cannot be used as a field type/i,
  });

  // // @original
  // defineTest("instanceof", z.instanceof(Date), {
  //   error: /Custom type cannot be used as a field type/i,
  // });

  // // @original
  // defineTest("json", z.json(), {
  //   type: "string | number | bool | null | array | object",
  //   children: [{ name: "*", type: "any" }],
  //   tests: [
  //     testCase({ value: "Hello World", parse: { data: "Hello World" } }),
  //     testCase({ value: 123, parse: { data: 123 } }),
  //     testCase({ value: true, parse: { data: true } }),
  //     testCase({ value: false, parse: { data: false } }),
  //     testCase({ value: null, parse: { data: null } }),
  //     testCase({ value: [1, 2, 3], parse: { data: [1, 2, 3] } }),
  //     testCase({
  //       value: { name: "John Doe", age: 17 },
  //       parse: { data: { name: "John Doe", age: 17 } },
  //     }),
  //   ],
  // });

  // // @original
  // // TODO: DB Normalization
  // defineTest("stringbool", z.stringbool(), {
  //   type: "string | bool",
  //   tests: [
  //     testCase({ value: "yes", parse: { data: true } }),
  //     testCase({ value: "true", parse: { data: true } }),
  //     testCase({ value: "no", parse: { data: false } }),
  //     testCase({ value: "false", parse: { data: false } }),
  //   ],
  // });

  describe("recordId", () => {
    test("type is overriden", () => {
      const schema = z.recordId(["user", "admin"]).type(z.string());
      let parse = schema.safeParse(new RecordId("user", "123"));
      expect(parse).toMatchObject({
        success: true,
        data: new RecordId("user", "123"),
      });
      parse = schema.safeParse(new RecordId("test", 123));
      expect(parse.success).toBeFalse();
      expect(parse.error?.message).toMatch(/expected string, received number/i);
    });

    test("table is overriden", () => {
      let schema: z.ZodSurrealdRecordId<string> = z.recordId(["user", "admin"]);
      let parse = schema.safeParse(new RecordId("user", "123"));
      expect(parse).toMatchObject({
        success: true,
        data: new RecordId("user", "123"),
      });
      parse = schema.safeParse(new RecordId("test", "123"));
      expect(parse.success).toBeFalse();
      expect(parse.error?.message).toMatch(
        /Expected RecordId's table to be one of user \| admin but found test/i,
      );
      schema = schema.table("test") as never;
      parse = schema.safeParse(new RecordId("test", "123"));
      expect(parse).toMatchObject({
        success: true,
        data: new RecordId("test", "123"),
      });
      parse = schema.safeParse(new RecordId("admin", "123"));
      expect(parse.success).toBeFalse();
      expect(parse.error?.message).toMatch(
        /Expected RecordId's table to be test but found admin/i,
      );
    });

    test("anytable", () => {
      let schema: z.ZodSurrealdRecordId = z.recordId(["user", "admin"]);
      let parse = schema.safeParse(new RecordId("test", "123"));
      expect(parse).toMatchObject({
        success: false,
        error: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "invalid_value",
              values: ["user", "admin"],
            }),
          ]),
        }),
      });
      schema = schema.anytable();
      parse = schema.safeParse(new RecordId("test", "123"));
      expect(parse).toMatchObject({
        success: true,
        data: new RecordId("test", "123"),
      });
    });

    describe("from RecordId", () => {
      test("any table, any value", () => {
        const schema = z.recordId();
        expect(schema.safeDecode(new RecordId("user", "123"))).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
        expect(schema.safeDecode(new RecordId("test", "123"))).toMatchObject({
          success: true,
          data: new RecordId("test", "123"),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(
          schema.parse<"user", number>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        expectTypeOf(
          schema.parse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.parseAsync<"user", number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.parseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeParse<"user", number>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeParse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeParseAsync<"user", number>(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeParseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(
          schema.decode<"user", number>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        expectTypeOf(
          schema.decode<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.decodeAsync<"user", number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.decodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeDecode
        expectTypeOf(schema.safeDecode).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeDecode<"user", number>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeDecode<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeDecodeAsync
        expectTypeOf(schema.safeDecodeAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeDecodeAsync<"user", number>(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeDecodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
      });

      test("any table, typed value", () => {
        const schema = z.recordId().type(z.number());
        expect(schema.safeDecode(new RecordId("user", 123))).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(schema.safeDecode(new RecordId("test", 123))).toMatchObject({
          success: true,
          data: new RecordId("test", 123),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(schema.parse<"user">(new RecordId("user", 123))).toExtend<
          RecordId<"user", number>
        >();
        expectTypeOf(
          schema.parse<RecordId<"user", string>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.parseAsync<"user">(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.parseAsync<RecordId<"user", string>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeParse<"user">(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeParse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeParseAsync<"user">(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeParseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(schema.decode<"user">(new RecordId("user", 123))).toExtend<
          RecordId<"user", number>
        >();
        expectTypeOf(
          schema.decode<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.decodeAsync<"user">(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.decodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeDecode
        expectTypeOf(schema.safeDecode).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeDecode<"user">(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeDecode<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeDecodeAsync
        expectTypeOf(schema.safeDecodeAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeDecodeAsync<"user">(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeDecodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
      });

      test("specific table, any value", () => {
        const schema = z.recordId("user");
        expect(schema.safeDecode(new RecordId("user", "123"))).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
        expect(
          schema.safeDecode(new RecordId("test", "123") as never),
        ).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user"],
              }),
            ]),
          }),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(schema.parse<number>(new RecordId("user", 123))).toExtend<
          RecordId<"user", RecordIdValue>
        >();
        expectTypeOf(
          schema.parse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.parseAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.parseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<"user", RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeParse<number>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeParse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeParseAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeParseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<string, RecordIdValue>
        >();
        expectTypeOf(schema.decode<number>(new RecordId("user", 123))).toExtend<
          RecordId<"user", number>
        >();
        expectTypeOf(
          schema.decode<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user", number>>();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.decodeAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user", number>>>();
        expectTypeOf(
          schema.decodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user", number>>>();
        // safeDecode
        expectTypeOf(schema.safeDecode).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeDecode<number>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        expectTypeOf(
          schema.safeDecode<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user", number>>>();
        // safeDecodeAsync
        expectTypeOf(schema.safeDecodeAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, RecordIdValue>>>
        >();
        expectTypeOf(
          schema.safeDecodeAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
        expectTypeOf(
          schema.safeDecodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
      });

      test("specific table, typed value", () => {
        const schema = z.recordId("user").type(z.number());
        expect(schema.safeDecode(new RecordId("user", 123))).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(
          schema.safeDecode(new RecordId("test", 123) as never),
        ).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user"],
              }),
            ]),
          }),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<RecordId<string, number>>();
        expectTypeOf(schema.parse(new RecordId("user", 123))).toExtend<
          RecordId<"user", number>
        >();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<string, number>>
        >();
        expectTypeOf(schema.parseAsync(new RecordId("user", 123))).toExtend<
          Promise<RecordId<"user", number>>
        >();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, number>>
        >();
        expectTypeOf(schema.safeParse(new RecordId("user", 123))).toExtend<
          z.ZodSafeParseResult<RecordId<"user", number>>
        >();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, number>>>
        >();
        expectTypeOf(schema.safeParseAsync(new RecordId("user", 123))).toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user", number>>>
        >();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<string, number>
        >();
        expectTypeOf(schema.decode(new RecordId("user", 123))).toExtend<
          RecordId<"user", number>
        >();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<string, number>>
        >();
        expectTypeOf(schema.decodeAsync(new RecordId("user", 123))).toExtend<
          Promise<RecordId<"user", number>>
        >();
        // safeDecode
        expectTypeOf(schema.safeDecode).returns.toExtend<
          z.ZodSafeParseResult<RecordId<string, number>>
        >();
        expectTypeOf(schema.safeDecode(new RecordId("user", 123))).toExtend<
          z.ZodSafeParseResult<RecordId<"user", number>>
        >();
        // safeDecodeAsync
        expectTypeOf(schema.safeDecodeAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<string, number>>>
        >();
        expectTypeOf(
          schema.safeDecodeAsync(new RecordId("user", 123)),
        ).toExtend<Promise<z.ZodSafeParseResult<RecordId<"user", number>>>>();
      });

      test("multiple tables, any value", () => {
        const schema = z.recordId(["user", "admin"]);
        expect(schema.safeDecode(new RecordId("user", "123"))).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
        expect(schema.safeDecode(new RecordId("admin", "123"))).toMatchObject({
          success: true,
          data: new RecordId("admin", "123"),
        });
        expect(
          schema.safeDecode(new RecordId("test", "123") as never),
        ).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user", "admin"],
              }),
            ]),
          }),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<
          RecordId<"user" | "admin", RecordIdValue>
        >();
        expectTypeOf(schema.parse<number>(new RecordId("user", 123))).toExtend<
          RecordId<"user" | "admin", number>
        >();
        expectTypeOf(
          schema.parse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user" | "admin", number>>();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<"user" | "admin", RecordIdValue>>
        >();
        expectTypeOf(
          schema.parseAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user" | "admin", number>>>();
        expectTypeOf(
          schema.parseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user" | "admin", number>>>();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<"user" | "admin", RecordIdValue>>
        >();
        expectTypeOf(
          schema.safeParse<number>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>();
        expectTypeOf(
          schema.safeParse<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<
            z.ZodSafeParseResult<RecordId<"user" | "admin", RecordIdValue>>
          >
        >();
        expectTypeOf(
          schema.safeParseAsync<number>(new RecordId("user", 123)),
        ).toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
        expectTypeOf(
          schema.safeParseAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<"user" | "admin", RecordIdValue>
        >();
        expectTypeOf(schema.decode<number>(new RecordId("user", 123))).toExtend<
          RecordId<"user" | "admin", number>
        >();
        expectTypeOf(
          schema.decode<RecordId<"user", number>>(new RecordId("user", 123)),
        ).toExtend<RecordId<"user" | "admin", number>>();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<"user" | "admin", RecordIdValue>>
        >();
        expectTypeOf(
          schema.decodeAsync<number>(new RecordId("user", 123)),
        ).toExtend<Promise<RecordId<"user" | "admin", number>>>();
        expectTypeOf(
          schema.decodeAsync<RecordId<"user", number>>(
            new RecordId("user", 123),
          ),
        ).toExtend<Promise<RecordId<"user" | "admin", number>>>();
      });

      test("multiple tables, typed value", () => {
        const schema = z.recordId(["user", "admin"]).type(z.number());
        expect(schema.safeDecode(new RecordId("user", 123))).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(schema.safeDecode(new RecordId("admin", 123))).toMatchObject({
          success: true,
          data: new RecordId("admin", 123),
        });
        expect(
          schema.safeDecode(new RecordId("test", "123") as never),
        ).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user", "admin"],
              }),
            ]),
          }),
        });
        // TODO: StringRecordId is not supported yet
        expect(schema.safeDecode(new StringRecordId("user:123"))).toMatchObject(
          {
            success: false,
            error: expect.objectContaining({
              issues: expect.arrayContaining([
                expect.objectContaining({
                  code: "invalid_type",
                  expected: "record_id",
                }),
              ]),
            }),
          },
        );

        // -------------------------- Type Tests --------------------------
        // parse
        expectTypeOf(schema.parse).returns.toExtend<
          RecordId<"user" | "admin", number>
        >();
        expectTypeOf(schema.parse(new RecordId("user", 123))).toExtend<
          RecordId<"user" | "admin", number>
        >();
        // parseAsync
        expectTypeOf(schema.parseAsync).returns.toExtend<
          Promise<RecordId<"user" | "admin", number>>
        >();
        expectTypeOf(schema.parseAsync(new RecordId("user", 123))).toExtend<
          Promise<RecordId<"user" | "admin", number>>
        >();
        // safeParse
        expectTypeOf(schema.safeParse).returns.toExtend<
          z.ZodSafeParseResult<RecordId<"user" | "admin", number>>
        >();
        expectTypeOf(schema.safeParse(new RecordId("user", 123))).toExtend<
          z.ZodSafeParseResult<RecordId<"user" | "admin", number>>
        >();
        // safeParseAsync
        expectTypeOf(schema.safeParseAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
        expectTypeOf(schema.safeParseAsync(new RecordId("user", 123))).toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
        // decode
        expectTypeOf(schema.decode).returns.toExtend<
          RecordId<"user" | "admin", number>
        >();
        expectTypeOf(schema.decode(new RecordId("user", 123))).toExtend<
          RecordId<"user" | "admin", number>
        >();
        // decodeAsync
        expectTypeOf(schema.decodeAsync).returns.toExtend<
          Promise<RecordId<"user" | "admin", number>>
        >();
        expectTypeOf(schema.decodeAsync(new RecordId("user", 123))).toExtend<
          Promise<RecordId<"user" | "admin", number>>
        >();
        // safeDecode
        expectTypeOf(schema.safeDecode).returns.toExtend<
          z.ZodSafeParseResult<RecordId<"user" | "admin", number>>
        >();
        expectTypeOf(schema.safeDecode(new RecordId("user", 123))).toExtend<
          z.ZodSafeParseResult<RecordId<"user" | "admin", number>>
        >();
        // safeDecodeAsync
        expectTypeOf(schema.safeDecodeAsync).returns.toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
        expectTypeOf(
          schema.safeDecodeAsync(new RecordId("user", 123)),
        ).toExtend<
          Promise<z.ZodSafeParseResult<RecordId<"user" | "admin", number>>>
        >();
      });
    });

    describe("from parts", () => {
      test("any table, any value", () => {
        const schema = z.recordId();
        expect(schema.safeFromParts("user", "123")).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
      });

      test("any table, typed value", () => {
        const schema = z.recordId().type(z.number());
        expect(schema.safeFromParts("user", 123)).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(schema.safeFromParts("test", "123" as never)).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_type",
                expected: "number",
              }),
            ]),
          }),
        });
      });

      test("specific table, any value", () => {
        const schema = z.recordId("user");
        expect(schema.safeFromParts("user", "123")).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
        expect(schema.safeFromParts("admin" as never, "123")).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user"],
              }),
            ]),
          }),
        });
      });

      test("specific table, typed value", () => {
        const schema = z.recordId("user").type(z.number());
        expect(schema.safeFromParts("user", 123)).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(schema.safeFromParts("test" as any, 123)).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user"],
              }),
            ]),
          }),
        });
      });

      test("multiple tables, any value", () => {
        const schema = z.recordId(["user", "admin"]);
        expect(schema.safeFromParts("user", "123")).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
        expect(schema.safeFromParts("test" as never, "123")).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user", "admin"],
              }),
            ]),
          }),
        });
      });

      test("multiple tables, typed value", () => {
        const schema = z.recordId(["user", "admin"]).type(z.number());
        expect(schema.safeFromParts("user", 123)).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
        expect(schema.safeFromParts("test" as never, 123)).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user", "admin"],
              }),
            ]),
          }),
        });
      });
    });

    describe("from id", () => {
      test("any table, any value", () => {
        const schema = z.recordId();
        // @ts-expect-error - from id not allowed
        expect(schema.safeFromId).toBeUndefined();
      });

      test("any table, typed value", () => {
        const schema = z.recordId().type(z.number());
        // @ts-expect-error - from id not allowed
        expect(schema.safeFromId).toBeUndefined();
      });

      test("specific table, any value", () => {
        const schema = z.recordId("user");
        expect(schema.safeFromId("123")).toMatchObject({
          success: true,
          data: new RecordId("user", "123"),
        });
      });

      test("specific table, typed value", () => {
        const schema = z.recordId("user").type(z.number());
        expect(schema.safeFromId(123)).toMatchObject({
          success: true,
          data: new RecordId("user", 123),
        });
      });

      test("multiple tables, any value", () => {
        const schema = z.recordId(["user", "admin"]);
        // @ts-expect-error - from id not allowed
        expect(schema.safeFromId).toBeUndefined();
      });

      test("multiple table, typed value", () => {
        const schema = z.recordId(["user", "admin"]).type(z.number());
        // @ts-expect-error - from id not allowed
        expect(schema.safeFromId).toBeUndefined();
      });
    });
  });

  describe("table", () => {
    test("fails if not an object", () => {
      const schema = z.table("test").fields({
        name: z.string(),
      });
      expect(schema.safeParse("Hello World")).toMatchObject({
        success: false,
        error: expect.objectContaining({
          message: expect.stringMatching(/expected object, received string/i),
        }),
      });
      expect(schema.safeParse(null)).toMatchObject({
        success: false,
        error: expect.objectContaining({
          message: expect.stringMatching(/expected object, received null/i),
        }),
      });
      expect(schema.safeParse(123)).toMatchObject({
        success: false,
        error: expect.objectContaining({
          message: expect.stringMatching(/expected object, received number/i),
        }),
      });
      expect(schema.safeParse(true)).toMatchObject({
        success: false,
        error: expect.objectContaining({
          message: expect.stringMatching(/expected object, received boolean/i),
        }),
      });
    });

    test("fails if id does not match table name", () => {
      const schema = z.table("user").schemaless().fields({
        name: z.string(),
      });
      const parse = schema.safeParse({
        id: new RecordId("test", 123),
        name: "John Doe",
        age: 99,
      });
      expect(parse).toMatchObject({
        success: false,
        error: expect.objectContaining({
          message: expect.stringMatching(
            /Expected RecordId's table to be user but found test/i,
          ),
        }),
      });
    });

    test("id's table is overriden if already set", () => {
      const schema = z.table("user").fields({
        id: z.recordId(["test", "admin"]),
      });
      expect(
        schema.safeParse({
          id: new RecordId("test", 123),
        }),
      ).toMatchObject({
        success: false,
        error: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "invalid_value",
              values: ["user"],
              path: ["id"],
            }),
          ]),
          message: expect.stringMatching(
            /Expected RecordId's table to be user but found test/i,
          ),
        }),
      });
    });

    test("fails if id is not provided", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const parse = schema.safeParse({
        name: "John Doe",
        age: 99,
      });
      expect(parse).toMatchObject({
        success: false,
        error: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "invalid_type",
              path: ["id"],
              expected: "record_id",
            }),
          ]),
        }),
      });
    });

    test("allow extra fields if schemaless", () => {
      const schema = z.table("user").schemaless().fields({
        name: z.string(),
      });
      const parse = schema.safeParse({
        id: new RecordId("user", 123),
        name: "John Doe",
        age: 99,
      });
      expect(parse).toMatchObject({
        success: true,
        data: {
          name: "John Doe",
          age: 99,
        },
      });
    });

    test("deny extra fields if schemafull", () => {
      const schema = z.table("user").schemafull().fields({
        name: z.string(),
      });
      const parse = schema.safeParse({
        id: new RecordId("user", "213"),
        name: "John Doe",
        age: 99,
      });
      expect(parse).toMatchObject({
        success: false,
        error: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "unrecognized_keys",
              keys: ["age"],
            }),
          ]),
        }),
      });
    });

    test("fail on missing fields", () => {
      const schema = z.table("test").fields({
        name: z.string(),
        age: z.string(),
      });
      const parse = schema.safeParse({
        id: new RecordId("test", "123"),
      });
      expect(parse).toMatchObject({
        success: false,
        error: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: "invalid_type",
              path: ["name"],
              expected: "string",
            }),
            expect.objectContaining({
              code: "invalid_type",
              path: ["age"],
              expected: "string",
            }),
          ]),
        }),
      });
    });

    describe("record()", () => {
      test("matches table's id type", () => {
        const schema = z.table("test").record();
        let parse = schema.safeParse(new RecordId("test", "123"));
        expect(parse).toMatchObject({
          success: true,
          data: new RecordId("test", "123"),
        });
        parse = schema.safeParse(new RecordId("user", "123"));
        expect(parse).toMatchObject({
          success: false,
          error: expect.any(Error),
        });
      });

      test("original id schema is preserved", () => {
        const schema = z
          .table("test")
          .fields({
            id: z.string(),
            name: z.string(),
          })
          .record();
        let parse = schema.safeParse(new RecordId("test", "123"));
        expect(parse).toMatchObject({
          success: true,
          data: new RecordId("test", "123"),
        });
        parse = schema.safeParse(new RecordId("user", "123"));
        expect(parse).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["test"],
              }),
            ]),
          }),
        });
      });
    });

    describe("dto()", () => {
      test("id is optional", () => {
        const schema = z
          .table("user")
          .fields({
            name: z.string(),
          })
          .dto();
        const parse = schema.safeParse({
          name: "John Doe",
        });
        expect(parse).toMatchObject({
          success: true,
          data: {
            name: "John Doe",
          },
        });
      });

      test("original id schema is preserved", () => {
        const schema = z
          .table("user")
          .fields({
            name: z.string(),
          })
          .dto();
        let parse = schema.safeParse({
          id: new RecordId("user", "123"),
          name: "John Doe",
        });
        expect(parse).toMatchObject({
          success: true,
          data: {
            id: new RecordId("user", "123"),
            name: "John Doe",
          },
        });
        parse = schema.safeParse({
          id: new RecordId("test", "456"),
          name: "John Doe",
        });
        expect(parse).toMatchObject({
          success: false,
          error: expect.objectContaining({
            issues: expect.arrayContaining([
              expect.objectContaining({
                code: "invalid_value",
                values: ["user"],
              }),
            ]),
          }),
        });
      });
    });
  });

  describe("duration", () => {
    test("matches duration type", () => {
      const schema = z.duration();
      const parse = schema.safeParse(new Duration("1y"));
      expect(parse.data?.equals(new Duration("1y"))).toBeTrue();
    });
  });
});
