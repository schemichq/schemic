/**
 * PARITY — `defineFunction(...).call(db, args)` (DB-functions-as-code) against a real SurrealDB.
 *
 * Proves the (B) surface end to end: args are passed by name + encoded via the param schemas, the
 * function runs (`RETURN fn::name($a0, …)`), and the raw result is DECODED through `.returns(R)` — so
 * `.returns(s.datetime())` yields a real `Date`. Type-level assertions pin that args + result are typed
 * from the schema. Skipped when no SurrealDB is reachable.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Surreal } from "surrealdb";
import { emitDefStatement } from "../../src/driver";
import { defineFunction, s, surql } from "../../src/index";

const Add = defineFunction("t_add", { a: s.int(), b: s.int() })
  .returns(s.int())
  .body(surql`RETURN $a + $b`);
const Stamp = defineFunction("t_stamp")
  .returns(s.datetime())
  .body(surql`RETURN time::now()`);
const Echo = defineFunction("t_echo", { x: s.string() }).body(surql`RETURN $x`);

// --- type-level assertions -----------------------------------------------------------------------
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Expect<T extends true> = T;
type _result = Expect<Eq<Awaited<ReturnType<typeof Add.call>>, number>>; // .returns(s.int()) -> number
type _decoded = Expect<Eq<Awaited<ReturnType<typeof Stamp.call>>, Date>>; // datetime codec -> Date
type _untyped = Expect<Eq<Awaited<ReturnType<typeof Echo.call>>, unknown>>; // no .returns() -> unknown
// args are typed from the schema (a/b: number); a wrong type or wrong key is a compile error:
// @ts-expect-error b must be a number
void (() => Add.call({} as Surreal, { a: 1, b: "x" }));
// @ts-expect-error unknown arg key
void (() => Add.call({} as Surreal, { a: 1, b: 2, c: 3 }));

const NS = "__sz_fncall";
const DB = "fncall";

async function connectScratch(): Promise<Surreal | null> {
  const db = new Surreal();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await db.connect(process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc");
        await db.signin({
          username: process.env.SURREAL_USER ?? "root",
          password: process.env.SURREAL_PASS ?? "root",
        });
        await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${NS};`);
        await db.use({ namespace: NS, database: DB });
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("connect timeout")), 2000);
      }),
    ]);
    for (const f of [Add, Stamp, Echo])
      await db.query(emitDefStatement(f, { exists: "overwrite" }).ddl);
    return db;
  } catch {
    await db.close().catch(() => {});
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const db = await connectScratch();
const live = describe.skipIf(!db);
if (!db) console.warn("[function-call] SurrealDB unreachable — skipping");

afterAll(async () => {
  await db?.close().catch(() => {});
});

live("defineFunction(...).call()", () => {
  test("typed args, decoded result (int)", async () => {
    expect(await Add.call(db!, { a: 2, b: 3 })).toBe(5);
  });

  test("no-arg call; datetime return decodes to a real Date", async () => {
    expect(await Stamp.call(db!)).toBeInstanceOf(Date);
  });

  test("no .returns() -> raw value (unknown)", async () => {
    expect(await Echo.call(db!, { x: "hi" })).toBe("hi");
  });
});
