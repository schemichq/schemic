import { describe, expectTypeOf, test } from "bun:test";
import { z } from "zod";
import { RecordId, surql, type DateTime, type RecordIdValue } from "surrealdb";
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
    User.encode({});
    // @ts-expect-error - email is required
    User.encode({ name: "a" });
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
    User.encodePartial({ createdAt: new Date() });
    // @ts-expect-error - id is excluded from updates
    User.encodePartial({ id: new RecordId("user", "x") });
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

describe("encode / safeEncode return types (#6, #7)", () => {
  test("encode returns Partial<Wire<>>: codec fields are wire-typed (DateTime, not Date)", () => {
    const made = User.encode({ name: "Alice", email: "alice@example.com" });
    expectTypeOf(made).toEqualTypeOf<Partial<Wire<typeof User>>>();
    // a datetime codec field is its wire type (DateTime) on the way out, never the app Date
    expectTypeOf(made.createdAt).toEqualTypeOf<DateTime | undefined>();
    expectTypeOf(made.createdAt).not.toEqualTypeOf<Date | undefined>();
  });

  test("encodePartial returns the same Partial<Wire<>>", () => {
    expectTypeOf(User.encodePartial({ name: "x" })).toEqualTypeOf<Partial<Wire<typeof User>>>();
  });

  test("safeEncode's result is the Zod success|error union; data is the wire partial", () => {
    const res = User.safeEncode({ name: "Alice", email: "alice@example.com" });
    expectTypeOf(res).toEqualTypeOf<z.ZodSafeParseResult<Partial<Wire<typeof User>>>>();
    if (res.success) {
      expectTypeOf(res.data).toEqualTypeOf<Partial<Wire<typeof User>>>();
      expectTypeOf(res.data.createdAt).toEqualTypeOf<DateTime | undefined>();
    } else {
      expectTypeOf(res.error).toEqualTypeOf<z.ZodError<Partial<Wire<typeof User>>>>();
    }
  });

  test("safeEncodePartial mirrors safeEncode's result type", () => {
    expectTypeOf(User.safeEncodePartial({ name: "x" })).toEqualTypeOf<
      z.ZodSafeParseResult<Partial<Wire<typeof User>>>
    >();
  });

  test("encodeAsync returns Promise<Partial<Wire<>>>", () => {
    expectTypeOf(User.encodeAsync({ name: "x", email: "a@b.co" })).toEqualTypeOf<
      Promise<Partial<Wire<typeof User>>>
    >();
    expectTypeOf(User.safeEncodeAsync({ name: "x", email: "a@b.co" })).toEqualTypeOf<
      Promise<z.ZodSafeParseResult<Partial<Wire<typeof User>>>>
    >();
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

describe("$internal fields", () => {
  const Account = table("account", {
    id: z.string(), // -> record<account, string>
    email: sz.email(),
    passhash: sz.string().$internal(),
  });

  test("App excludes the internal key; the system view includes it", () => {
    expectTypeOf<App<typeof Account>>().toEqualTypeOf<{
      id: RecordId<"account", string>;
      email: string;
    }>();
    expectTypeOf<App<typeof Account.system>>().toEqualTypeOf<{
      id: RecordId<"account", string>;
      email: string;
      passhash: string;
    }>();
  });

  test("Create excludes the internal key; encode rejects it, system.encode accepts it", () => {
    expectTypeOf<Create<typeof Account>>().toEqualTypeOf<{
      email: string;
      id?: RecordId<"account", string>;
    }>();
    // @ts-expect-error - passhash is internal, not part of the public create input
    Account.encode({ email: "alice@example.com", passhash: "x" });
    // the system view CAN set internal fields
    Account.system.encode({ email: "alice@example.com", passhash: "x" });
  });
});

describe("nested create-optionality", () => {
  // settings is create-REQUIRED (no $default on the object itself), but its nested `theme`
  // has a DB $default, so `theme` is create-optional while `tz` stays required.
  const T = table("nested", {
    id: z.string(),
    settings: sz.object({
      theme: sz.string().$default(surql`"x"`),
      tz: sz.string(),
    }),
  });

  test("a nested $default field is create-optional; its siblings stay required", () => {
    expectTypeOf<Create<typeof T>["settings"]>().toEqualTypeOf<{ tz: string; theme?: string }>();
    expectTypeOf<{ tz: string }>().toExtend<Create<typeof T>["settings"]>();
  });

  test("the nested field stays REQUIRED on the decoded app side", () => {
    expectTypeOf<App<typeof T>["settings"]["theme"]>().toEqualTypeOf<string>();
    expectTypeOf<App<typeof T>["settings"]["tz"]>().toEqualTypeOf<string>();
  });

  test("Update<> is deep-partial: every nested field is optional (MERGE deep-merges)", () => {
    expectTypeOf<Update<typeof T>["settings"]>().toEqualTypeOf<
      { theme?: string; tz?: string } | undefined
    >();
    // a single nested key is a valid patch (deep-partial)
    expectTypeOf<{ settings: { theme: string } }>().toExtend<Update<typeof T>>();
    expectTypeOf<{ settings: Record<string, never> }>().toExtend<Update<typeof T>>();
    T.encodePartial({ settings: { theme: "x" } });
  });

  // The object field itself is $default (create-optional) AND its nested field is too.
  const T2 = table("nested2", {
    id: z.string(),
    settings: sz
      .object({ theme: sz.string().$default(surql`"x"`), tz: sz.string() })
      .$default(surql`{}`),
  });

  test("a $default object is optional, and its value still allows omitting nested defaults", () => {
    expectTypeOf<Create<typeof T2>>().toEqualTypeOf<{
      id?: RecordId<"nested2", string>;
      settings?: { tz: string; theme?: string };
    }>();
    // omit settings entirely, or provide it partially
    expectTypeOf<Record<string, never>>().toExtend<Create<typeof T2>>();
    expectTypeOf<{ settings: { tz: string } }>().toExtend<Create<typeof T2>>();
  });

  // Array-of-object: nested defaults are create-optional per element.
  const T3 = table("nested3", {
    id: z.string(),
    tags: sz.object({ name: sz.string(), color: sz.string().$default("#fff") }).array(),
  });

  test("array<object> recurses: a nested default is optional per element", () => {
    expectTypeOf<Create<typeof T3>["tags"]>().toEqualTypeOf<{ name: string; color?: string }[]>();
    expectTypeOf<App<typeof T3>["tags"][number]["color"]>().toEqualTypeOf<string>();
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

  test("encode enforces the create-required slug; create-optional updatedAt is allowed", () => {
    T.encode({ slug: "x" });
    T.encode({ slug: "x", updatedAt: new Date() });
    // @ts-expect-error - slug is create-required (its $value consumes client input)
    T.encode({});
  });
});
