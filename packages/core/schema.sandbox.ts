import {
  Surreal,
  DateTime,
  Decimal,
  RecordId,
  Uuid,
  surql,
  Table,
  escapeIdent,
  Duration,
  Value,
  applyDiagnostics,
  createRemoteEngines,
  Future,
} from "surrealdb";
import z from "./src";

// // import { createNodeEngines } from "@surrealdb/node";
// // import z, { sz } from "./src";
// // import { defineField } from "./src/surql";

// // const Client = sz.table("client").fields({
// //   id: sz.string(),
// // });
// // const Order = sz.table("order").fields({
// //   id: sz.number(),
// // });
// // const User = sz
// //   .table("user")
// //   .schemafull()
// //   .fields({
// //     // id: sz.string(),
// //     name: sz.string(),
// //     client: Client.record().optional(),
// //     meta: sz.unknown(),
// //   })
// //   .comment("This table contains user information");

// // // const parsedUser = z.safeParse(User, {
// // //   id: new RecordId("user", "123"),
// // //   name: "John Doe",
// // // });
// // // parsedUser.data;
// // // console.log(parsedUser);
// // // console.log("-".repeat(80));

const surreal = new Surreal({
  // engines: applyDiagnostics(createRemoteEngines(), (event) => {
  //   console.log("event:", event);
  // }),
});

await surreal.connect("ws://127.0.0.1:8000", {
  authentication: {
    username: "root",
    password: "Welc0me123.",
  },
  namespace: "main",
  database: "main",
});

// // await surreal.use({ namespace: "test", database: "test" });

// // const input = "a";

// // const withAny = z.recordId("user").type(z.tuple([z.string(), z.number()]));
// // const schema = z
// //   .table("bought")
// //   .relation()
// //   // .from(z.recordId("user").type(z.string()))
// //   // .to(z.recordId("order").type(z.number()))
// //   .fields({
// //     id: z.recordId(["user", "order"]).type(z.number().array()),
// //     name: z.string(),
// //     // in: z.recordId("client").type(z.string()),
// //     // out: z.recordId("product").type(z.number()),
// //     age: z.number(),
// //     meta: z.object({
// //       created_at: z.date(),
// //       updated_at: z.date(),
// //     }),
// //   })
// //   // .schemafull()
// //   .extend({
// //     address: z.object({
// //       street: z.string(),
// //       city: z.string(),
// //       state: z.string(),
// //       zip: z.string(),
// //     }),
// //   })
// //   .partial({ in: true });
// ////////////////////////////////////////////////////////////////////////////
// // const id = new RecordId("u:s:e:r", [1, 2, 3]);
// // const result = await surreal
// //   .query(surql`SELECT * FROM [{
// //     hardcoded: ⟨u:s:e:r⟩:[1,2,3],
// //     param: ${id},
// //     string: ${z.recordId().fromString(id.toJSON())},
// //     string_from: ${z.recordId().fromString("⟨u:s:e:r⟩:[1, 2, 3]")}
// //   }]`)
// //   .collect<
// //     [
// //       {
// //         hardcoded: RecordId;
// //         param: RecordId;
// //         string: RecordId;
// //         string_from: RecordId;
// //       }[],
// //     ]
// //   >()
// //   .then(([[r]]) => r);

// // for (const property in result) {
// //   console.log(
// //     `${property}:`,
// //     result[property],
// //     "equals:",
// //     result[property].equals(id),
// //   );
// // }
// // console.log("--------------------------------");

// // console.log("id.toJSON():", id.toJSON());
// // console.log("--------------------------------");
// // const fromString = z.recordId().fromString(id.toJSON());
// // console.log("fromString:", fromString);
// // console.log("fromString.toJSON():", fromString.toJSON());
// // console.log("--------------------------------");
// ////////////////////////////////////////////////////////////////////////////

// const duration = new Duration("1d").add(new Duration("364d"));
// console.log(duration);
// // console.log(z.recordId().fromString(`user:[9007199254740993.1f,-2.5dec,3]`));

