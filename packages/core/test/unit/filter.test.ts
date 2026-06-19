// The kind filter: filterKinds over PortableObject[], where owned objects (index/event with
// owner -> table) follow their table's inclusion and an event additionally honors --events.
// A fake registry supplies the owner hooks the filter reads.

import { describe, expect, test } from "bun:test";
import { filterKinds, parseFilter, passesFilter } from "../../src/cli-kit/filter";
import { KindRegistry, type PortableObject } from "../../src/kind";

interface Owned extends PortableObject {
  table?: string;
}

const reg = new KindRegistry();
const opaque = {
  lower: (o: Owned) => o,
  emit: () => [],
  remove: () => [],
};
const ownedBy = (o: Owned) =>
  o.table ? { kind: "table", name: o.table } : undefined;

reg.define({ name: "table", build: (o: Owned) => o, ...opaque });
reg.define({ name: "index", build: (o: Owned) => o, ...opaque, owner: ownedBy });
reg.define({ name: "event", build: (o: Owned) => o, ...opaque, owner: ownedBy });
reg.define({ name: "function", build: (o: Owned) => o, ...opaque });
reg.define({ name: "access", build: (o: Owned) => o, ...opaque });

const obj = (kind: string, name: string, table?: string): Owned => ({
  kind,
  name,
  ...(table ? { table } : {}),
});
const keys = (os: PortableObject[]) => os.map((o) => `${o.kind}:${o.name}`);

const schema = [
  obj("table", "user"),
  obj("index", "user_email", "user"),
  obj("event", "audit", "user"),
  obj("function", "fmt"),
  obj("access", "jwt"),
  obj("table", "post"),
];

describe("filterKinds", () => {
  test("default filter: tables/functions/events on, access OFF (opt-in)", () => {
    const kept = keys(filterKinds(reg, schema, parseFilter({})));
    expect(kept).toEqual([
      "table:user",
      "index:user_email",
      "event:audit",
      "function:fmt",
      "table:post",
    ]);
    expect(kept).not.toContain("access:jwt");
  });

  test("--no-tables drops the tables AND their owned index/event", () => {
    const kept = keys(filterKinds(reg, schema, parseFilter({ tables: false })));
    expect(kept).toEqual(["function:fmt"]);
  });

  test("--tables user keeps only user + its owned children", () => {
    const kept = keys(
      filterKinds(reg, schema, parseFilter({ tables: "user" })),
    ).filter((k) => !k.startsWith("function") && !k.startsWith("access"));
    expect(kept).toEqual(["table:user", "index:user_email", "event:audit"]);
  });

  test("--no-events drops events but keeps their table + index", () => {
    const kept = keys(filterKinds(reg, schema, parseFilter({ events: false })));
    expect(kept).not.toContain("event:audit");
    expect(kept).toContain("table:user");
    expect(kept).toContain("index:user_email");
  });

  test("--access opts access in", () => {
    const kept = keys(filterKinds(reg, schema, parseFilter({ access: true })));
    expect(kept).toContain("access:jwt");
  });

  test("passesFilter: an owned index follows its table's exclusion", () => {
    const f = parseFilter({ tables: "post" }); // user excluded
    expect(passesFilter(reg, obj("index", "user_email", "user"), f)).toBe(false);
    expect(passesFilter(reg, obj("table", "post"), f)).toBe(true);
  });
});
