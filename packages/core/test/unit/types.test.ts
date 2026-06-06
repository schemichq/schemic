import { describe, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { DateTime, RecordId, surql, type RecordIdValue } from "surrealdb";
import {
  relation,
  sz,
  table,
  type App,
  type Create,
  type Update,
  type Wire,
} from "../../src/pure";

const User = table("user", {
  id: z.string(), // -> record<user, string>
  name: sz.string(),
  email: sz.email(),
  bio: sz.string().optional(),
  status: sz.string().$default(surql`"pending"`),
  createdAt: sz.datetime().$default(surql`time::now()`).$readonly(),
});

describe("Create<>", () => {
  test("requires non-defaulted fields; id and DB-filled fields are optional", () => {
    expectTypeOf<Create<typeof User>>().toEqualTypeOf<{
      name: string;
      email: string;
      id?: RecordId<"user", string>;
      bio?: string | undefined;
      status?: string;
      createdAt?: Date;
    }>();
  });

  test("a payload with only required fields satisfies the type", () => {
    expectTypeOf<{ name: string; email: string }>().toExtend<Create<typeof User>>();
  });

  test("missing a required field is a type error", () => {
    // @ts-expect-error - name and email are required on create
    User.make({});
    // @ts-expect-error - email is required
    User.make({ name: "a" });
  });
});

describe("Update<>", () => {
  test("every field optional; id and readonly fields excluded", () => {
    expectTypeOf<Update<typeof User>>().toEqualTypeOf<{
      name?: string;
      email?: string;
      bio?: string | undefined;
      status?: string;
    }>();
  });

  test("readonly / id keys are rejected", () => {
    // @ts-expect-error - createdAt is readonly, excluded from updates
    User.makePartial({ createdAt: new Date() });
    // @ts-expect-error - id is excluded from updates
    User.makePartial({ id: new RecordId("user", "x") });
  });
});

describe("App<> / Wire<>", () => {
  test("app side decodes codecs; wire side keeps DB types", () => {
    expectTypeOf<App<typeof User>["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<Wire<typeof User>["createdAt"]>().toEqualTypeOf<DateTime>();
    expectTypeOf<App<typeof User>["id"]>().toEqualTypeOf<RecordId<"user", string>>();
  });

  test("relations expose typed in/out endpoints", () => {
    const Post = table("post", { id: z.string() });
    const Liked = relation("liked").from(User).to(Post);
    expectTypeOf<App<typeof Liked>["in"]>().toEqualTypeOf<RecordId<"user", RecordIdValue>>();
    expectTypeOf<App<typeof Liked>["out"]>().toEqualTypeOf<RecordId<"post", RecordIdValue>>();
  });
});

describe("field method types", () => {
  test("unwrap peels the wrapper type", () => {
    expectTypeOf(sz.string().optional().unwrap().schema).toExtend<z.ZodString>();
    expectTypeOf(sz.string().array().unwrap().schema).toExtend<z.ZodString>();
  });

  test("$default accepts a plain value or a surql expression", () => {
    sz.string().$default("x");
    sz.string().$default(surql`"x"`);
    sz.int().$default(0);
    // @ts-expect-error - value must match the field's type
    sz.int().$default("not a number");
  });
});

describe("$value create-optionality", () => {
  const T = table("t", {
    id: z.string(),
    slug: sz.string().$value(surql`string::slug($value)`), // create-required (consumes $value)
    updatedAt: sz.datetime().$value(surql`time::now()`, { optional: true }), // create-optional
  });

  test("{ optional: true } makes the field create-optional; default stays required", () => {
    expectTypeOf<Create<typeof T>>().toEqualTypeOf<{
      slug: string;
      id?: RecordId<"t", string>;
      updatedAt?: Date;
    }>();
    expectTypeOf<{ slug: string }>().toExtend<Create<typeof T>>();
  });

  test("make enforces the create-required slug; create-optional updatedAt is allowed", () => {
    T.make({ slug: "x" });
    T.make({ slug: "x", updatedAt: new Date() });
    // @ts-expect-error - slug is create-required (its $value consumes client input)
    T.make({});
  });
});