// // console.log(Number("90071992547409934234234234") > Number.MAX_SAFE_INTEGER);
// ////////////////////////////////////////////////////////////////////////////
// // const [result] = await surreal.query<[RecordId]>(surql`${source}`).collect();
// // console.log("fromDb:", result);
// // console.log("fromDb.toJSON():", result.toJSON());
// // console.log("--------------------------------");
// // console.log(z.recordId().fromString(`user:123`));
// // console.log(z.recordId().fromString(`user:\`123\``));
// // console.log(z.recordId().fromString(`user:⟨123⟩`));
// // console.log(z.recordId().fromString(`\`user\`:123`));
// // console.log(z.recordId().fromString(`\`user\`:\`123\``));
// // console.log(z.recordId().fromString(`\`user\`:⟨123⟩`));
// // console.log(z.recordId().fromString(`⟨us⟩er⟩:123`));
// // console.log(z.recordId().fromString(`⟨user⟩:\`123\``));
// // console.log(z.recordId().fromString(`⟨user⟩:⟨123⟩`));

// // // ---- Unrestricted ----
// // // accept only RecordId instances
// // z.recordId().from(new RecordId("user", "123"));
// // z.recordId().from(new RecordId("user", 123));
// // // accept from table and value variant
// // z.recordId().from("user", "123");
// // z.recordId().from("user", 123);
// // // ERROR: dont accept from value variant
// // z.recordId().from(
// //   // @ts-expect-error
// //   "123",
// // );
// // z.recordId().from(
// //   // @ts-expect-error
// //   123,
// // );

// // // ---- Restricted Table ----
// // // Accept any value with table "user"
// // z.recordId().table("user").from("user", "123");
// // z.recordId().table("user").from("user", 123);
// // // Can accept just value and table will be inferred
// // z.recordId().table("user").from("123");
// // z.recordId().table("user").from(123);
// // // Will accept RecordId instances
// // z.recordId().table("user").from(new RecordId("user", "123"));
// // z.recordId().table("user").from(new RecordId("user", 123));
// // // ERROR: Fails with other table
// // z.recordId().table("user").from(
// //   // @ts-expect-error
// //   "test",
// //   "123",
// // );
// // z.recordId().table("user").from(
// //   // @ts-expect-error
// //   "test",
// //   123,
// // );
// // // ERROR: Will not accept RecordId with other table
// // z.recordId().table("user").from(
// //   // @ts-expect-error
// //   new RecordId("test", "123"),
// // );
// // z.recordId().table("user").from(
// //   // @ts-expect-error
// //   new RecordId("test", 123),
// // );

// // // ---- Restricted Multiple Tables ----
// // // Accept any value with tables "user" or "admin"
// // z.recordId().table(["user", "admin"]).from("user", "123");
// // z.recordId().table(["user", "admin"]).from("user", 123);
// // z.recordId().table(["user", "admin"]).from("admin", "123");
// // z.recordId().table(["user", "admin"]).from("admin", 123);
// // // Will accept RecordId instances
// // z.recordId().table(["user", "admin"]).from(new RecordId("user", "123"));
// // z.recordId().table(["user", "admin"]).from(new RecordId("user", 123));
// // z.recordId().table(["user", "admin"]).from(new RecordId("admin", "123"));
// // z.recordId().table(["user", "admin"]).from(new RecordId("admin", 123));
// // // ERROR: Fails with other table
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   "test",
// //   "123",
// // );
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   "test",
// //   123,
// // );
// // // ERROR: Won't accept just value variant
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   "123",
// // );
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   123,
// // );
// // // ERROR: Won't accept RecordId with other table
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   new RecordId("test", "123"),
// // );
// // z.recordId().table(["user", "admin"]).from(
// //   // @ts-expect-error
// //   new RecordId("test", 123),
// // );

// // // ---- Restricted Value ----
// // // Accept RecordId with any table but right type
// // z.recordId().value(z.string()).from(new RecordId("user", "123"));
// // // ERROR: Won't accept RecordId with wrong value type
// // z.recordId().value(z.string()).from(
// //   // @ts-expect-error
// //   new RecordId("user", 123),
// // );
// // // ERROR: Won't accept id only variant
// // z.recordId().value(z.string()).from(
// //   // @ts-expect-error
// //   "123",
// // );
// // z.recordId().value(z.string()).from(
// //   // @ts-expect-error
// //   123,
// // );
// // // Accept from table and value variant
// // z.recordId().value(z.string()).from("user", "123");
// // // ERROR: Won't accept table and id variants with wrong value type
// // z.recordId().value(z.string()).from(
// //   "user",
// //   // @ts-expect-error
// //   123,
// // );

