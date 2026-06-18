/** Foreign keys: s.references, referential actions, and the table.record() helper. */
import { type ExampleGroup, example } from "./_kit";

export const group: ExampleGroup = {
  file: "05-constraints.ts",
  about: "FOREIGN KEY — s.references, ON DELETE/UPDATE actions, table.record()",
  examples: [
    example({
      title: "foreign key (s.references) -> text column + FK to ref(id)",
      note: "the FK is its own kind (deps -> [table, refTable]), so it emits after both tables",
      code: `[
  defineTable("usr", { name: s.text() }),
  defineTable("post", { author: s.references("usr") }),
]`,
      ddl: `CREATE TABLE "post" (
  "id" text PRIMARY KEY,
  "author" text NOT NULL
);
CREATE TABLE "usr" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL
);
ALTER TABLE "post" ADD CONSTRAINT "post_author_fkey" FOREIGN KEY ("author") REFERENCES "usr" ("id");`,
    }),
    example({
      title: "FK with referential actions (ON DELETE / ON UPDATE)",
      note: "actions canonicalize UPPERCASE; the default NO ACTION is omitted",
      code: `[
  defineTable("usr", { name: s.text() }),
  defineTable("post", {
    author: s.references("usr", { onDelete: "cascade", onUpdate: "restrict" }),
  }),
]`,
      ddl: `CREATE TABLE "post" (
  "id" text PRIMARY KEY,
  "author" text NOT NULL
);
CREATE TABLE "usr" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL
);
ALTER TABLE "post" ADD CONSTRAINT "post_author_fkey" FOREIGN KEY ("author") REFERENCES "usr" ("id") ON DELETE CASCADE ON UPDATE RESTRICT;`,
    }),
    example({
      title: "FK via table.record() (reference another table object)",
      code: `(() => {
  const usr = defineTable("usr", { name: s.text() });
  const post = defineTable("post", { author: usr.record({ onDelete: "cascade" }) });
  return [usr, post];
})()`,
      ddl: `CREATE TABLE "post" (
  "id" text PRIMARY KEY,
  "author" text NOT NULL
);
CREATE TABLE "usr" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL
);
ALTER TABLE "post" ADD CONSTRAINT "post_author_fkey" FOREIGN KEY ("author") REFERENCES "usr" ("id") ON DELETE CASCADE;`,
    }),
  ],
};
