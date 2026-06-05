// import {
//   describe,
//   expect,
//   expectTypeOf,
//   test,
//   type AsymmetricMatcher,
// } from "bun:test";
// import {
//   Duration,
//   RecordId,
//   StringRecordId,
//   type RecordIdValue,
// } from "surrealdb";
// import sz from "../src";

// const suites = {
//   string: {
//     simple: "Hello World",
//     empty: "",
//   },
//   number: {
//     positive: 123,
//     negative: -123,
//     decimal: 123.456,
//     zero: 0,
//     max_int: Number.MAX_SAFE_INTEGER,
//     min_int: Number.MIN_SAFE_INTEGER,
//   },
//   bigint: {
//     positive: 123n,
//     negative: -123n,
//   },
//   boolean: {
//     true: true,
//     false: false,
//   },
//   null: {
//     simple: null,
//   },
//   undefined: {
//     simple: undefined,
//   },
//   array: {
//     empty: [],
//     basic: [1, 2, 3],
//     nested: [
//       [1, 2, 3],
//       [4, 5, 6],
//     ],
//   },
//   object: {
//     basic: {
//       name: "John Doe",
//       age: 17,
//     },
//     nested: {
//       name: "John Doe",
//       age: 17,
//       meta: {
//         created: new Date(),
//         version: 1,
//         deleted: false,
//       },
//     },
//   },
//   recordId: {
//     basic: new RecordId("user", "123"),
//     different_table: new RecordId("test", "123"),
//     different_type: new RecordId("user", 123),
//   },
// };

// type SuiteCfg = {
//   [key in keyof typeof suites]?:
//     | boolean
//     | {
//         [subkey in keyof (typeof suites)[key]]?:
//           | boolean
//           | {
//               __but__?: {
//                 pass: true;
//                 expected: any;
//               };
//             }
//           | {
//               __but__?: {
//                 pass: false;
//                 error: AsymmetricMatcher;
//               };
//             }
//           | {
//               __but__?: {
//                 dontPatch: any;
//               };
//             };
//       };
// };

// const all = (tests?: SuiteCfg) => {
//   const toExecute: Record<string, Record<string, boolean>> = {};
//   for (const suiteName of Object.keys(suites) as (keyof typeof suites)[]) {
//     toExecute[suiteName] = {};

//     if (typeof tests?.[suiteName] === "boolean") {
//       for (const testCase in suites[suiteName]) {
//         toExecute[suiteName][testCase] = tests?.[suiteName] ?? true;
//       }
//     } else {
//       for (const testCase of Object.keys(
//         suites[suiteName],
//       ) as (keyof (typeof suites)[typeof suiteName])[]) {
//         toExecute[suiteName][testCase] = tests?.[suiteName]?.[testCase] ?? true;
//       }
//     }
//   }
//   return toExecute;
// };

// const none = (tests?: SuiteCfg) => {
//   const toExecute: Record<string, Record<string, boolean>> = {};
//   for (const suiteName of Object.keys(suites) as (keyof typeof suites)[]) {
//     toExecute[suiteName] = {};

//     if (typeof tests?.[suiteName] === "boolean") {
//       for (const testCase in suites[suiteName]) {
//         toExecute[suiteName][testCase] = tests?.[suiteName] ?? false;
//       }
//     } else {
//       for (const testCase of Object.keys(
//         suites[suiteName],
//       ) as (keyof (typeof suites)[typeof suiteName])[]) {
//         toExecute[suiteName][testCase] =
//           tests?.[suiteName]?.[testCase] ?? false;
//       }
//     }
//   }
//   return toExecute;
// };

// const but = {
//   pass: {
//     expecting: <T>(testcase: T, patch: (testcase: T) => any) => {
//       return {
//         __but__: {
//           pass: true as const,
//           expected: patch(structuredClone(testcase)),
//         },
//       };
//     },
//   },
//   fail: {
//     with: (error: ReturnType<typeof expect.objectContaining>) => {
//       return {
//         __but__: {
//           pass: false as const,
//           error,
//         },
//       };
//     },
//   },
//   dontPatch: (value: any) => {
//     return {
//       __but__: {
//         dontPatch: value,
//       },
//     };
//   },
// };

