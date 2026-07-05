// defineParam — DEFINE PARAM with the access-style split (Manuel's spec): an INLINE literal value
// is fully managed (emit/diff/migrations/pull); env()/secret() and DECLARED (type-only/bare)
// params are OUT-OF-BAND (`sc param push/check`) — SurrealDB stores param values READABLY, so a
// secret value must never reach a snapshot or migration. `.$` is the typed `$name` reference.
import { describe, expect, test } from "bun:test";
import { emitDefStatement } from "../../src/ddl";
import {
  defineFunction,
  defineParam,
  defineTable,
  env,
  s,
  surql,
} from "../../src/index";
import { schemaStruct } from "../../src/cli/lower";
import { normalizeParam } from "../../src/cli/struct";
import { block, select } from "../../src/query";

describe("authoring modes", () => {
  test("inline literal -> managed; SecretRef -> secret; s schema / bare -> declared", () => {
    expect(defineParam("page_size", 25).config.mode).toBe("value");
    expect(defineParam("k", env("RESEND_API_KEY")).config.mode).toBe("secret");
    expect(defineParam("k", s.string()).config.mode).toBe("declared");
    expect(defineParam("k").config.mode).toBe("declared");
    expect(defineParam("page_size", 25).managed).toBe(true);
    expect(defineParam("k").managed).toBe(false);
  });

  test("a non-identifier name is rejected", () => {
    expect(() => defineParam("not ok")).toThrow(/plain identifier/);
  });

  test(".$ is the typed $name reference; the def itself splices in templates", () => {
    const Key = defineParam("resend_api_key", env("RESEND_API_KEY"));
    expect(Key.$.toText()).toBe("$resend_api_key");
    expect(surql`RETURN ${Key}`.query).toBe("RETURN $resend_api_key");
    // deep proxy: object params path through
    const Cfg = defineParam("app_cfg", { retries: 3 });
    expect(
      (Cfg.$ as unknown as { retries: { toText(): string } }).retries.toText(),
    ).toBe(
      "$app_cfg.retries",
    );
    // typed: usable where a string operand is expected
    const q = surql.fn.string.concat("Bearer ", Key.$);
    expect(q.query).toMatch(/^string::concat\(\$r\d+, \$resend_api_key\)$/);
  });
});

describe("DDL", () => {
  test("managed: the literal value inlines (with PERMISSIONS/COMMENT)", () => {
    const P = defineParam("page_size", 25)
      .permissions(false)
      .comment("page size");
    const { ddl, kind } = emitDefStatement(P);
    expect(kind).toBe("param");
    expect(ddl).toBe(
      'DEFINE PARAM $page_size VALUE 25 PERMISSIONS NONE COMMENT "page size";',
    );
  });

  test("secret/declared: a $__value placeholder — the value NEVER reaches DDL text", () => {
    const S = defineParam("api_key", env("API_KEY"));
    const stmt = emitDefStatement(S, { exists: "overwrite" });
    expect(stmt.ddl).toBe("DEFINE PARAM OVERWRITE $api_key VALUE $__value;");
    expect(stmt.bindings).toEqual({ __value: env("API_KEY") });
    expect(emitDefStatement(defineParam("manual")).ddl).toBe(
      "DEFINE PARAM $manual VALUE $__value;",
    );
  });
});

describe("migration-flow scoping", () => {
  test("managed params enter schemaStruct; secret/declared are EXCLUDED", () => {
    const db = schemaStruct(
      [],
      [
        defineParam("page_size", 25),
        defineParam("api_key", env("API_KEY")),
        defineParam("manual", s.string()),
      ],
    );
    expect(db.params.map((p) => p.name)).toEqual(["page_size"]);
    expect(JSON.stringify(db)).not.toContain("api_key");
  });

  test("normalizeParam folds the inlined string spelling to INFO's '...'", () => {
    const db = schemaStruct([], [defineParam("api_base", "https://x.dev")]);
    expect(db.params[0]?.value).toBe("'https://x.dev'");
    expect(
      normalizeParam({ name: "x", value: 's"a b"', permissions: true }),
    ).toEqual({ name: "x", value: "'a b'" });
  });
});

