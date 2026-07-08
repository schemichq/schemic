// Pure logic of the `ls`/`info` inspection commands: --from parsing (snapshot default), table-scoped
// addressing via the neutral owner hook, and the snapshot-vs-db drift merge (=/~/+/-).
import { describe, expect, test } from "bun:test";
import type { KindEngine, PortableObject } from "@schemic/core";
import { addressOf, mergeKind, parseSource } from "../../src/cli/inspect";

// A minimal fake engine: emit joins a `ddl` field; owner reads a `table` field; canonical = emit.
// biome-ignore lint/suspicious/noExplicitAny: test doubles for the erased-at-seam engine.
function fakeEngine(owned: boolean): KindEngine<any, any> {
  return {
    lower: (a: PortableObject) => a,
    emit: (o: PortableObject & { ddl?: string }) => [o.ddl ?? o.name],
    remove: () => [],
    owner: owned
      ? (o: PortableObject & { table?: string }) => ({
          kind: "table",
          name: o.table ?? "",
        })
      : undefined,
    // biome-ignore lint/suspicious/noExplicitAny: partial engine is enough for these units.
  } as any;
}

const obj = (
  kind: string,
  name: string,
  extra: Record<string, unknown> = {},
): PortableObject => ({ kind, name, ...extra }) as PortableObject;

describe("parseSource", () => {
  test("defaults to snapshot (offline/fast)", () => {
    expect(parseSource(undefined)).toBe("snapshot");
  });
  test("accepts snapshot|db|both", () => {
    expect(parseSource("db")).toBe("db");
    expect(parseSource("both")).toBe("both");
  });
  test("rejects anything else", () => {
    expect(() => parseSource("live")).toThrow(/snapshot\|db\|both/);
  });
});

describe("addressOf", () => {
  test("top-level kind → bare name", () => {
    expect(addressOf(fakeEngine(false), obj("table", "user"))).toBe("user");
  });
  test("table-scoped kind → table.name via the owner hook", () => {
    expect(
      addressOf(fakeEngine(true), obj("index", "email", { table: "user" })),
    ).toBe("user.email");
  });
});

describe("mergeKind drift (--from both)", () => {
  const eng = fakeEngine(false);
  test("no drift markers when only one side is loaded (snapshot-only)", () => {
    const rows = mergeKind(
      eng,
      "table",
      [obj("table", "user"), obj("table", "post")],
      undefined,
    );
    expect(rows.map((r) => r.address)).toEqual(["post", "user"]); // sorted
    expect(rows.every((r) => r.drift === undefined)).toBe(true);
  });

  test("= in sync, ~ differs, + only in db, - only in snapshot", () => {
    const snap = [
      obj("table", "same", { ddl: "DEFINE TABLE same" }),
      obj("table", "changed", { ddl: "DEFINE TABLE changed A" }),
      obj("table", "goneFromDb", { ddl: "x" }),
    ];
    const db = [
      obj("table", "same", { ddl: "DEFINE TABLE same" }),
      obj("table", "changed", { ddl: "DEFINE TABLE changed B" }),
      obj("table", "newInDb", { ddl: "y" }),
    ];
    const byAddr = Object.fromEntries(
      mergeKind(eng, "table", snap, db).map((r) => [r.address, r.drift]),
    );
    expect(byAddr.same).toBe("=");
    expect(byAddr.changed).toBe("~");
    expect(byAddr.newInDb).toBe("+");
    expect(byAddr.goneFromDb).toBe("-");
  });

  test("filters to the requested kind", () => {
    const snap = [
      obj("table", "user"),
      obj("index", "email", { table: "user" }),
    ];
    const rows = mergeKind(fakeEngine(false), "table", snap, undefined);
    expect(rows.map((r) => r.address)).toEqual(["user"]);
  });
});
