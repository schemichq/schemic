import { Surreal } from "surrealdb";
import { s, defineTable, range, surql } from "./src/index";
import { create } from "./src/query";

const User = defineTable("user", { tier: s.string().$default(surql`'free'`) });
const P = (q: { toSQL(): { sql: string } }) => q.toSQL().sql;

console.log("1 range   :", P(create(User).ids(range({ from: 1, to: 50 }))));
console.log("2 until   :", P(create(User).ids(range({ from: 1, until: 51 }))));
console.log("3 after   :", P(create(User).ids(range({ after: 0, to: 50 }))));
console.log("4 count   :", P(create(User).ids({ count: 50 })));
console.log("5 content :", P(create(User).ids(range({ from: 1, to: 3 })).content({ tier: "pro" })));
console.log("6 negative:", P(create(User).ids(range({ from: -3, to: -1 }))));
console.log("7 count 0 :", P(create(User).ids({ count: 0 })));

const bad: [string, () => unknown][] = [
  ["open end",     () => create(User).ids(range({ from: 1 }) as never)],
  ["open start",   () => create(User).ids(range({ to: 10 }) as never)],
  ["float bound",  () => create(User).ids(range({ from: 1, to: 2.5 }))],
  ["string bound", () => create(User).ids(range({ from: "a", to: "z" }) as never)],
  ["neg count",    () => create(User).ids({ count: -1 })],
  ["float count",  () => create(User).ids({ count: 1.5 })],
  ["id + ids",     () => create(User, "u1").ids({ count: 2 })],
];
for (const [l, f] of bad) {
  try { f(); console.log(`8 ${l.padEnd(12)}: NO THROW  <-- BAD`); }
  catch (e) { console.log(`8 ${l.padEnd(12)}: THROW -> ${(e as Error).message.slice(0, 58)}`); }
}

const db = new Surreal();
await db.connect("ws://127.0.0.1:8022/rpc");
await db.signin({ username: "root", password: "root" });
await db.use({ namespace: "idr", database: "idr" });
const rows = await create(User).ids(range({ from: 1, to: 5 })).content({ tier: "pro" }).run(db);
console.log("9  live range :", rows.length, "rows, ids:", rows.map((r) => String(r.id)).join(","));
const rnd = await create(User).ids({ count: 3 }).run(db);
console.log("10 live count :", rnd.length, "rows, random ids:", rnd.every((r) => String(r.id).length > 12));
await db.close();
