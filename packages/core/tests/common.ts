import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { escapeIdent, RecordId, surql, type Surreal } from "surrealdb";
import {
  startSurrealTestInstance,
  type TestCaseChildField,
  type ZodTest,
  type TestInstance,
} from "./utils";
import dedent from "dedent";
import { core } from "zod";
import * as _core_ from "../src/zod/core";
import { ZodSurrealTable } from "../src/zod/schema";
import { z } from "../src";
import { formatQuery } from "../src/surql";

export function setupSurrealTests() {
  let testInstance: TestInstance;
  let surreal: Surreal;
  let testId = 0;

  beforeAll(async () => {
    testInstance = await startSurrealTestInstance();
    surreal = testInstance.surreal;
  });

  beforeEach(async () => {
    await surreal.use({ namespace: "test", database: `test_${testId}` });
    testId++;
  });

  afterAll(async () => {
    await testInstance?.close();
  });

  function getFieldQuery(field: TestCaseChildField, table = "test") {
    return dedent.withOptions({ alignValues: true })`
      DEFINE FIELD OVERWRITE ${field.name} ON TABLE ${table} TYPE ${field.type}${
        ""
        // field.reference === true ? " REFERENCE" : reference ? ` REFERENCE ${reference}" : ""
      }${
        field.default
          ? field.default.always
            ? ` DEFAULT ALWAYS ${formatQuery(field.default.value)}`
            : ` DEFAULT ${formatQuery(field.default.value)}`
          : ""
      }${field.readonly ? " READONLY" : ""}${
        field.value
          ? ` ${dedent.withOptions({ alignValues: true })`
              VALUE ${formatQuery(field.value)}
            `}`
          : ""
        // field.transforms?.length
        //   ? ` ${dedent.withOptions({ alignValues: true })`
        //       VALUE {
        //           ${field.transforms?.join("\n")}
        //       }
        //     `}`
        //   : ""
      }${
        field.assert
          ? ` ${dedent.withOptions({ alignValues: true })`
              ASSERT ${formatQuery(field.assert)}
            `}`
          : ""
        // field.asserts?.length
        //   ? ` ${dedent.withOptions({ alignValues: true })`
        //       ASSERT {
        //           ${field.asserts?.join("\n")}
        //       }
        //     `}`
        //   : ""
      }${
        field.comment
          ? ` ${dedent.withOptions({ alignValues: true })`
              COMMENT ${JSON.stringify(field.comment)}
            `}`
          : ""
      };\n
    `;
  }

  function defineTest(
    typeName: string,
    schemas: _core_.$SomeSurrealType | _core_.$SomeSurrealType[],
    expected: ZodTest,
  ) {
    test(typeName, async () => {
      schemas = Array.isArray(schemas) ? schemas : [schemas];

      for (const schema of schemas) {
        const isTable = schema instanceof ZodSurrealTable;
        const table = isTable
          ? schema
          : z.table("test").fields({
              test: schema as any,
            });

        if (expected.error) {
          expect(() =>
            table.toSurql("define", {
              exists: "overwrite",
              fields: true,
            }),
          ).toThrow(expected.error);
          continue;
        }

        const query = table.toSurql("define", {
          exists: "overwrite",
          fields: true,
        });
        const tableName = table._zod.def.name;
        const schemafull = table._zod.def.surreal.schemafull;
        const tableType = table._zod.def.surreal.tableType;

        const resultingQuery = query.query;
        let expectedQuery = dedent.withOptions({ alignValues: true })`
          DEFINE TABLE OVERWRITE ${escapeIdent(tableName)} TYPE ${tableType.toUpperCase()} ${
            schemafull ? "SCHEMAFULL" : "SCHEMALESS"
          };
        `;
        if (!isTable) {
          expectedQuery += "\n";
          expectedQuery += getFieldQuery(
            {
              name: "id",
              type: "any",
            },
            tableName,
          );
          expectedQuery += getFieldQuery(
            {
              name: "test",
              type: expected.type ?? "any",
              default: expected.default ?? undefined,
              value: expected.value ?? undefined,
              comment: expected.comment ?? undefined,
              readonly: expected.readonly ?? undefined,
              assert: expected.assert ?? undefined,
            },
            tableName,
          );
        }
        if (expected.children?.length) {
          // expectedQuery += "\n";
          const childrenQueue = [
            ...expected.children.map((child) => ({
              ...child,
              name: isTable ? child.name : `test.${child.name}`,
            })),
          ];
          while (childrenQueue.length > 0) {
            // biome-ignore lint/style/noNonNullAssertion: bounds accounted for
            const child = childrenQueue.shift()!;
            if (child.children?.length) {
              childrenQueue.unshift(
                ...child.children.map((subchild) => ({
                  ...subchild,
                  name: `${child.name}.${subchild.name}`,
                })),
              );
            }
            expectedQuery += getFieldQuery(child, tableName);
          }
        }

        if (expected.debug) {
          console.log("========== expected query ==========");
          console.log(expectedQuery.trimEnd());
          console.log("========== resulting query ==========");
          console.log(resultingQuery.trimEnd());
        }

        expect(resultingQuery.trimEnd()).toEqual(expectedQuery.trimEnd());
        await surreal.query(resultingQuery);

        if (expected.tests) {
          for (let i = 0; i < expected.tests.length; i++) {
            // biome-ignore lint/style/noNonNullAssertion: bounds accounted for
            const test = expected.tests[i]!;
            let testValue = test.value;
            if (test.parse) {
              // We will not support promises for now, this can be
              // uncomented after support is added
              // if (expected.async) {
              //   const parse = await z.safeParseAsync(schema, test.value);
              //   expect(parse).toMatchObject(
              //     "data" in test.parse
              //       ? { success: true, data: test.parse.data }
              //       : {
              //           success: false,
              //           error: test.parse.error,
              //         },
              //   );
              // } else {
              const parse = core.safeParse(schema, test.value);
              expect(parse).toMatchObject(
                "data" in test.parse
                  ? { success: true, data: test.parse.data }
                  : {
                      success: false,
                      error: test.parse.error,
                    },
              );
              if (
                parse.success &&
                !(
                  "equals" in test ||
                  "check" in test ||
                  "matches" in test ||
                  "error" in test
                )
              ) {
                testValue = parse.data;
              }
              // }
            }

            const testCaseId = isTable
              ? new RecordId(tableName, `testcase_${i}`)
              : new RecordId("test", `testcase_${i}`);
            const result = surreal
              .query(
                isTable
                  ? surql`UPSERT ONLY ${testCaseId} CONTENT ${testValue}`
                  : surql`UPSERT ONLY ${testCaseId} SET test = ${testValue} RETURN AFTER.test`,
              )
              .collect()
              .then(([result]) => result);
            if ("error" in test) {
              expect(result).rejects.toThrow(test.error);
            } else if ("matches" in test) {
              const awaitedResult = await result;
              if (
                test.matches instanceof RegExp ||
                typeof test.matches === "string"
              ) {
                expect(awaitedResult).toMatch(test.matches);
              } else {
                expect(awaitedResult).toMatchObject(test.matches);
              }
            } else if ("check" in test) {
              const awaitedResult = await result;
              const checkResult = test.check(awaitedResult);
              if (checkResult instanceof Promise) {
                expect(checkResult).resolves.toBeUndefined();
              } else {
                expect(checkResult).toBeUndefined();
              }
            } else {
              const awaitedResult = await result;
              expect(awaitedResult).toEqual(
                isTable
                  ? {
                      id: new RecordId("a", "b"),
                      ...(test.equals ?? testValue),
                    }
                  : (test.equals ?? testValue),
              );
            }
          }
        }
      }
    });
  }

  return { defineTest };
}
