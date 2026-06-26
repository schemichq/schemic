import { defineAccess } from "@schemic/surrealdb";
import { cover } from "../_kit";

export default cover(import.meta.url, {
  title: "RECORD WITH REFRESH",
  note: "`.withRefresh()` emits `WITH REFRESH` (RECORD) — issue a refresh token so sessions renew without re-auth.",
  ddl: `DEFINE ACCESS account ON DATABASE TYPE RECORD WITH REFRESH;`,
  def: defineAccess("account").onDatabase().withRefresh(),
});
