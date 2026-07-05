// Typed-fragments PHASE 2: typed contextual callbacks on authoring slots — events ((e) => ...),
// field clauses ((f) => ...), function bodies ((a) => ... typed by arg names), permissions
// ((p) => ...), and .subject(User) authoring metadata on record accesses. Plain Expr forms remain.
import { describe, expect, test } from "bun:test";
import { emitDefStatement, emitTable } from "../../src/ddl";
import {
  defineAccess,
  defineEvent,
  defineFunction,
  defineTable,
  s,
  surql,
} from "../../src/index";

const User = defineTable("p2_user", {
  name: s.string(),
  email: s.string(),
  title: s.string(),
});

describe("event callbacks — typed $after/$before/$event", () => {
  test("(e) => ... : typed row refs splice, e.event.eq uses canonical single quotes", () => {
    const T = User.event("p2_notify", {
      when: (e) => e.event.eq("CREATE"),
      then: (e) => surql`RETURN ${e.after.email}`,
    });
    const ddl = emitTable(T)
      .split("\n")
      .find((l) => l.includes("EVENT"));
    expect(ddl).toContain("WHEN $event = 'CREATE'");
    expect(ddl).toContain("THEN RETURN $after.email");
  });

  test("typed: a wrong column on e.after is a compile error", () => {
    const _bad = () =>
      User.event("x", {
        // @ts-expect-error — no such column on p2_user
        then: (e) => surql`RETURN ${e.after.emial}`,
      });
    expect(typeof _bad).toBe("function");
  });

  test("standalone defineEvent gets the same typed ctx from the TableDef", () => {
    const ev = defineEvent(User, "p2_standalone", {
      when: (e) => e.event.neq("DELETE"),
      then: (e) => surql`RETURN ${e.before.name}`,
    });
    const { ddl } = emitDefStatement(ev);
    expect(ddl).toContain("WHEN $event != 'DELETE'");
    expect(ddl).toContain("THEN RETURN $before.name");
  });
});

describe("field-clause callbacks — $value / $this refs", () => {
  test("$value((f) => ...) splices $value; $computed((f) => ...) splices $this.<path>", () => {
    const T = defineTable("p2_fields", {
      title: s.string(),
      password: s
        .string()
        .$value((f) => surql`crypto::bcrypt::generate(${f.value})`),
      slug: s.string().$computed((f) => surql`string::slug(${f.this.title})`),
    });
    const ddl = emitTable(T);
    expect(ddl).toContain("VALUE crypto::bcrypt::generate($value)");
    expect(ddl).toContain("COMPUTED string::slug($this.title)");
  });

  test("$default and $assert accept callbacks too", () => {
    const T = defineTable("p2_defaults", {
      n: s.int().$default((f) => surql`string::len(${f.this.name} ?? '')`),
      name: s.string().$assert((f) => surql`string::len(${f.value}) > 1`),
    });
    const ddl = emitTable(T);
    expect(ddl).toContain("DEFAULT string::len($this.name ?? '')");
    expect(ddl).toContain("ASSERT string::len($value) > 1");
  });
});

describe("function-body callbacks — args typed by NAME", () => {
  test("(a) => ... : arg refs splice as $<name>; a typo is a compile error", () => {
    const Verify = defineFunction("p2_verify", {
      email: s.string(),
      code: s.string(),
    })
      .returns(s.boolean())
      .body((a) => surql`RETURN ${a.email} = ${a.code}`);
    const { ddl } = emitDefStatement(Verify);
    expect(ddl).toContain("RETURN $email = $code");

    const _bad = () =>
      defineFunction("x", { email: s.string() })
        // @ts-expect-error — no such arg
        .body((a) => surql`RETURN ${a.emial}`);
    expect(typeof _bad).toBe("function");
  });
});

describe("permissions callbacks — bare row columns + $auth", () => {
  test("(p) => ... : p.row.<col> splices BARE; p.auth.<path> splices $auth.<path>", () => {
    const T = defineTable("p2_perms", {
      author: s.string(),
      title: s.string(),
    }).permissions((p) => ({
      select: true,
      update: surql`${p.row.author} = ${p.auth.id}`,
    }));
    const ddl = emitTable(T);
    expect(ddl).toContain("FOR update WHERE author = $auth.id");
  });

  test("typed: a wrong column on p.row is a compile error", () => {
    const _bad = () =>
      defineTable("x", { author: s.string() }).permissions((p) => ({
        // @ts-expect-error — no such column
        update: surql`${p.row.auther} = ${p.auth.id}`,
      }));
    expect(typeof _bad).toBe("function");
  });

  test("FunctionDef.permissions takes the ctx too (no row)", () => {
    const F = defineFunction("p2_fn")
      .returns(s.boolean())
      .body(surql`RETURN true`)
      .permissions((ctx) => surql`${ctx.auth.id} != NONE`);
    expect(emitDefStatement(F).ddl).toContain("PERMISSIONS $auth.id != NONE");
  });
});

describe(".subject(User) — record-access authoring metadata", () => {
  test("stores the subject table name; the emitted DDL is unchanged", () => {
    const plain = defineAccess("p2_auth").onDatabase().record();
    const withSubject = defineAccess("p2_auth")
      .onDatabase()
      .record()
      .subject(User);
    expect(withSubject.config.subject).toBe("p2_user");
    expect(emitDefStatement(withSubject).ddl).toBe(emitDefStatement(plain).ddl);
  });
});
