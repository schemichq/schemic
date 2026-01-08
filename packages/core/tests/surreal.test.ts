import { describe, expect, test } from "bun:test";
import * as common from "./common";
import { issue, issues, testCase } from "./utils";
import { RecordId } from "surrealdb";
import { z } from "../src";
import dedent from "dedent";

describe("surreal-zod", () => {
  const { defineTest } = common.setupSurrealTests();

  describe("recordId", () => {
    defineTest(
      "any table",
      [
        z.recordId(),
        z.recordId("user").anytable(),
        z.recordId(["user", "order"]).anytable(),
        z.recordId("user").type(z.string()).anytable(),
      ],
      {
        type: "record",
        tests: [
          testCase({
            value: new RecordId("user", "123"),
            parse: {
              data: new RecordId("user", "123"),
            },
          }),
          testCase({
            value: new RecordId("admin", "123"),
            parse: {
              data: new RecordId("admin", "123"),
            },
          }),
        ],
      },
    );

    defineTest(
      "single table",
      [
        z.recordId("user"),
        z.recordId("user").table("user"),
        z.recordId(["user", "order"]).table("user"),
        z.recordId("user").type(z.string()),
      ],
      {
        type: "record<user>",
        tests: [
          testCase({
            value: new RecordId("user", "123"),
            parse: {
              data: new RecordId("user", "123"),
            },
          }),
          testCase({
            value: new RecordId("order", "123"),
            parse: {
              error: issues([issue.invalid_value(["user"])]),
            },
            error:
              /Expected `record<user>` but found `order:(\u27e8|`)123(\u27e9|`)`/i,
          }),
        ],
      },
    );

    defineTest(
      "multiple tables",
      [
        z.recordId(["user", "admin"]),
        z.recordId(["user", "admin"]).type(z.string()),
      ],
      {
        type: "record<user | admin>",
        tests: [
          testCase({
            value: new RecordId("user", "123"),
            parse: {
              data: new RecordId("user", "123"),
            },
          }),
          testCase({
            value: new RecordId("admin", "123"),
            parse: {
              data: new RecordId("admin", "123"),
            },
          }),
          testCase({
            value: new RecordId("test", "123"),
            parse: {
              error: issues([issue.invalid_value(["user", "admin"])]),
            },
            error:
              /Expected `record<user|admin>` but found `test:(\u27e8|`)123(\u27e9|`)`/i,
          }),
        ],
      },
    );
  });

  describe("table", () => {
    test("toSurql('info')", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.toSurql("info");
      expect(query.query).toEqual(dedent.withOptions({ alignValues: true })`
        INFO FOR TABLE user;
      `);
    });
    test("toSurql('structure')", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.toSurql("structure");
      expect(query.query).toEqual(dedent.withOptions({ alignValues: true })`
        INFO FOR TABLE user STRUCTURE;
      `);
    });

    test("toSurql('remove')", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.toSurql("remove");
      expect(query.query).toEqual(dedent.withOptions({ alignValues: true })`
        REMOVE TABLE user;
      `);
      const query2 = schema.toSurql("remove", { missing: "ignore" });
      expect(query2.query).toEqual(dedent.withOptions({ alignValues: true })`
        REMOVE TABLE IF EXISTS user;
      `);
    });
    test("toSurql('define') - default", () => {
      const schema = z.table("user").comment("Users table").fields({
        name: z.string(),
      });
      const query = schema.toSurql("define");
      expect(query.query.trim()).toMatch(
        /^DEFINE TABLE user TYPE ANY SCHEMALESS COMMENT \$bind__\d+;$/i,
      );
    });
    test("toSurql('define') - ignore", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.toSurql("define", { exists: "ignore" });
      expect(query.query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE IF NOT EXISTS user TYPE ANY SCHEMALESS;
        `,
      );
    });
    test("toSurql('define') - overwrite", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.toSurql("define", { exists: "overwrite" });
      expect(query.query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE OVERWRITE user TYPE ANY SCHEMALESS;
        `,
      );
    });
    test("toSurql('define') - with fields", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      const query = schema.drop().toSurql("define", { fields: true });
      expect(query.query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE user TYPE ANY DROP SCHEMALESS;
          DEFINE FIELD id ON TABLE user TYPE any;
          DEFINE FIELD name ON TABLE user TYPE string;
        `,
      );
    });
    test("toSurql('define') - relation table", () => {
      const schema = z
        .table("like")
        .relation()
        .from("user")
        .to(z.recordId("post"))
        .fields({
          created_at: z.string(),
        });
      const query = schema.toSurql("define");
      expect(query.query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE RELATION FROM user TO post SCHEMALESS;
        `,
      );
    });
    test("toSurql('define') - relation table with fields", () => {
      const schema = z
        .table("like")
        .relation()
        .from(z.recordId("user"))
        .to(["post", "comment"])
        .fields({
          created_at: z.string(),
        });
      const query = schema
        .schemafull()
        .toSurql("define", { fields: true, exists: "ignore" });
      expect(query.query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE IF NOT EXISTS like TYPE RELATION FROM user TO post | comment SCHEMAFULL;
          DEFINE FIELD IF NOT EXISTS id ON TABLE like TYPE any;
          DEFINE FIELD IF NOT EXISTS in ON TABLE like TYPE record<user>;
          DEFINE FIELD IF NOT EXISTS out ON TABLE like TYPE record<post | comment>;
          DEFINE FIELD IF NOT EXISTS created_at ON TABLE like TYPE string;
        `,
      );
    });
    test("toSurql(unknown statement)", () => {
      const schema = z.table("user").fields({
        name: z.string(),
      });
      expect(() => schema.toSurql("unknown" as any)).toThrow(
        /Invalid statement/i,
      );
    });

    test(".name()", () => {
      const before = z.table("user");
      expect(before.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE user TYPE ANY SCHEMALESS;
        `,
      );

      const after = before.name("users");
      expect(after.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE users TYPE ANY SCHEMALESS;
        `,
      );
    });

    describe(".fields()", () => {
      test("assigns fields to the table", () => {
        const before = z.table("user");
        expect(before.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE user TYPE ANY SCHEMALESS;
            DEFINE FIELD id ON TABLE user TYPE any;
          `,
        );

        const after = before.fields({
          name: z.string(),
        });
        expect(after.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE user TYPE ANY SCHEMALESS;
            DEFINE FIELD id ON TABLE user TYPE any;
            DEFINE FIELD name ON TABLE user TYPE string;
          `,
        );
      });

      test("id field is normalized", () => {
        const normalizedTable = z.table("user").fields({
          id: z.recordId("post"),
        });
        expect(
          normalizedTable.toSurql("define", { fields: true }).query.trim(),
        ).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE user TYPE ANY SCHEMALESS;
            DEFINE FIELD id ON TABLE user TYPE any;
          `,
        );
        expect(
          normalizedTable.safeParse({ id: new RecordId("post", "123") }),
        ).toMatchObject({
          success: false,
          error: issues([issue.invalid_value(["user"])]),
        });

        const normalizedType = z.table("user").fields({
          id: z.string(),
        });
        expect(
          normalizedType.toSurql("define", { fields: true }).query.trim(),
        ).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE user TYPE ANY SCHEMALESS;
            DEFINE FIELD id ON TABLE user TYPE string;
          `,
        );
        expect(normalizedType.safeParse({ id: "123" })).toMatchObject({
          success: false,
          error: issues([issue.invalid_type("record_id")]),
        });
      });
    });

    describe(".relation()", () => {
      test("assigns relation fields to the table", () => {
        const schema = z.table("like").relation();
        expect(schema.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE like TYPE RELATION SCHEMALESS;
            DEFINE FIELD id ON TABLE like TYPE any;
            DEFINE FIELD in ON TABLE like TYPE record;
            DEFINE FIELD out ON TABLE like TYPE record;
          `,
        );
        expect(
          schema.safeParse({
            id: new RecordId("like", "123"),
          }),
        ).toMatchObject({
          success: false,
          error: issues([
            issue.invalid_type("record_id", { path: ["in"] }),
            issue.invalid_type("record_id", { path: ["out"] }),
          ]),
        });
      });

      test(".from() assigns in field", () => {
        const schema = z.table("like").relation().from("user");
        expect(schema.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE RELATION FROM user SCHEMALESS;
          DEFINE FIELD id ON TABLE like TYPE any;
          DEFINE FIELD in ON TABLE like TYPE record<user>;
          DEFINE FIELD out ON TABLE like TYPE record;
        `,
        );
        expect(
          schema.safeParse({
            id: new RecordId("like", "123"),
            in: new RecordId("_user", "123"),
          }),
        ).toMatchObject({
          success: false,
          error: issues([
            issue.invalid_value(["user"], { path: ["in"] }),
            issue.invalid_type("record_id", { path: ["out"] }),
          ]),
        });
      });

      test(".to() assigns out field", () => {
        const schema = z.table("like").relation().to("post");
        expect(schema.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE like TYPE RELATION TO post SCHEMALESS;
            DEFINE FIELD id ON TABLE like TYPE any;
            DEFINE FIELD in ON TABLE like TYPE record;
            DEFINE FIELD out ON TABLE like TYPE record<post>;
          `,
        );
        expect(
          schema.safeParse({
            id: new RecordId("like", "123"),
            out: new RecordId("_post", "123"),
          }),
        ).toMatchObject({
          success: false,
          error: issues([
            issue.invalid_value(["post"], { path: ["out"] }),
            issue.invalid_type("record_id", { path: ["in"] }),
          ]),
        });
      });

      test(".fields() overrides in and out fields", () => {
        const before = z.table("like").relation().from("user").to("post");
        expect(before.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE like TYPE RELATION FROM user TO post SCHEMALESS;
            DEFINE FIELD id ON TABLE like TYPE any;
            DEFINE FIELD in ON TABLE like TYPE record<user>;
            DEFINE FIELD out ON TABLE like TYPE record<post>;
          `,
        );
        expect(
          before.safeParse({
            id: new RecordId("like", "123"),
            in: new RecordId("_user", "123"),
            out: new RecordId("_post", "123"),
          }),
        ).toMatchObject({
          success: false,
          error: issues([
            issue.invalid_value(["user"], { path: ["in"] }),
            issue.invalid_value(["post"], { path: ["out"] }),
          ]),
        });

        const after = before.fields({
          in: z.recordId("_user"),
          out: z.recordId("_post"),
        });
        expect(after.toSurql("define", { fields: true }).query.trim()).toEqual(
          dedent.withOptions({ alignValues: true })`
            DEFINE TABLE like TYPE RELATION FROM _user TO _post SCHEMALESS;
            DEFINE FIELD id ON TABLE like TYPE any;
            DEFINE FIELD in ON TABLE like TYPE record<_user>;
            DEFINE FIELD out ON TABLE like TYPE record<_post>;
          `,
        );
        expect(
          after.safeParse({
            id: new RecordId("like", "123"),
            in: new RecordId("_user", "123"),
            out: new RecordId("_post", "123"),
          }),
        ).toMatchObject({
          success: true,
          data: {
            id: new RecordId("like", "123"),
            in: new RecordId("_user", "123"),
            out: new RecordId("_post", "123"),
          },
        });
      });
    });

    test(".normal()", () => {
      const schema = z.table("like").normal();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE NORMAL SCHEMALESS;
        `,
      );
    });

    test(".any()", () => {
      const schema = z.table("like").normal().any();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE ANY SCHEMALESS;
        `,
      );
    });

    test(".comment()", () => {
      const schema = z.table("like").comment("This is a like table");
      expect(schema.toSurql("define").query.trim()).toMatch(
        /^DEFINE TABLE like TYPE ANY SCHEMALESS COMMENT \$bind__\d+;$/i,
      );
    });

    test(".schemafull()", () => {
      const schema = z.table("like").schemafull();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE ANY SCHEMAFULL;
        `,
      );
    });

    test(".schemaless()", () => {
      const schema = z.table("like").schemaless();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE ANY SCHEMALESS;
        `,
      );
    });

    test(".drop()", () => {
      const schema = z.table("like").drop();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE ANY DROP SCHEMALESS;
        `,
      );
    });

    test(".nodrop()", () => {
      const schema = z.table("like").drop().nodrop();
      expect(schema.toSurql("define").query.trim()).toEqual(
        dedent.withOptions({ alignValues: true })`
          DEFINE TABLE like TYPE ANY SCHEMALESS;
        `,
      );
    });

    test(".record()", () => {
      const schema = z.table("like").record();
      expect(schema.safeParse(new RecordId("_like", "123"))).toMatchObject({
        success: false,
        error: issues([issue.invalid_value(["like"])]),
      });
    });

    test(".dto() - schemaless", () => {
      const schema = z.table("like").fields({
        name: z.string(),
      });
      expect(
        schema.safeParse({
          name: "John Doe",
          age: 99,
        }),
      ).toMatchObject({
        success: false,
        error: issues([issue.invalid_type("record_id", { path: ["id"] })]),
      });

      const dtoSchema = schema.dto();
      expect(dtoSchema.safeParse({ name: "John Doe", age: 99 })).toMatchObject({
        success: true,
        data: { name: "John Doe", age: 99 },
      });
      expect(
        dtoSchema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 99,
        }),
      ).toMatchObject({
        success: false,
        error: issues([issue.invalid_value(["like"], { path: ["id"] })]),
      });
    });

    test(".dto() - schemafull", () => {
      const schema = z.table("like").schemafull().fields({
        name: z.string(),
      });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 99,
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_value(["like"], { path: ["id"] }),
          issue.unrecognized_keys(["age"]),
        ]),
      });

      const dtoSchema = schema.dto();
      expect(dtoSchema.safeParse({ name: "John Doe", age: 99 })).toMatchObject({
        success: false,
        error: issues([issue.unrecognized_keys(["age"])]),
      });
      expect(
        dtoSchema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 99,
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_value(["like"], { path: ["id"] }),
          issue.unrecognized_keys(["age"]),
        ]),
      });
    });

    test(".extend()", () => {
      const schema = z
        .table("like")
        .fields({
          name: z.string(),
        })
        .extend({
          age: z.number(),
        });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_value(["like"], { path: ["id"] }),
          issue.invalid_type("number", { path: ["age"] }),
        ]),
      });
    });

    test(".safeExtend()", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
        })
        .safeExtend({
          age: z.number(),
        });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: "18",
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_value(["like"], { path: ["id"] }),
          issue.invalid_type("number", { path: ["age"] }),
        ]),
      });
    });

    test(".pick() - id included by default", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .pick({ name: true });
      expect(
        schema.safeParse({
          id: new RecordId("like", "123"),
          name: "John Doe",
        }),
      ).toMatchObject({
        success: true,
        data: { id: new RecordId("like", "123"), name: "John Doe" },
      });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 18,
          active: true,
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_value(["like"], { path: ["id"] }),
          issue.unrecognized_keys(["age", "active"]),
        ]),
      });
    });

    test(".pick() - without id ", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .pick({ id: false, name: true });
      expect(
        schema.safeParse({
          id: new RecordId("like", "123"),
          name: "John Doe",
          age: 18,
          active: true,
        }),
      ).toMatchObject({
        success: false,
        error: issues([issue.unrecognized_keys(["id", "age", "active"])]),
      });
    });

    test(".omit() - id included by default", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .omit({ age: true });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 18,
          active: true,
        }),
      ).toMatchObject({
        success: false,
        error: issues([
          issue.unrecognized_keys(["age"]),
          issue.invalid_value(["like"], { path: ["id"] }),
        ]),
      });
    });
    test(".omit() - without id", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .omit({ id: true, age: true });
      expect(
        schema.safeParse({
          id: new RecordId("_like", "123"),
          name: "John Doe",
          age: 18,
          active: true,
        }),
      ).toMatchObject({
        success: false,
        error: issues([issue.unrecognized_keys(["id", "age"])]),
      });
    });

    test(".partial() - id not marked as optional by default", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .partial();
      expect(schema.safeParse({})).toMatchObject({
        success: false,
        error: issues([issue.invalid_type("record_id", { path: ["id"] })]),
      });
    });

    test(".partial() - partial all fields + id", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .partial(true);
      expect(schema.safeParse({})).toMatchObject({
        success: true,
        data: {},
      });
    });

    test(".partial() - partial id + mask", () => {
      const schema = z
        .table("like")
        .schemafull()
        .fields({
          id: z.recordId("like").type(z.number()),
          name: z.string(),
          age: z.number(),
          active: z.boolean(),
        })
        .partial({ id: true, age: true, active: true });
      expect(schema.safeParse({})).toMatchObject({
        success: false,
        error: issues([issue.invalid_type("string", { path: ["name"] })]),
      });
    });

    test(".required()", () => {
      const before = z.table("like").schemafull().fields({
        name: z.string(),
        age: z.number().optional(),
        active: z.boolean().optional(),
      });
      expect(before.safeParse({})).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_type("record_id", { path: ["id"] }),
          issue.invalid_type("string", { path: ["name"] }),
        ]),
      });

      const after = before.required();
      expect(after.safeParse({})).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_type("record_id", { path: ["id"] }),
          issue.invalid_type("string", { path: ["name"] }),
          issue.invalid_type("nonoptional", { path: ["age"] }),
          issue.invalid_type("nonoptional", { path: ["active"] }),
        ]),
      });
    });

    test(".required() - with mask", () => {
      const before = z.table("like").schemafull().fields({
        name: z.string(),
        age: z.number().optional(),
        active: z.boolean().optional(),
      });
      const after = before.required({ age: true, active: true });
      expect(after.safeParse({})).toMatchObject({
        success: false,
        error: issues([
          issue.invalid_type("record_id", { path: ["id"] }),
          issue.invalid_type("string", { path: ["name"] }),
          issue.invalid_type("nonoptional", { path: ["age"] }),
          issue.invalid_type("nonoptional", { path: ["active"] }),
        ]),
      });
    });
  });

  // describe("object", () => {
  //   describe("schemafull table", () => {
  //     defineTest(
  //       "strict object { name: string, age: number }",
  //       sz
  //         .table("user")
  //         .fields({
  //           test: sz.object({ name: sz.string(), age: sz.number() }).strict(),
  //         })
  //         .schemafull(),
  //       {
  //         children: [
  //           { name: "id", type: "any" },
  //           {
  //             name: "test",
  //             type: "object",
  //             children: [
  //               { name: "name", type: "string" },
  //               { name: "age", type: "number" },
  //             ],
  //           },
  //         ],
  //       },
  //     );

  //     defineTest(
  //       "loose object { name: string, age: number }",
  //       sz
  //         .table("user")
  //         .fields({
  //           test: sz.object({ name: sz.string(), age: sz.number() }).loose(),
  //         })
  //         .schemafull(),
  //       {
  //         children: [
  //           { name: "id", type: "any" },
  //           {
  //             name: "test",
  //             type: "object FLEXIBLE",
  //             children: [
  //               { name: "name", type: "string" },
  //               { name: "age", type: "number" },
  //             ],
  //           },
  //         ],
  //       },
  //     );
  //   });
  // });

  // defineTest("array<bool>", [z.array(z.boolean()), z.boolean().array()], {
  //   type: "array<bool>",
  //   tests: {
  //     passing: [
  //       { value: [] },
  //       { value: [true, false] },
  //       { value: [false, true] },
  //       { value: [true, false, true] },
  //     ],
  //     failing: [{ value: [123], error: /expected `bool` but found `123`/i }],
  //   },
  // });

  // defineTest("string [min:1]", z.string().min(1), {
  //   type: "string",
  //   asserts: [checkMap.min_length("test", 1, "string")],
  //   tests: {
  //     passing: [{ value: "Hello World" }],
  //     failing: [
  //       {
  //         value: "",
  //         error: /must be at least 1 characters? long/i,
  //       },
  //     ],
  //   },
  // });

  // defineTest("string [max:10]", z.string().max(10), {
  //   type: "string",
  //   asserts: [checkMap.max_length("test", 10, "string")],
  //   tests: {
  //     passing: [{ value: "Hello" }],
  //     failing: [
  //       {
  //         value: "Hello World Hello World",
  //         error: /must be at most 10 characters? long/i,
  //       },
  //     ],
  //   },
  // });

  // defineTest("string [min:1 max:10]", z.string().min(1).max(10), {
  //   type: "string",
  //   asserts: [
  //     checkMap.min_length("test", 1, "string"),
  //     checkMap.max_length("test", 10, "string"),
  //   ],
  //   tests: {
  //     passing: [{ value: "Hello" }],
  //     failing: [
  //       {
  //         value: "",
  //         error: /must be at least 1 characters? long/i,
  //       },
  //       {
  //         value: "12345678901",
  //         error: /must be at most 10 characters? long/i,
  //       },
  //     ],
  //   },
  // });

  // defineTest("string [length:10]", z.string().length(10), {
  //   type: "string",
  //   asserts: [checkMap.length_equals("test", 10)],
  //   tests: {
  //     passing: [{ value: "1234567890" }],
  //     failing: [
  //       { value: "123456789", error: /must be exactly 10 characters? long/i },
  //       { value: "12345678901", error: /must be exactly 10 characters? long/i },
  //     ],
  //   },
  // });

  // defineTest("string [format:email]", [z.string().email(), z.email()], {
  //   type: "string",
  //   asserts: [checkMap.string_format.email("test")],
  //   tests: {
  //     passing: [
  //       { value: "test@example.com" },
  //       { value: "test+test@example.com" },
  //       { value: "test.test@example.com" },
  //     ],
  //     failing: [
  //       { value: "test", error: /must be a valid email address/i },
  //       { value: "test@", error: /must be a valid email address/i },
  //       { value: "@example", error: /must be a valid email address/i },
  //       { value: "@example.com", error: /must be a valid email address/i },
  //       { value: "test@example", error: /must be a valid email address/i },
  //       { value: "test@example", error: /must be a valid email address/i },
  //       { value: ".test@example", error: /must be a valid email address/i },
  //       { value: "te..st@example", error: /must be a valid email address/i },
  //     ],
  //   },
  // });

  // defineTest("string [format:url]", [z.string().url(), z.url()], {
  //   type: "string",
  //   asserts: [checkMap.string_format.url("test")],
  //   tests: {
  //     passing: [
  //       { value: "http://example" },
  //       { value: "http://example.com" },
  //       { value: "http://example.com/api/users" },
  //       { value: "http://example.com/api/users?page=1&limit=10#data" },
  //       { value: "http://example.com/api/users#data" },
  //       { value: "http://example.com/api/users?page=1&limit=10#data" },
  //       { value: "file:/" },
  //       { value: "file:/path/to/file" },
  //       { value: "file:///path/to/file" },
  //     ],
  //     failing: [
  //       { value: "http", error: /must be a valid URL/i },
  //       { value: "http:", error: /must be a valid URL/i },
  //       { value: "http:/", error: /must be a valid URL/i },
  //       { value: "http://", error: /must be a valid URL/i },
  //     ],
  //   },
  // });

  // defineTest(
  //   `string [format:url(protocol:${/https?/})`,
  //   [z.string().url({ protocol: /https?/ }), z.url({ protocol: /https?/ })],
  //   {
  //     type: "string",
  //     asserts: [checkMap.string_format.url("test", { protocol: /https?/ })],
  //     tests: {
  //       passing: [{ value: "https://example.com" }],
  //       failing: [
  //         {
  //           value: "ftp://example.com",
  //           error: /must match protocol \/https\?\//i,
  //         },
  //       ],
  //     },
  //   },
  // );

  // defineTest(
  //   `string [format:url(hostname:${/example\.com/})`,
  //   [
  //     z.string().url({ hostname: /example\.com/ }),
  //     z.url({ hostname: /example\.com/ }),
  //   ],
  //   {
  //     type: "string",
  //     asserts: [
  //       checkMap.string_format.url("test", { hostname: /example\.com/ }),
  //     ],
  //     tests: {
  //       passing: [
  //         { value: "https://example.com" },
  //         { value: "http://example.com" },
  //         { value: "http://example.com:8080" },
  //         { value: "http://www.example.com" },
  //       ],
  //       failing: [
  //         {
  //           value: "http://example.es",
  //           error: /must match hostname \/example\\\.com\//i,
  //         },
  //       ],
  //     },
  //   },
  // );

  // defineTest(
  //   `string [format:url(normalize, protocol:${/https?/})`,
  //   [
  //     z.string().url({ normalize: true, protocol: /https?/ }),
  //     z.url({ normalize: true, protocol: /https?/ }),
  //   ],
  //   {
  //     type: "string",
  //     transforms: [
  //       checkMap.string_format.url("test", {
  //         normalize: true,
  //         protocol: /https?/,
  //       }),
  //     ],
  //     tests: {
  //       passing: [
  //         { value: "https://example.com", equals: "https://example.com/" },
  //         { value: "http://example.com", equals: "http://example.com/" },
  //         { value: "https://example.com:443", equals: "https://example.com/" },
  //         { value: "http://example.com:80", equals: "http://example.com/" },
  //         {
  //           value: "https://example.com:8443",
  //           equals: "https://example.com:8443/",
  //         },
  //         {
  //           value: "http://example.com:8080",
  //           equals: "http://example.com:8080/",
  //         },
  //         {
  //           value: "https:example.com:8443",
  //           equals: "https://example.com:8443/",
  //         },
  //       ],
  //       failing: [
  //         {
  //           value: "ftp://example.com",
  //           error: /must match protocol \/https\?\//i,
  //         },
  //       ],
  //     },
  //   },
  // );

  // defineTest(
  //   `string [format:url(normalize, hostname:${/example\.com/})`,
  //   [
  //     z.string().url({ normalize: true, hostname: /example\.com/ }),
  //     z.url({ normalize: true, hostname: /example\.com/ }),
  //   ],
  //   {
  //     type: "string",
  //     transforms: [
  //       checkMap.string_format.url("test", {
  //         normalize: true,
  //         hostname: /example\.com/,
  //       }),
  //     ],
  //     tests: {
  //       passing: [
  //         { value: "https://example.com", equals: "https://example.com/" },
  //         { value: "http://example.com", equals: "http://example.com/" },
  //         { value: "https://example.com:443", equals: "https://example.com/" },
  //         { value: "http://example.com:80", equals: "http://example.com/" },
  //       ],
  //     },
  //   },
  // );

  // defineTest(`array<string>`, [z.array(z.string()), z.string().array()], {
  //   type: "array<string>",
  //   tests: {
  //     passing: [{ value: ["Hello World"] }, { value: ["Hello", "World"] }],
  //     failing: [{ value: [123], error: /expected `string` but found `123`/i }],
  //   },
  // });

  // defineTest(
  //   "array<option<string>>",
  //   [z.array(z.string().optional()), z.optional(z.string()).array()],
  //   {
  //     type: "array<option<string>>",
  //     tests: {
  //       passing: [
  //         { value: ["Hello World", undefined] },
  //         { value: ["Hello", "World", undefined] },
  //       ],
  //       failing: [
  //         { value: [123], error: /expected `none | string` but found `123`/i },
  //       ],
  //     },
  //   },
  // );

  // defineTest("array<number>", [z.array(z.number()), z.number().array()], {
  //   type: "array<number>",
  //   tests: {
  //     passing: [
  //       testCase({
  //         value: [
  //           123,
  //           123.456,
  //           123.456789,
  //           12345n,
  //           12345678901234567n,
  //           new Decimal(12345678901234567n),
  //         ],
  //         check(value) {
  //           expect(value.slice(0, -1)).toEqual([
  //             123,
  //             123.456,
  //             123.456789,
  //             12345,
  //             12345678901234567n,
  //           ]);
  //           expect((value.at(-1) as Decimal).toJSON()).toEqual(
  //             new Decimal(12345678901234567n).toJSON(),
  //           );
  //         },
  //       }),
  //     ],
  //   },
  // });

  // defineTest("object { name: string }", z.object({ name: z.string() }), {
  //   type: "object",
  //   children: [
  //     {
  //       name: "name",
  //       type: "string",
  //     },
  //   ],
  //   debug: true,
  //   tests: {
  //     passing: [{ value: { name: "Manuel" } }],
  //   },
  // });

  // defineTest(
  //   "object { name: string, age: number }",
  //   z.object({ name: z.string(), age: z.number() }),
  //   {
  //     type: "object",
  //     children: [
  //       {
  //         name: "name",
  //         type: "string",
  //       },
  //       {
  //         name: "age",
  //         type: "number",
  //       },
  //     ],
  //   },
  // );

  // defineTest(
  //   "nested object",
  //   z.object({
  //     name: z.object({
  //       given: z.string().min(1).max(50),
  //       middle: z.string().max(50).optional(),
  //       family: z.string().min(1).max(50),
  //       prefix: z.string().max(10).optional(),
  //       suffix: z.string().max(10).optional(),
  //     }),
  //     address: z.object({
  //       street: z.string().min(1),
  //       unit: z.string().optional(),
  //       city: z.string().min(1),
  //       state: z.string().length(2),
  //       postalCode: z.string().min(5).max(10),
  //       country: z.string().length(2),
  //       coordinates: z
  //         .object({
  //           latitude: z.number().min(-90).max(90),
  //           longitude: z.number().min(-180).max(180),
  //         })
  //         .optional(),
  //     }),
  //   }),
  //   {
  //     type: "object",
  //     children: [
  //       {
  //         name: "name",
  //         type: "object",
  //         children: [
  //           {
  //             name: "given",
  //             type: "string",
  //             asserts: [
  //               checkMap.min_length("test.name.given", 1, "string"),
  //               checkMap.max_length("test.name.given", 50, "string"),
  //             ],
  //           },
  //           {
  //             name: "middle",
  //             type: "option<string>",
  //             asserts: [checkMap.max_length("test.name.middle", 50, "string")],
  //           },
  //           {
  //             name: "family",
  //             type: "string",
  //             asserts: [
  //               checkMap.min_length("test.name.family", 1, "string"),
  //               checkMap.max_length("test.name.family", 50, "string"),
  //             ],
  //           },
  //           {
  //             name: "prefix",
  //             type: "option<string>",
  //             asserts: [checkMap.max_length("test.name.prefix", 10, "string")],
  //           },
  //           {
  //             name: "suffix",
  //             type: "option<string>",
  //             asserts: [checkMap.max_length("test.name.suffix", 10, "string")],
  //           },
  //         ],
  //       },
  //       {
  //         name: "address",
  //         type: "object",
  //         children: [
  //           {
  //             name: "street",
  //             type: "string",
  //             asserts: [
  //               checkMap.min_length("test.address.street", 1, "string"),
  //             ],
  //           },
  //           {
  //             name: "unit",
  //             type: "option<string>",
  //           },
  //           {
  //             name: "city",
  //             type: "string",
  //             asserts: [checkMap.min_length("test.address.city", 1, "string")],
  //           },
  //           {
  //             name: "state",
  //             type: "string",
  //             asserts: [checkMap.length_equals("test.address.state", 2)],
  //           },
  //           {
  //             name: "postalCode",
  //             type: "string",
  //             asserts: [
  //               checkMap.min_length("test.address.postalCode", 5, "string"),
  //               checkMap.max_length("test.address.postalCode", 10, "string"),
  //             ],
  //           },
  //           {
  //             name: "country",
  //             type: "string",
  //             asserts: [checkMap.length_equals("test.address.country", 2)],
  //           },
  //           {
  //             name: "coordinates",
  //             type: "option<object>",
  //             children: [
  //               {
  //                 name: "latitude",
  //                 type: "number",
  //                 asserts: [
  //                   checkMap.greater_than(
  //                     "test.address.coordinates.latitude",
  //                     -90,
  //                     true,
  //                   ),
  //                   checkMap.less_than(
  //                     "test.address.coordinates.latitude",
  //                     90,
  //                     true,
  //                   ),
  //                 ],
  //               },
  //               {
  //                 name: "longitude",
  //                 type: "number",
  //                 asserts: [
  //                   checkMap.greater_than(
  //                     "test.address.coordinates.longitude",
  //                     -180,
  //                     true,
  //                   ),
  //                   checkMap.less_than(
  //                     "test.address.coordinates.longitude",
  //                     180,
  //                     true,
  //                   ),
  //                 ],
  //               },
  //             ],
  //           },
  //         ],
  //       },
  //     ],
  //   },
  // );

  // defineTest("array<object>", [z.array(z.object({})), z.object({}).array()], {
  //   type: "array<object>",
  //   debug: true,
  //   tests: {
  //     passing: [
  //       testCase({
  //         value: [],
  //       }),
  //       testCase({
  //         value: [
  //           {
  //             name: "Manuel",
  //           },
  //           {
  //             name: "David",
  //           },
  //         ],
  //       }),
  //     ],
  //   },
  // });

  // // defineTest("array", [z.array(z.any()), z.any().array()], {
  // //   type: "array<any>",
  // // });

  // // test.each([
  // //   // <expected>, <schema>
  // //   // ----------------------
  // //   // ["object", z.object()],
  // //   // ["number", z.number()],
  // //   // // ['["asd", "qwe"]', z.tuple([z.literal('asd'), z.literal('qwe')])]
  // //   // [
  // //   //   "option<string>",
  // //   //   [z.string().optional(), z.string().optional().nonoptional().optional()],
  // //   // ],
  // //   // ["string | NULL", z.string().nullable()],
  // //   // ["string", z.base64()],
  // //   // ["string", z.base64url()],
  // //   // ["array<any>", z.any().array()],
  // //   // // ['range', sz.range()],
  // //   // // ["record", sz.record()],
  // //   // // ["record<user>", z.record(['user'])],
  // //   // // ["record<user | administrator>", sz.record(['user', 'administrator'])],
  // //   // // ["set", z.set(z.any())],
  // //   // // ["set<string>", z.set(z.string())],
  // //   // // ["set<string, 10>", z.set(z.string()).max(10)],
  // //   // ["string", [z.string(), z.string().optional().nonoptional()]],
  // //   // ["NONE", z.undefined()],
  // //   // ["NONE | NULL", z.undefined().nullable()],
  // // ])("%s", async (typeName, _schemas) => {
  // //   const schemas = Array.isArray(_schemas) ? _schemas : [_schemas];
  // //   for (let i = 0; i < schemas.length; i++) {
  // //     // biome-ignore lint/style/noNonNullAssertion: bounds accounted for
  // //     const schema = schemas[i]!;
  // //     const type = zodTypeToSurrealType(schema, [], {
  // //       transforms: [],
  // //       asserts: [],
  // //       children: [],
  // //       rootSchema: schema,
  // //       table: new Table("test"),
  // //       name: `test_${i}`,
  // //     });
  // //     expect(type).toBe(typeName);
  // //     await surreal.query(
  // //       `DEFINE FIELD test_${i} ON TABLE client TYPE ${type};`,
  // //     );
  // //   }
  // // });

  // describe("default values", () => {
  //   defineTest(
  //     "string [default: 'Hello World']",
  //     z.string().default("Hello World"),
  //     {
  //       type: "string",
  //       default: { value: "Hello World" },
  //       tests: {
  //         passing: [{ value: undefined, equals: "Hello World" }],
  //       },
  //     },
  //   );
  // });

  // defineTest("record", z.recordId(), {
  //   type: "record",
  //   tests: [
  //     testCase({ value: new RecordId("test", "123") }),
  //     testCase({
  //       value: "123",
  //       error: /expected `record` but found `'123'`/i,
  //     }),
  //   ],
  // });

  // defineTest("record<user | admin>", z.recordId(["user", "admin"]), {
  //   type: "record<user | admin>",
  //   tests: [
  //     testCase({
  //       value: new RecordId("user", "123"),
  //       check(value) {
  //         expect(value.table.name).toBe("user");
  //         expect(value.id).toBe("123");
  //       },
  //     }),
  //     testCase({
  //       value: new RecordId("admin", "123"),
  //       check(value) {
  //         expect(value.table.name).toBe("admin");
  //         expect(value.id).toBe("123");
  //       },
  //     }),
  //     testCase({
  //       value: new RecordId("test", "123"),
  //       error:
  //         /expected `record<user\|admin>` but found `test:\u27e8123\u27e9`/i,
  //     }),
  //     testCase({
  //       value: "123",
  //       error: /expected `record<user\|admin>` but found `'123'`/i,
  //     }),
  //   ],
  // });

  // //////////////////////////////////////////
  // /////////      Table Tests      //////////
  // //////////////////////////////////////////

  // describe("table", () => {
  //   defineTest(
  //     "schemafull",
  //     z.table("user").schemafull().fields({
  //       name: z.string(),
  //     }),
  //     {
  //       children: [
  //         {
  //           name: "id",
  //           type: "any",
  //         },
  //         {
  //           name: "name",
  //           type: "string",
  //         },
  //       ],
  //       tests: [
  //         testCase({
  //           value: { name: "John Doe" },
  //         }),
  //         testCase({
  //           value: { name: "John Doe", age: 17 },
  //           error: /no such field exists for table/i,
  //         }),
  //       ],
  //     },
  //   );

  //   defineTest(
  //     "schemaless",
  //     z.table("user").schemaless().fields({
  //       name: z.string(),
  //     }),
  //     {
  //       children: [
  //         {
  //           name: "id",
  //           type: "any",
  //         },
  //         {
  //           name: "name",
  //           type: "string",
  //         },
  //       ],
  //       tests: [
  //         testCase({
  //           value: { name: "John Doe" },
  //         }),
  //         testCase({
  //           value: { name: "John Doe", age: 17 },
  //         }),
  //       ],
  //     },
  //   );
  // });
});

// describe("backwards compatibility", () => {
//   test("email regex didn't change", () => {
//     const original =
//       /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
//     const newRegex = z.email()._zod.def.pattern as RegExp;
//     expect(newRegex).toEqual(original);
//   });
// });
