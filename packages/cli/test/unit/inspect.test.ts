// Pure logic of the `ls`/`info` inspection commands: --from parsing (snapshot default), table-scoped
// addressing via the neutral owner hook, and the snapshot-vs-db drift merge (=/~/+/-).
import { describe, expect, test } from "bun:test";
import type { KindEngine, PortableObject } from "@schemic/core";
import { addressOf, mergeKind, parseSource } from "../../src/cli/inspect";

// biome-ignore lint/suspicious/noExplicitAny: the registry erases each engine's A/P at this seam.
type FakeEngine = KindEngine<any, any>;

// A minimal fake engine: emit joins a `ddl` field; owner/parent read `table`/`parent` fields off the
// object; canonical = emit. `owner` = diff clustering, `parent` = addressing (the CLI prefers parent).
function fakeEngine(opts: { owner?: boolean; parent?: boolean } = {}): FakeEngine {
  return {
    lower: (a: PortableObject) => a,
    emit: (o: PortableObject & { ddl?: string }) => [o.ddl ?? o.name],
    remove: () => [],
    owner: opts.owner
      ? (o: PortableObject & { table?: string }) => ({
          kind: "table",
          name: o.table ?? "",
        })
      : undefined,
    parent: opts.parent
      ? (o: PortableObject & { parent?: string }) => ({
          kind: "table",
          name: o.parent ?? "",
        })
      : undefined,
  } as unknown as FakeEngine;
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
  test("top-level kind (no parent/owner) → bare name", () => {
    expect(addressOf(fakeEngine(), obj("table", "user"))).toBe("user");
  });
  test("owner-only kind → parent.name via the owner fallback", () => {
    expect(
      addressOf(
        fakeEngine({ owner: true }),
        obj("index", "email", { table: "user" }),
      ),
    ).toBe("user.email");
  });
  test("parent-only kind (owner declined) → parent.name via the parent hook", () => {
    expect(
      addressOf(
        fakeEngine({ parent: true }),
        obj("index", "email", { parent: "user" }),
      ),
    ).toBe("user.email");
  });
  test("parent WINS over owner when both are set", () => {
    expect(
      addressOf(
        fakeEngine({ owner: true, parent: true }),
        obj("index", "email", { table: "clusterTbl", parent: "addrTbl" }),
      ),
    ).toBe("addrTbl.email");
  });
});

describe("mergeKind drift (--from both)", () => {
  const eng = fakeEngine();
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
    const rows = mergeKind(fakeEngine(), "table", snap, undefined);
    expect(rows.map((r) => r.address)).toEqual(["user"]);
  });
});