// function testSchema(
//   name: string,
//   schema: sz.core.$ZodType,
//   shouldMatch: SuiteCfg,
// ) {
//   describe(name, () => {
//     // console.log(name, shouldMatch);
//     for (const [suiteName, suite] of Object.entries(suites) as [
//       keyof typeof suites,
//       (typeof suites)[keyof typeof suites],
//     ][]) {
//       for (const [testcaseName, testcaseValue] of Object.entries(suite) as [
//         keyof typeof suite,
//         (typeof suite)[keyof typeof suite],
//       ][]) {
//         const title = `${suiteName}.${testcaseName}`;
//         test(`= ${title}`, () => {
//           // biome-ignore lint/suspicious/noExplicitAny: _
//           const override: any = shouldMatch[suiteName]?.[testcaseName]?.[
//             // biome-ignore lint/complexity/useLiteralKeys: _
//             "__but__"
//           ]
//             ? // biome-ignore lint/complexity/useLiteralKeys: _
//               shouldMatch[suiteName]?.[testcaseName]?.["__but__"]
//             : undefined;

//           const shouldPass =
//             override?.pass ?? shouldMatch[suiteName]?.[testcaseName];

//           if (shouldPass) {
//             const parse = (schema as sz.ZodType).safeParse(testcaseValue);
//             expect(parse).toMatchObject({
//               success: true,
//               data: override?.expected ?? testcaseValue,
//             });
//           } else {
//             const parse = (schema as sz.ZodType).safeParse(testcaseValue);
//             let received: string = typeof testcaseValue;
//             if (testcaseValue === null) {
//               received = "null";
//             } else if (testcaseValue === undefined) {
//               received = "undefined";
//             } else if (received === "object") {
//               if (Array.isArray(testcaseValue)) {
//                 received = "array";
//               } else if ((testcaseValue as unknown) instanceof RecordId) {
//                 received = "RecordId";
//               }
//             }

//             expect(parse).toMatchObject({
//               success: false,
//               error:
//                 override?.error ??
//                 expect.objectContaining({
//                   issues: expect.arrayContaining([
//                     expect.objectContaining({
//                       code: "invalid_type",
//                     }),
//                   ]),
//                 }),
//             });
//           }
//         });
//       }
//     }
//   });
// }

