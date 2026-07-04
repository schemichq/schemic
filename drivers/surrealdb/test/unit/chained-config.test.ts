// The CHAINED defineConfig form (core ac74d90) with surrealConnection as the driver marker:
// .connection(name, surrealConnection, static | (ctx, args) => config|config[]) — the resolver's
// ctx.connections is typed with the ACCUMULATED prior connections, each thenable to a full Client.

import { describe, expect, test } from "bun:test";
import { defineConfig } from "@schemic/core/config";
import type { Client } from "../../src/client";
import { surrealConnection } from "../../src/connection";
import { defineTable, s } from "../../src/index";

const URL = process.env.SURREAL_URL;

const base = {
  schema: "./x",
  url: URL ?? "ws://127.0.0.1:8000/rpc",
  username: "root",
  password: "root",
  authLevel: "root" as const,
};

const Org = defineTable("chain_org", { slug: s.string() });

const schemic = defineConfig()
  .connection("main", surrealConnection, {
    ...base,
    namespace: "chain_main",
    database: "app",
  })
  .connection(
    "tenant",
    surrealConnection,
    async (ctx, args: { org?: string }) => {
      if (args?.org)
        return { ...base, namespace: `chain_t_${args.org}`, database: "app" };
      // The typed path: the prior connection is thenable to its FULL ORM client.
      const main = await ctx.connections.main;
      const orgs = await main.select(Org);
      return orgs.map((o) => ({
        ...base,
        namespace: `chain_t_${o.slug}`,
        database: "app",
        key: o.slug,
      }));
    },
  );

// --- type-level assertions -----------------------------------------------------------------------
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// connect() types per entry: main takes no args; tenant takes { org?: string }.
type MainClient = Awaited<ReturnType<typeof schemic.connect<"main">>>;
type _mainClient = Expect<Equal<MainClient, Client>>;

const _typedCtx = () =>
  defineConfig()
    .connection("a", surrealConnection, {
      ...base,
      namespace: "n",
      database: "d",
    })
    .connection("b", surrealConnection, async (ctx) => {
      const a = await ctx.connections.a; // typed: the surreal Client
      const _c: Client = a;
      // @ts-expect-error — forward/self reference: "b" is not visible in its own resolver
      void ctx.connections.b;
      return { ...base, namespace: "n2", database: "d" };
    });

const _argsTyping = () => {
  void schemic.connect("tenant", { org: "acme" });
  // @ts-expect-error — wrong args shape for tenant
  void schemic.connect("tenant", { org: 5 });
  // @ts-expect-error — unknown connection name
  void schemic.connect("nope");
};

describe("chained defineConfig with surrealConnection as the driver marker", () => {
  test("the chain accumulates entries with the surreal driver tag", () => {
    expect(Object.keys(schemic.connections)).toEqual(["main", "tenant"]);
    expect(schemic.connections.main.driver).toBe("surrealdb");
    expect(schemic.connections.tenant.driver).toBe("surrealdb");
    expect(typeof schemic.connections.tenant.client).toBe("function");
    expect(typeof schemic.connections.main.label).toBe("function");
  });

  test("a chained parameterized resolver receives its typed args", async () => {
    const ctx = { env: process.env, connections: {} };
    const bases = await schemic.connections.tenant.resolve(ctx as never, {
      org: "acme",
    });
    expect(bases).toHaveLength(1);
    expect((bases[0] as { namespace?: string }).namespace).toBe("chain_t_acme");
  });
});

describe.skipIf(!URL)("chained cross-connection resolution (live)", () => {
  test("the tenant resolver enumerates the fleet via the TYPED main client", async () => {
    {
      await using main = await schemic.connect("main");
      await main.query(
        "REMOVE TABLE IF EXISTS chain_org; CREATE chain_org:a SET slug = 'acme'; CREATE chain_org:b SET slug = 'beta';",
      );
    }
    // No org -> the resolver awaits ctx.connections.main and selects the fleet (typed path).
    await expect(schemic.connect("tenant", {})).rejects.toThrow(
      /resolved to 2 configs \(acme, beta\)/,
    );
    // With org -> single config, connectable.
    {
      await using db = await schemic.connect("tenant", { org: "acme" });
      // RawQuery unwraps the FIRST statement's result — for RETURN that's the scalar itself.
      const result = await db.query("RETURN 1");
      expect(result as unknown).toBe(1);
    }
    {
      await using main = await schemic.connect("main");
      await main.query("REMOVE TABLE IF EXISTS chain_org;");
    }
  });
});
