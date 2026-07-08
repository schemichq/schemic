import type { z } from "zod";
import type { App, Create, TableDef } from "../../src/pure";
import type { Row } from "../../src/query/expr";

type SL = TableDef<string, Record<string, z.ZodUnknown>>;
type _app = App<SL>;
type _row = Row<SL>;
type _create = Create<SL>;

declare const app: _app;
const _a: unknown = app.anyKey;
declare const row: _row;
const _r = row.anyField;
declare const create: _create;
const _c: Record<string, unknown> = create;
export { _a, _r, _c };
