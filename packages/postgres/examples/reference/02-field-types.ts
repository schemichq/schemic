/** Column types: canonical scalars, pg-native parameterized types, arrays, and jsonb. */
import { type ExampleGroup, example } from "./_kit";

export const group: ExampleGroup = {
  file: "02-field-types.ts",
  about: "Column types — scalars, native(+params), arrays, jsonb",
  examples: [
    example({
      title: "canonical scalars",
      code: `defineTable("t", {
  name: s.text(),
  count: s.integer(),
  ratio: s.doublePrecision(),
  active: s.boolean(),
  created: s.timestamptz(),
  token: s.uuid(),
})`,
      ddl: `CREATE TABLE "t" (
  "id" text PRIMARY KEY,
  "active" boolean NOT NULL,
  "count" integer NOT NULL,
  "created" timestamp with time zone NOT NULL,
  "name" text NOT NULL,
  "ratio" double precision NOT NULL,
  "token" uuid NOT NULL
);`,
    }),
    example({
      title: "pg-native parameterized types",
      note: "varchar(n) / numeric(p,s) preserve their params; bigint/smallint/real are native",
      code: `defineTable("t", {
  label: s.varchar(255),
  price: s.numeric(10, 2),
  big: s.bigint(),
  small: s.smallint(),
  approx: s.real(),
})`,
      ddl: `CREATE TABLE "t" (
  "id" text PRIMARY KEY,
  "approx" real NOT NULL,
  "big" bigint NOT NULL,
  "label" varchar(255) NOT NULL,
  "price" numeric(10, 2) NOT NULL,
  "small" smallint NOT NULL
);`,
    }),
    example({
      title: "array column",
      code: `defineTable("t", { tags: s.text().array() })`,
      ddl: `CREATE TABLE "t" (
  "id" text PRIMARY KEY,
  "tags" text[] NOT NULL
);`,
    }),
    example({
      title: "jsonb (object collapses to an opaque jsonb column)",
      code: `defineTable("t", {
  meta: s.jsonb(),
  profile: s.object({ bio: s.text(), age: s.integer() }),
})`,
      ddl: `CREATE TABLE "t" (
  "id" text PRIMARY KEY,
  "meta" jsonb NOT NULL,
  "profile" jsonb NOT NULL
);`,
    }),
  ],
};