// // const result = schema.safeParse({
// //   // name: "John Doe",
// //   // age: 18,
// //   // in: new RecordId("employee", "123"),
// //   // out: new RecordId("order", 456),
// //   // meta: {
// //   //   created_at: new Date("2025-01-01T00:00:00Z"),
// //   //   updated_at: new Date("2025-01-01T00:00:00Z"),
// //   // },
// // });
// // console.log(result.data!.);
// // console.log(schema.safeParse(new RecordId("test", "123")));

// // const schema = sz.recordId().type(z.null());
// // console.log(sz.recordId().isOptional);
// // const result = defineField("name", "user", schema);
// // console.log(result.query);

// // function format(value: string | number | bigint | Decimal) {
// //   const suffix =
// //     value instanceof Float
// //       ? "f"
// //       : value instanceof Decimal
// //         ? "dec"
// //         : typeof value === "bigint"
// //           ? "n"
// //           : "";
// //   return `\x1b[33m${value}${suffix}\x1b[0m`;
// // }

// // const [result] = await surreal
// //   .query(surql`
// //     ${new FileRef("root", "hello.txt")}
// //   `)
// //   .collect();

// // user.meta = undefined;
// // const [updated] = await surreal
// //   .query(surql`UPDATE ONLY user:1 MERGE ${user}`)
// //   .collect();
// // console.log("Updated user:", updated);

// // const schema = z.intersection(
// //   z.object({ name: z.string(), age: z.bigint() }),
// //   z.object({ name: z.string(), age: z.number().optional() }),
// // );
// // type Prettify<T> = {
// //   [K in keyof T]: T[K];
// // };
// // type Result = Prettify<z.output<typeof schema>>;
// // //    ^?

// // console.log(defineField("name", "user", schema).query);
// // console.log(
// //   schema.safeParse({
// //     name: "John Doe",
// //     age: 18,
// //   }),
// // );

// // const value = new Decimal("0.125");
// // const parts = value.toParts();
// // console.log("       int:", parts.int);
// // console.log("      frac:", parts.frac);
// // console.log("     scale:", parts.scale);
// // console.log("--------------------------------");
// // console.log("    bigint:", value.toBigInt());
// // console.log("scientific:", value.toScientific());
// // console.log("    string:", value.toString());

// // await surreal.connect("ws://127.0.0.1:8000", {
// //   authentication: {
// //     username: "root",
// //     password: "Welc0me123.",
// //   },
// //   namespace: "test",
// //   database: "test",
// // });
// // // await surreal.query(`REMOVE DATABzASE IF EXISTS test`);
// // // const query = User.toSurql("define");
// // // console.log(query.query);
// // // console.log(await surreal.query(query).collect());
// // // // console.log(
// // // //   inspect(await surreal.query(User.toSurql("structure")).collect(), {
// // // //     colors: true,
// // // //   }),
// // // // );
// // const schema = // .relation()
// //   sz
// //     .table("user")
// //     // .relation()
// //     // .from(Client.record())
// //     // .to(Order.record())
// //     // .schemafull()
// //     // .schemaless()
// //     // .drop()
// //     .fields({
// //       id: sz.any(),
// //       name: sz.string(),
// //       age: sz.number().optional().optional(),
// //     });

// // // schema._zod.def.fields.

// // const query = schema.toSurql("define", { exists: "overwrite", fields: true });
// // console.log(query.query);
// // const [result] = await surreal.query(query).collect();
// // console.log(result);
// // // const result = schema.parse("Hello World");
// // // console.log(result);

const date = z.date().$default(surql`time::now()`);
console.log(date.decode(undefined));

// // Id
// console.log(
//   z
//     .recordId()
//     .table("client")
//     // .type(z.tuple([z.number(), z.string()]))
//     .decodeId("123"),
// );

// console.log(
//   z
//     .recordId()
//     .table(["client", 'user'])
//     .type(z.tuple([z.number(), z.string()]))
//     .decode("client", "123"),
// );

//
// console.log(z.date().safeParse(new Date("2024-01-01T00:00:00.000Z")));
// console.log(z.date().safeParse("2024-01-01T00:00:00.000Z"));
