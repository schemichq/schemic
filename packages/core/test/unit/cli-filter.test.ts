import { describe, expect, test } from "bun:test";
import type { DefineStatement } from "@schemic/core";
import { type Filter, parseFilter } from "../../src/cli/filter";
import {
  filterSnapshot,
  included,
  mergeSnapshot,
} from "../../src/cli/surreal-filter";

const stmt = (
  kind: DefineStatement["kind"],
  name: string,
  table?: string,
): DefineStatement => ({ kind, name, table, ddl: `${kind} ${name}` });

const snap = (...ss: DefineStatement[]) => ({
  version: 1 as const,
  statements: Object.fromEntries(
    ss.map((s) => [`${s.kind}:${s.table ?? ""}:${s.name}`, s]),
  ),
});

describe("parseFilter", () => {
  test("defaults: tables/functions/events on, access OFF (opt-in)", () => {
    const f = parseFilter({});
    expect(included(f, stmt("table", "user"))).toBe(true);
    expect(included(f, stmt("function", "greet"))).toBe(true);
    expect(included(f, stmt("event", "ev", "user"))).toBe(true);
    expect(included(f, stmt("access", "account"))).toBe(false);
  });

  test("--access opts access in", () => {
    expect(included(parseFilter({ access: true }), stmt("access", "a"))).toBe(
      true,
    );
  });

  test("--no-functions / --no-events exclude the kind", () => {
    const f = parseFilter({ functions: false, events: false });
    expect(included(f, stmt("function", "f"))).toBe(false);
    expect(included(f, stmt("event", "e", "user"))).toBe(false);
    expect(included(f, stmt("table", "user"))).toBe(true);
  });

  test("--tables a,b restricts to those tables (and their fields/indexes)", () => {
    const f = parseFilter({ tables: "user,post" });
    expect(included(f, stmt("table", "user"))).toBe(true);
    expect(included(f, stmt("field", "email", "user"))).toBe(true);
    expect(included(f, stmt("table", "comment"))).toBe(false);
    expect(included(f, stmt("field", "body", "comment"))).toBe(false);
  });

  test("an event needs BOTH its table included and the events kind on", () => {
    expect(
      included(parseFilter({ tables: "user" }), stmt("event", "e", "post")),
    ).toBe(false); // table 'post' excluded
    expect(
      included(parseFilter({ tables: "user" }), stmt("event", "e", "user")),
    ).toBe(true);
  });
});

describe("filterSnapshot", () => {
  test("drops excluded kinds", () => {
    const s = snap(
      stmt("table", "user"),
      stmt("function", "greet"),
      stmt("access", "account"),
    );
    const out = filterSnapshot(s, parseFilter({})); // access off
    expect(Object.keys(out.statements)).toEqual([
      "table::user",
      "function::greet",
    ]);
  });
});

describe("mergeSnapshot", () => {
  test("included kinds take next; excluded kinds keep prev", () => {
    const f: Filter = parseFilter({}); // access excluded
    const prev = snap(stmt("table", "user"), stmt("access", "old"));
    const next = snap(stmt("table", "user2"), stmt("access", "new"));
    const merged = mergeSnapshot(prev, next, f);
    const names = Object.values(merged.statements)
      .map((s) => s.name)
      .sort();
    // table updated to next (user2), access kept from prev (old) — not overwritten by next's
    expect(names).toEqual(["old", "user2"]);
  });
});
