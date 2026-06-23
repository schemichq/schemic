// @schemic/core/query `callFunction`: invoke a defined DB function via the `callable` capability and
// decode the raw result through the function's `.returns(R)` schema. Driven here with a fake callable +
// a real Zod codec (string <-> Date) to prove the decode-by-default differentiator.

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { callFunction, type CallableFunctions } from "../../src/query";

const dateCodec = z.codec(z.string(), z.date(), {
  decode: (s) => new Date(s),
  encode: (d) => d.toISOString(),
});

describe("@schemic/core/query — callFunction", () => {
  test("invokes by name with the args, then decodes the result through the return schema", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const callable: CallableFunctions = {
      invoke: async (_conn, name, args) => {
        calls.push({ name, args });
        return [{ id: "post:1", at: "2024-01-02T03:04:05.000Z" }]; // raw wire result
      },
    };
    const R = z.array(z.object({ id: z.string(), at: dateCodec }));
    const out = await callFunction(callable, {}, "feed", { user: "u1" }, R);

    expect(calls[0]).toEqual({ name: "feed", args: { user: "u1" } });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("post:1");
    expect(out[0].at).toBeInstanceOf(Date); // decoded, not the wire string
    expect((out[0].at as Date).getUTCFullYear()).toBe(2024);
  });

  test("decodes a scalar return value too", async () => {
    const callable: CallableFunctions = { invoke: async () => "42" };
    const n = await callFunction(callable, {}, "count", {}, z.coerce.number());
    expect(n).toBe(42);
  });

  test("result type is the decoded App type (z.output of the return schema)", async () => {
    const callable: CallableFunctions = {
      invoke: async () => ({ at: "2024-01-01T00:00:00.000Z" }),
    };
    const r = await callFunction(callable, {}, "now", {}, z.object({ at: dateCodec }));
    const when: Date = r.at; // compile-time: r.at is Date, not string
    expect(when).toBeInstanceOf(Date);
  });
});
