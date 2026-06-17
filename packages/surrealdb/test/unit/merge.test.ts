import { describe, expect, test } from "bun:test";
import { mergeUnits, type RenderedUnit, unifiedDiff } from "@schemic/core";

const tableUnit = (
  exportName: string,
  code: string,
  imports = [`import { s, defineTable } from "@schemic/surrealdb";`],
): RenderedUnit => ({
  kind: "table",
  name: exportName.toLowerCase(),
  exportName,
  code,
  imports,
});

const MIRROR = { keepLocalFields: false, keepLocalObjects: false };
const KEEP = { keepLocalFields: true, keepLocalObjects: true };

const USER = `export const User = defineTable("user", {
  id: s.string(),
  name: s.string(),
})
  .schemaless();`;

const fileWith = (...consts: string[]) =>
  `import { s, defineTable } from "@schemic/surrealdb";\n\n${consts.join("\n\n")}\n`;

describe("mergeUnits", () => {
  test("is idempotent when the DB matches the file (no churn)", () => {
    const src = fileWith(USER);
    const { content, localOnly } = mergeUnits(
      src,
      [tableUnit("User", USER)],
      MIRROR,
    );
    expect(content).toBe(src);
    expect(localOnly.fields).toHaveLength(0);
    expect(localOnly.objects).toHaveLength(0);
  });

  test("adds a DB field the file lacks", () => {
    const src = fileWith(USER);
    const desired = USER.replace(
      "  name: s.string(),\n",
      "  name: s.string(),\n  email: s.email(),\n",
    );
    const { content } = mergeUnits(src, [tableUnit("User", desired)], MIRROR);
    expect(content).toContain("email: s.email()");
    expect(content).toContain("name: s.string()");
  });

  test("DB wins on a shared field (overwrites the local definition)", () => {
    const src = fileWith(USER);
    const desired = USER.replace(
      "name: s.string()",
      "name: s.string().optional()",
    );
    const { content } = mergeUnits(src, [tableUnit("User", desired)], MIRROR);
    expect(content).toContain("name: s.string().optional()");
  });

  describe("local-only fields", () => {
    const withLocal = fileWith(
      `export const User = defineTable("user", {
  id: s.string(),
  name: s.string(),
  nickname: s.string().optional(),
})
  .schemaless();`,
    );

    test("are reported and dropped when mirroring", () => {
      const { content, localOnly } = mergeUnits(
        withLocal,
        [tableUnit("User", USER)],
        MIRROR,
      );
      expect(localOnly.fields).toEqual([
        { exportName: "User", fields: ["nickname"] },
      ]);
      expect(content).not.toContain("nickname");
    });

    test("are kept (grafted back) under --merge", () => {
      const { content, localOnly } = mergeUnits(
        withLocal,
        [tableUnit("User", USER)],
        KEEP,
      );
      expect(localOnly.fields).toEqual([
        { exportName: "User", fields: ["nickname"] },
      ]);
      expect(content).toContain("nickname: s.string().optional()");
    });
  });

  test("preserves a user's leading comment above the const", () => {
    const src = `import { s, defineTable } from "@schemic/surrealdb";\n\n// keep me\n${USER}\n`;
    const { content } = mergeUnits(src, [tableUnit("User", USER)], MIRROR);
    expect(content).toContain("// keep me");
  });

  describe("local-only objects", () => {
    const withHelper = fileWith(USER, `export const HELPERS = { x: 1 };`);

    test("are reported and removed when mirroring", () => {
      const { content, localOnly } = mergeUnits(
        withHelper,
        [tableUnit("User", USER)],
        MIRROR,
      );
      expect(localOnly.objects).toEqual(["HELPERS"]);
      expect(content).not.toContain("HELPERS");
    });

    test("are kept under --merge", () => {
      const { content, localOnly } = mergeUnits(
        withHelper,
        [tableUnit("User", USER)],
        KEEP,
      );
      expect(localOnly.objects).toEqual(["HELPERS"]);
      expect(content).toContain("HELPERS");
    });
  });

  test("appends a brand-new object while keeping the existing one", () => {
    const src = fileWith(USER);
    const post = `export const Post = defineTable("post", {\n  id: s.string(),\n})\n  .schemaless();`;
    // A combined file: both the existing User and the new Post are DB objects for this file.
    const { content } = mergeUnits(
      src,
      [tableUnit("User", USER), tableUnit("Post", post)],
      MIRROR,
    );
    expect(content).toContain("export const User");
    expect(content).toContain("export const Post");
  });

  test("unions in a new cross-file import", () => {
    const src = fileWith(USER);
    const desired = USER.replace(
      "  name: s.string(),\n",
      "  name: s.string(),\n  org: Org.record(),\n",
    );
    const unit = tableUnit("User", desired, [
      `import { s, defineTable } from "@schemic/surrealdb";`,
      `import { Org } from "./org";`,
    ]);
    const { content } = mergeUnits(src, [unit], MIRROR);
    expect(content).toContain(`from "./org"`);
    expect(content).toContain("org: Org.record()");
  });

  test("replaces a whole function const (atomic, no field surgery)", () => {
    const src = `import { defineFunction, s, surql } from "@schemic/surrealdb";

export const greet = defineFunction("greet", { name: s.string() })
  .body(surql\`RETURN "hi";\`);
`;
    const desired = `export const greet = defineFunction("greet", { name: s.string() })
  .returns(s.string())
  .body(surql\`RETURN "hello";\`);`;
    const unit: RenderedUnit = {
      kind: "function",
      name: "greet",
      exportName: "greet",
      code: desired,
      imports: [
        `import { defineFunction, s, surql } from "@schemic/surrealdb";`,
      ],
    };
    const { content } = mergeUnits(src, [unit], MIRROR);
    expect(content).toContain(`RETURN "hello"`);
    expect(content).toContain(".returns(s.string())");
    expect(content).not.toContain(`RETURN "hi"`);
  });
});

describe("unifiedDiff", () => {
  test("emits a git-style patch with file header and @@ hunk", () => {
    const out = unifiedDiff("a\nb\nc\n", "a\nx\nc\n", "schema.ts");
    expect(out).toContain("diff --git a/schema.ts b/schema.ts");
    expect(out).toContain("--- a/schema.ts");
    expect(out).toContain("+++ b/schema.ts");
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(out).toContain("-b");
    expect(out).toContain("+x");
    expect(out).toContain(" a");
  });

  test("returns empty string when unchanged", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n", "x")).toBe("");
  });
});