// function _patch(tests: SuiteCfg, patch: SuiteCfg) {
//   const patched: Record<string, Record<string, any>> = {};
//   // clone tests
//   for (const [suiteName, suite] of Object.entries(tests)) {
//     patched[suiteName] = {};
//     for (const [testcaseName, testcaseValue] of Object.entries(suite)) {
//       patched[suiteName][testcaseName] = testcaseValue;
//     }
//   }
//   // patch tests
//   for (const [suiteName, suite] of Object.entries(tests) as [string, any][]) {
//     for (const [testcaseName, _testcaseValue] of Object.entries(suite) as [
//       string,
//       any,
//     ][]) {
//       if (
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         (tests as any)[suiteName]?.[testcaseName]?.__but__ &&
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         (tests as any)[suiteName]?.[testcaseName].__but__.dontPatch !==
//           undefined
//       ) {
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         (patched as any)[suiteName][testcaseName] = (tests as any)[suiteName]?.[
//           testcaseName
//         ].__but__?.dontPatch;
//         // biome-ignore lint/suspicious/noExplicitAny: _
//       } else if (typeof (patch as any)[suiteName] === "boolean") {
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         (patched as any)[suiteName][testcaseName] = (patch as any)[suiteName];
//       } else if (
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         typeof (patch as any)[suiteName]?.[testcaseName] === "boolean"
//       ) {
//         // biome-ignore lint/suspicious/noExplicitAny: _
//         (patched as any)[suiteName][testcaseName] = (patch as any)[suiteName]?.[
//           testcaseName
//         ];
//       }
//     }
//   }
//   return patched;
// }

// describe("surreal-zod", () => {
//   for (const { name, wrap, patch } of [
//     {
//       name: "",
//       wrap: (schema: sz.core.$ZodType) => schema,
//       patch: (tests: SuiteCfg) => _patch(tests, tests),
//     },
//     {
//       name: "optional",
//       wrap: (schema: sz.core.$ZodType) => sz.optional(schema),
//       patch: (tests: SuiteCfg) =>
//         _patch(tests, {
//           undefined: true,
//         }),
//     },
//     {
//       name: "nonoptional",
//       wrap: (schema: sz.core.$ZodType) => sz.nonoptional(schema),
//       patch: (tests: SuiteCfg) =>
//         _patch(tests, {
//           undefined: false,
//         }),
//     },
//     {
//       name: "nullable",
//       wrap: (schema: sz.core.$ZodType) => sz.nullable(schema),
//       patch: (tests: SuiteCfg) =>
//         _patch(tests, {
//           null: true,
//         }),
//     },
//     {
//       name: "nullish",
//       wrap: (schema: sz.core.$ZodType) => sz.nullish(schema),
//       patch: (tests: SuiteCfg) =>
//         _patch(tests, {
//           undefined: true,
//           null: true,
//         }),
//     },
//   ] as {
//     name: string;
//     wrap: (schema: sz.core.$ZodType) => sz.core.$ZodType;
//     patch: (tests: SuiteCfg) => SuiteCfg;
//   }[]) {
//     (name ? describe : (_name: string, fn: () => any) => fn())(name, () => {
//       // testSchema("any", wrap(sz.any()), patch(all({})));
//       // testSchema("unknown", wrap(sz.unknown()), patch(all({})));
//       // testSchema("never", wrap(sz.never()), patch(none({})));
//       // testSchema("boolean", wrap(sz.boolean()), patch(none({ boolean: true })));
//       testSchema("string", wrap(sz.string()), patch(none({ string: true })));
//       // testSchema("number", wrap(sz.number()), patch(none({ number: true })));
//       // testSchema("bigint", wrap(sz.bigint()), patch(none({ bigint: true })));
//       // testSchema("null", wrap(sz.null()), patch(none({ null: true })));
//       // testSchema(
//       //   "undefined",
//       //   wrap(sz.undefined()),
//       //   patch(none({ undefined: true })),
//       // );
//       // // testSchema("array", sz.array(sz.number()), none({ array: true }));
//       // testSchema(
//       //   "object",
//       //   wrap(
//       //     sz.object({
//       //       name: sz.string(),
//       //       age: sz.number(),
//       //     }),
//       //   ),
//       //   patch(
//       //     none({
//       //       object: {
//       //         basic: true,
//       //         nested: but.pass.expecting(suites.object.nested, (testcase) => {
//       //           // @ts-expect-error - not undefined
//       //           delete testcase.meta;
//       //           return testcase;
//       //         }),
//       //       },
//       //     }),
//       //   ),
//       // );
//       // testSchema(
//       //   "loose object",
//       //   wrap(
//       //     sz.object({
//       //       name: sz.string(),
//       //       age: sz.number(),
//       //       meta: sz.object().loose(),
//       //     }),
//       //   ),
//       //   patch(
//       //     none({
//       //       object: {
//       //         basic: false,
//       //         nested: true,
//       //       },
//       //     }),
//       //   ),
//       // );
//       // testSchema(
//       //   "strict object",
//       //   wrap(
//       //     sz.object({
//       //       name: sz.string(),
//       //       age: sz.number(),
//       //       meta: sz
//       //         .object({
//       //           created: sz.any(),
//       //           deleted: sz.boolean(),
//       //         })
//       //         .strict(),
//       //     }),
//       //   ),
//       //   patch(
//       //     none({
//       //       object: {
//       //         basic: false,
//       //         nested: (() => {
//       //           switch (name) {
//       //             default: {
//       //               return but.fail.with(
//       //                 expect.objectContaining({
//       //                   issues: expect.arrayContaining([
//       //                     expect.objectContaining({
//       //                       code: "unrecognized_keys",
//       //                       keys: ["version"],
//       //                     }),
//       //                   ]),
//       //                 }),
//       //               );
//       //             }
//       //           }
//       //         })(),
//       //       },
//       //     }),
//       //   ),
//       // );
//       // testSchema(
//       //   "recordId",
//       //   wrap(sz.recordId(["user", "admin"]).type(sz.string())),
//       //   patch(
//       //     none({
//       //       recordId: {
//       //         basic: true,
//       //         different_type: false,
//       //         different_table: but.fail.with(
//       //           expect.objectContaining({
//       //             issues: expect.arrayContaining([
//       //               expect.objectContaining({
//       //                 code: "invalid_value",
//       //                 values: ["user", "admin"],
//       //               }),
//       //             ]),
//       //           }),
//       //         ),
//       //       },
//       //     }),
//       //   ),
//       // );
//     });
//   }

// });
