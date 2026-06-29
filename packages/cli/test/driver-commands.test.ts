import { describe, expect, test } from "bun:test";
import type { DriverCommand } from "@schemic/core";
import { toParsedArgs } from "../src/cli/driver-commands";

const cmd = (over: Partial<DriverCommand>): DriverCommand => ({
  kind: "access",
  verb: "check",
  summary: "",
  run: async () => {},
  ...over,
});

describe("driver-command arg parsing (toParsedArgs)", () => {
  test("collects ALL positionals as a list (variadic; driver validates arity)", () => {
    const c = cmd({
      verb: "find",
      args: { positionals: [{ name: "filters", variadic: true }] },
    });
    expect(
      toParsedArgs(c, ["id=123", "status=active"], {}).positionals,
    ).toEqual(["id=123", "status=active"]);
    // raw key=value passes through untouched — the driver interprets it
    expect(toParsedArgs(c, [], {}).positionals).toEqual([]);
  });

  test("value flags become their string; absent value flag is undefined", () => {
    const c = cmd({
      args: {
        flags: [
          { name: "user", value: true },
          { name: "password", value: true },
        ],
      },
    });
    expect(toParsedArgs(c, ["acct"], { user: "ada" }).flags).toEqual({
      user: "ada",
      password: undefined,
    });
  });

  test("boolean flags become true/false (never undefined)", () => {
    const c = cmd({
      verb: "rotate",
      args: { flags: [{ name: "dry-run" }] },
    });
    expect(toParsedArgs(c, [], { "dry-run": true }).flags).toEqual({
      "dry-run": true,
    });
    expect(toParsedArgs(c, [], {}).flags).toEqual({ "dry-run": false });
  });

  test("a missing required flag throws with a helpful message", () => {
    const c = cmd({
      args: { flags: [{ name: "user", value: true, required: true }] },
    });
    expect(() => toParsedArgs(c, ["acct"], {})).toThrow(
      "`sc access check` requires --user",
    );
    // present satisfies it
    expect(() => toParsedArgs(c, ["acct"], { user: "ada" })).not.toThrow();
  });

  test("no declared args -> positionals pass through, flags empty", () => {
    const c = cmd({ verb: "rotate" });
    expect(toParsedArgs(c, ["account"], {})).toEqual({
      positionals: ["account"],
      flags: {},
    });
  });
});
