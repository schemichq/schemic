// formatSurql — pretty-prints generated SurrealQL (INFO returns bodies single-line): statements
// per line, nested blocks indented, wide object literals one entry per line. Whitespace-only:
// normalize canonicalizes formatting, so formatted output NEVER phantom-diffs.
import { describe, expect, test } from "bun:test";
import { formatSurql } from "../../src/cli/format";
import { normalizeFunction } from "../../src/cli/struct";
import { renderSchemaToTS } from "../../src/cli/pull";

const FN =
  "{ LET $html = string::concat('<b>', $code); LET $res = http::post('https://x.dev/emails', { from: 'Game Backlog <verify@example.dev>', to: [$email], subject: 'Your code', html: $html }, { Authorization: string::concat('Bearer ', $key) }); IF $res.id = NONE { THROW 'send failed; retry'; }; RETURN $res.id != NONE }";

describe("formatSurql", () => {
  test("statement-per-line, nested blocks indent, wide objects wrap", () => {
    const out = formatSurql(FN);
    expect(out).toContain("{\n  LET $html = string::concat('<b>', $code);");
    expect(out).toContain("http::post('https://x.dev/emails', {\n    from:");
    expect(out).toContain("IF $res.id = NONE {\n    THROW 'send failed; retry';\n  };");
    expect(out.endsWith("\n}")).toBe(true);
    // short objects stay inline
    expect(out).toContain("{ Authorization: string::concat('Bearer ', $key) }");
  });

  test("idempotent; string literals with ;{} untouched", () => {
    const once = formatSurql(FN);
    expect(formatSurql(once)).toBe(once);
    expect(formatSurql("RETURN 'a; {b}'")).toBe("RETURN 'a; {b}'");
  });

  test("whitespace-only: normalize(format(x)) === normalize(x) — can't phantom-diff", () => {
    const a = normalizeFunction({ name: "f", args: [], block: FN });
    const b = normalizeFunction({ name: "f", args: [], block: formatSurql(FN) });
    expect(b.block).toBe(a.block);
  });

  test("short expressions come back unchanged (safe everywhere)", () => {
    expect(formatSurql("$event = 'CREATE'")).toBe("$event = 'CREATE'");
    expect(formatSurql("time::now()")).toBe("time::now()");
  });
});

describe("pull renders formatted bodies", () => {
  test("a single-line fn block regenerates multi-line; events expand when long", () => {
    const ts = renderSchemaToTS({
      tables: [
        {
          name: "user",
          kind: { kind: "NORMAL" as const },
          schemafull: true,
          fields: [],
          indexes: [],
          events: [
            {
              name: "onc",
              what: "user",
              when: "$event = 'CREATE'",
              then: [
                "{ LET $c = rand::string(8); UPSERT type::record(v, [$after.id]) CONTENT { codeHash: crypto::sha256($c), expiresAt: time::now() + 15m, attempts: 0 }; fn::send($after.email, $c); }",
              ],
            },
          ],
        },
      ],
      functions: [{ name: "f", args: [], block: FN, returns: "bool" }],
      accesses: [],
      analyzers: [],
      params: [],
    });
    expect(ts).toContain(".body(surql`{\n    LET $html =");
    expect(ts).toContain('.event("onc", {\n');
    expect(ts).toContain("then: surql`{\n");
    expect(ts).toContain("      LET $c = rand::string(8);");
  });
});