// --- live (SURREAL_URL-gated) ---------------------------------------------------------------------
const URL = process.env.SURREAL_URL;

describe.skipIf(!URL)("defineParam live", () => {
  test("managed params round-trip drift-free; secrets push via bindings; pull regenerates", async () => {
    const { Surreal } = await import("surrealdb");
    const { explodeSchema, introspectAll } = await import(
      "../../src/kinds/explode"
    );
    const { deepEqual, normalizeDb } = await import("../../src/cli/struct");
    const { renderSchemaToTS } = await import("../../src/cli/pull.ts");
    const { introspectStructured } = await import("../../src/cli/structure");

    const PageSize = defineParam("dp_page_size", 25);
    const ApiBase = defineParam("dp_api_base", "https://x.dev").comment("base");
    const Secret = defineParam("dp_secret", env("DP_SECRET_TEST"));
    process.env.DP_SECRET_TEST = "s3cret-value";

    const c = new Surreal();
    await c.connect(URL as string);
    await c.signin({ username: "root", password: "root" });
    await c.use({ namespace: "dp", database: "dp" });
    await c.query(
      "REMOVE PARAM IF EXISTS $dp_page_size; REMOVE PARAM IF EXISTS $dp_api_base; REMOVE PARAM IF EXISTS $dp_secret;",
    );

    // Managed: apply + drift-free round trip.
    for (const def of [PageSize, ApiBase])
      await c.query(emitDefStatement(def, { exists: "overwrite" }).ddl);
    const pick = (objs: { kind: string; name: string }[], name: string) =>
      objs.find((o) => o.kind === "param" && o.name === name) as {
        native?: unknown;
      };
    const scrub = (v: unknown) => JSON.parse(JSON.stringify(v));
    const authored = explodeSchema([], [PageSize, ApiBase]);
    const live = await introspectAll(c);
    for (const name of ["dp_page_size", "dp_api_base"])
      expect(
        deepEqual(scrub(pick(authored, name).native), scrub(pick(live, name).native)),
      ).toBe(true);

    // Secret: the DDL carries a placeholder; the value goes as a BINDING.
    const stmt = emitDefStatement(Secret, { exists: "overwrite" });
    await c.query(stmt.ddl, { __value: process.env.DP_SECRET_TEST });
    const [row] = (await c.query("RETURN $dp_secret")) as [string];
    expect(row).toBe("s3cret-value");
    // …and it is NOT in the authored migration flow.
    expect(pick(authored, "dp_secret")).toBeUndefined();

    // A param referenced from a function body works end to end (the GetResendKey pattern).
    const Getter = defineFunction("dp_get_secret")
      .returns(s.string())
      .permissions(false)
      .body(block().return(Secret.$.as<string>()));
    await c.query(emitDefStatement(Getter, { exists: "overwrite" }).ddl);
    const [got] = (await c.query("RETURN fn::dp_get_secret()")) as [string];
    expect(got).toBe("s3cret-value");

    // Pull regenerates managed params (and only those — the secret's VALUE would leak otherwise;
    // it appears as a plain live param unless filtered, so assert the managed renders).
    const rendered = renderSchemaToTS(normalizeDb(await introspectStructured(c)));
    expect(rendered).toContain('defineParam("dp_page_size", 25)');
    expect(rendered).toContain(
      'defineParam("dp_api_base", "https://x.dev").comment("base")',
    );

    await c.query(
      "REMOVE PARAM IF EXISTS $dp_page_size; REMOVE PARAM IF EXISTS $dp_api_base; REMOVE PARAM IF EXISTS $dp_secret; REMOVE FUNCTION IF EXISTS fn::dp_get_secret;",
    );
    await c.close();
  }, 60_000);
});
