import { describe } from "bun:test";
import { DateTime, Uuid } from "surrealdb";
import { z } from "../src";
import { setupSurrealTests } from "./common";
import { issue, issues, testCase } from "./utils";

describe("zod", () => {
  const { defineTest } = setupSurrealTests();

  // @original
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

  // @original
  // TODO: DB Validation?
  // TODO: Normalization?
  defineTest("httpUrl", z.httpUrl(), {
    type: "string",
    tests: [
      testCase({
        value: "https://www.google.com",
        parse: { data: "https://www.google.com" },
      }),
      testCase({
        value: "ftp://www.google.com",
        parse: {
          error: issues([issue.invalid_format("url")]),
        },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("url")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("emoji", z.emoji(), {
    type: "string",
    tests: [
      testCase({ value: "👋", parse: { data: "👋" } }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("emoji")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("nanoid", z.nanoid(), {
    type: "string",
    tests: [
      testCase({
        value: "QvqDj2zWl5b8Vj1hcxBmn",
        parse: { data: "QvqDj2zWl5b8Vj1hcxBmn" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("nanoid")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation? TODO: Properly implement
  defineTest("cuid", z.cuid(), {
    type: "string",
    tests: [
      testCase({
        value: "clhqxk9zr0000qzrmn831i7rn",
        parse: { data: "clhqxk9zr0000qzrmn831i7rn" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("cuid")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("cuid2", z.cuid2(), {
    type: "string",
    tests: [
      testCase({
        value: "tz4a98xxat96iws9zmbrgj3a",
        parse: { data: "tz4a98xxat96iws9zmbrgj3a" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("cuid2")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("ulid", z.ulid(), {
    type: "string",
    tests: [
      testCase({
        value: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        parse: { data: "01ARZ3NDEKTSV4RRFFQ69G5FAV" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("ulid")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("xid", z.xid(), {
    type: "string",
    tests: [
      testCase({
        value: "9m4e2mr0ui3e8a215n4g",
        parse: { data: "9m4e2mr0ui3e8a215n4g" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("xid")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("ksuid", z.ksuid(), {
    type: "string",
    tests: [
      testCase({
        value: "0ujsszwN8NRY24YaXiTIE2VWDTS",
        parse: { data: "0ujsszwN8NRY24YaXiTIE2VWDTS" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("ksuid")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("ipv4", z.ipv4(), {
    type: "string",
    tests: [
      testCase({ value: "192.168.1.1", parse: { data: "192.168.1.1" } }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("ipv4")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("mac", z.mac(), {
    type: "string",
    tests: [
      testCase({
        value: "00:00:00:00:00:00",
        parse: { data: "00:00:00:00:00:00" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("mac")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("ipv6", z.ipv6(), {
    type: "string",
    tests: [
      testCase({
        value: "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
        parse: { data: "2001:0db8:85a3:0000:0000:8a2e:0370:7334" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("ipv6")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("cidrv4", z.cidrv4(), {
    type: "string",
    tests: [
      testCase({ value: "192.168.1.1/24", parse: { data: "192.168.1.1/24" } }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("cidrv4")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("cidrv6", z.cidrv6(), {
    type: "string",
    tests: [
      testCase({
        value: "2001:0db8:85a3:0000:0000:8a2e:0370:7334/64",
        parse: { data: "2001:0db8:85a3:0000:0000:8a2e:0370:7334/64" },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("cidrv6")]),
        },
      }),
    ],
  });

  // @original
  // TODO: Properly implement
  defineTest("base64", z.base64(), {
    type: "string",
    tests: [
      testCase({
        value: "SGVsbG8gV29ybGQ=",
        parse: { data: "SGVsbG8gV29ybGQ=" },
      }),
      testCase({
        value: "??",
        parse: {
          error: issues([issue.invalid_format("base64")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("base64url", z.base64url(), {
    type: "string",
    tests: [
      testCase({
        value: "SGVsbG8gV29ybGQ",
        parse: { data: "SGVsbG8gV29ybGQ" },
      }),
      testCase({
        value: "??",
        parse: {
          error: issues([issue.invalid_format("base64url")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("e164", z.e164(), {
    type: "string",
    tests: [
      testCase({ value: "+12345678901", parse: { data: "+12345678901" } }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("e164")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("jwt", z.jwt(), {
    type: "string",
    tests: [
      testCase({
        value:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        parse: {
          data: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        },
      }),
      testCase({
        value: "",
        parse: {
          error: issues([issue.invalid_format("jwt")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest(
    "stringFormat",
    z.stringFormat("lowercase", (value) => value.toLowerCase() === value),
    {
      type: "string",
      tests: [
        testCase({ value: "hello world", parse: { data: "hello world" } }),
        testCase({
          value: "Hello World",
          parse: {
            error: issues([issue.invalid_format("lowercase")]),
          },
        }),
      ],
    },
  );

  // @original
  // TODO: DB Validation?
  defineTest("hostname", z.hostname(), {
    type: "string",
    tests: [
      testCase({ value: "www.google.com", parse: { data: "www.google.com" } }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("hex", z.hex(), {
    type: "string",
    tests: [
      testCase({
        value: "1234567890abcdef",
        parse: { data: "1234567890abcdef" },
      }),
      testCase({
        value: "1234567890ghijkl",
        parse: {
          error: issues([issue.invalid_format("hex")]),
        },
      }),
    ],
  });

  // @original
  // TODO: DB Validation?
  defineTest("hash", z.hash("md5", { enc: "hex" }), {
    type: "string",
    tests: [
      testCase({
        value: "b10a8db164e0754105b7a99be72e3fe5",
        parse: { data: "b10a8db164e0754105b7a99be72e3fe5" },
      }),
      testCase({
        value: "1234567890ghijkl",
        parse: {
          error: issues([issue.invalid_format("md5_hex")]),
        },
      }),
    ],
  });

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
  // May needs patching to work with SurrealDB. As surrealdb doesnt support unsigned int.
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

  // @original
  defineTest("symbol", z.symbol(), {
    error: /Symbol type cannot be used as a field type/i,
  });

  // @original
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

  // @original
  defineTest("any", z.any(), {
    type: "any",
    tests: anyTests,
  });

  // @original
  defineTest("unknown", z.unknown(), {
    type: "any",
    tests: anyTests,
  });

  // @original
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

  // @patched
  defineTest("date", z.date(), {
    type: "datetime",
    tests: [
      testCase({
        value: "2025-01-01T00:00:00.000Z",
        parse: { error: issues([issue.invalid_type("date")]) },
        error: /expected `datetime` but found `'2025-01-01T00:00:00.000Z'`/i,
      }),
      testCase({
        value: new Date("2025-01-01T00:00:00.000Z"),
        parse: { data: new Date("2025-01-01T00:00:00.000Z") },
        // @ts-expect-error - we patched date to support DateTime as well
        equals: new DateTime("2025-01-01T00:00:00.000Z"),
      }),
      testCase({
        value: new DateTime("2025-01-01T00:00:00.000Z"),
        parse: { data: new Date("2025-01-01T00:00:00.000Z") },
        // @ts-expect-error - we patched date to support DateTime as well
        equals: new DateTime("2025-01-01T00:00:00.000Z"),
      }),
    ],
  });

  // @original
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

  // @original
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

  // @original
  defineTest(
    "keyof { name: string, age: number }",
    z.keyof(z.object({ name: z.string(), age: z.number() })),
    {
      type: '"name" | "age"',
      tests: [
        testCase({ value: "name" }),
        testCase({ value: "age" }),
        testCase({
          value: "unknown",
          error: /expected `'name' | 'age'` but found `'unknown'`/i,
        }),
      ],
    },
  );

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

  // @original
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

  // @original
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

    // REVISIT
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

  // @original
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

  // @original
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

  describe("record", () => {
    defineTest(
      `record<"2025-01" | "2025-02" | "2025-03" | "2025-04", number>`,
      z.record(
        z.enum(["2025-01", "2025-02", "2025-03", "2025-04"]),
        z.number(),
      ),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        tests: [
          testCase({
            value: {
              "2025-01": 100,
              "2025-02": 88,
              "2025-03": 99,
              "2025-04": 60,
            },
            parse: {
              data: {
                "2025-01": 100,
                "2025-02": 88,
                "2025-03": 99,
                "2025-04": 60,
              },
            },
          }),
        ],
      },
    );
    defineTest("record<string, number>", z.record(z.string(), z.number()), {
      type: "object",
      children: [{ name: "*", type: "number" }],
      tests: [
        testCase({
          value: {
            "2025-01": 100,
            "2025-02": 88,
            "2025-03": 99,
            "2025-04": 60,
          },
          parse: {
            data: {
              "2025-01": 100,
              "2025-02": 88,
              "2025-03": 99,
              "2025-04": 60,
            },
          },
        }),
        testCase({
          value: {
            "2025-01": "100",
            "2025-02": "88",
            "2025-03": "99",
            "2025-04": "60",
          },
          parse: {
            error: issues([issue.invalid_type("number")]),
          },
          error: /expected `number` but found `'100'`/i,
        }),
      ],
    });
    defineTest(
      "record<number, number>",
      z.record(z.coerce.number(), z.number()),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        tests: [
          testCase({
            value: { 1: 100, 2: 88, 3: 99, 4: 60 },
            parse: {
              data: { 1: 100, 2: 88, 3: 99, 4: 60 },
            },
          }),
        ],
      },
    );
  });

  describe("partial record", () => {
    defineTest(
      `partial record<"2025-01" | "2025-02" | "2025-03" | "2025-04", number>`,
      z.partialRecord(
        z.enum(["2025-01", "2025-02", "2025-03", "2025-04"]),
        z.number(),
      ),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        tests: [
          testCase({
            value: {
              "2025-01": 100,
              "2025-02": 88,
              "2025-03": 99,
            },
            parse: {
              data: {
                "2025-01": 100,
                "2025-02": 88,
                "2025-03": 99,
              },
            },
          }),
        ],
      },
    );

    defineTest(
      "partial record<string, number>",
      z.partialRecord(z.string(), z.number()),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        tests: [
          testCase({
            value: {
              "2025-01": 100,
              "2025-02": 88,
              "2025-03": 99,
            },
            parse: {
              data: {
                "2025-01": 100,
                "2025-02": 88,
                "2025-03": 99,
              },
            },
          }),
        ],
      },
    );
    defineTest(
      "partial record<number, number>",
      z.partialRecord(z.coerce.number(), z.number()),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        tests: [
          testCase({
            value: { 1: 100, 2: 88, 3: 99 },
            parse: {
              data: { 1: 100, 2: 88, 3: 99 },
            },
          }),
        ],
      },
    );
  });

  // @original
  describe("map", () => {
    defineTest("map<string, number>", z.map(z.string(), z.number()), {
      type: "object",
      children: [{ name: "*", type: "number" }],
      tests: [
        testCase({
          value: new Map([
            ["Hello World", 100],
            ["Hello World 2", 88],
            ["Hello World 3", 99],
          ]),
          equals: {
            "Hello World": 100,
            "Hello World 2": 88,
            "Hello World 3": 99,
          },
        }),
      ],
    });
    defineTest("map<number, number>", z.map(z.number(), z.number()), {
      type: "object",
      children: [{ name: "*", type: "number" }],
      tests: [
        testCase({
          value: new Map([
            ["1", 100],
            ["2", 88],
            ["3", 99],
          ]),
          equals: {
            1: 100,
            2: 88,
            3: 99,
          },
        }),
      ],
    });
    defineTest(
      "map<{ user_id: number }, number>",
      z.map(z.object({ user_id: z.number() }), z.number()),
      {
        type: "object",
        children: [{ name: "*", type: "number" }],
        error: /Unsupported key type: object/i,
      },
    );
  });

  // @original
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

  // @original
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

  // @original
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

  // @original
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

  // @original
  defineTest("file", z.file(), {
    error: /File type cannot be used as a field type/i,
  });

  // @original
  defineTest(
    "transform",
    z.transform((value: string) => value.toUpperCase()),
    {
      type: "any",
    },
  );

  // @original
  defineTest("optional", z.optional(z.string()), {
    type: "string | none",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: undefined, parse: { data: undefined } }),
    ],
  });

  // @original
  defineTest("nullable", z.nullable(z.string()), {
    type: "string | null",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: null, parse: { data: null } }),
    ],
  });

  // @original
  defineTest("nullish", z.nullish(z.string()), {
    type: "string | null | none",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: null, parse: { data: null } }),
      testCase({ value: undefined, parse: { data: undefined } }),
    ],
  });

  // @original
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

  // @original
  defineTest("prefault", z.prefault(z.string(), "Hello World"), {
    type: "string",
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: "Hello World 2", parse: { data: "Hello World 2" } }),
    ],
  });

  // @original
  defineTest("nonoptional", z.nonoptional(z.string()), {
    type: "string",
    tests: [testCase({ value: "Hello World", parse: { data: "Hello World" } })],
  });

  // @original
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

  // @original
  defineTest("catch", z.catch(z.string(), ""), {
    type: "string",
    tests: [
      testCase({
        value: "Hello World",
        parse: { data: "Hello World" },
      }),
    ],
  });

  // @original
  defineTest("nan", z.nan(), {
    type: "number",
    tests: [testCase({ value: NaN, parse: { data: NaN } })],
  });

  // @original
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

  // @original
  defineTest("readonly", z.readonly(z.string()), {
    type: "string",
    tests: [testCase({ value: "Hello World", parse: { data: "Hello World" } })],
  });

  // @original
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
  // @original
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

  // @original
  defineTest("instanceof", z.instanceof(Date), {
    error: /Custom type cannot be used as a field type/i,
  });

  // @original
  defineTest("json", z.json(), {
    type: "string | number | bool | null | array | object",
    children: [{ name: "*", type: "any" }],
    tests: [
      testCase({ value: "Hello World", parse: { data: "Hello World" } }),
      testCase({ value: 123, parse: { data: 123 } }),
      testCase({ value: true, parse: { data: true } }),
      testCase({ value: false, parse: { data: false } }),
      testCase({ value: null, parse: { data: null } }),
      testCase({ value: [1, 2, 3], parse: { data: [1, 2, 3] } }),
      testCase({
        value: { name: "John Doe", age: 17 },
        parse: { data: { name: "John Doe", age: 17 } },
      }),
    ],
  });
});
