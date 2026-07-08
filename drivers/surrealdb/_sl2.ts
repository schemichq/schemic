import { Surreal, RecordId } from "surrealdb";
import { create, update, upsert, remove, relate } from "./src/query";
import { connect } from "./src/client";

// lowering — untyped writes
console.log("create:", create("user", "u1").content({ name: "A" }).toSQL().sql);
console.log("update:", update("user", "u1").merge({ n: 1 }).toSQL().sql);
console.log("bulk  :", update("user").all().set({ active: true }).toSQL().sql);
console.log("upsert:", upsert("user", "u1").set({ x: 1 }).toSQL().sql);
console.log("delete:", remove("user", "u1").toSQL().sql);
console.log("relate:", relate(new RecordId("user","a"), "likes", new RecordId("post","p")).set({ r: 5 }).toSQL().sql);

// live — untyped via bound client
const db = connect(new Surreal());
await db.conn.connect("http://127.0.0.1:8022");
await db.conn.signin({ username: "root", password: "root" });
await db.conn.use({ namespace: "main", database: "main" });
await db.query("REMOVE TABLE IF EXISTS su; REMOVE TABLE IF EXISTS sp; REMOVE TABLE IF EXISTS slk;");
const u = (await db.create("su", "alice").content({ name: "Alice" }).only())!;
console.log("live create:", String(u.id), u.name);
await db.update("su", "alice").merge({ age: 30 });
const got = await db.get("su", "alice");
console.log("live get:", got?.name, got?.age);
const p = (await db.create("sp", "p1").content({ title: "Hi" }).only())!;
const e = await db.relate(u.id as RecordId, "slk", p.id as RecordId).set({ rating: 5 }).only();
console.log("live relate:", e?.rating, String(e?.in), String(e?.out));
const rows = await db.select("su").where((r) => r.age.gte(18));
console.log("live untyped select:", rows.map((r) => r.name));
await db.query("REMOVE TABLE IF EXISTS su; REMOVE TABLE IF EXISTS sp; REMOVE TABLE IF EXISTS slk;");
await db.close();
