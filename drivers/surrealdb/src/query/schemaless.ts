/**
 * The SCHEMALESS (untyped) table adapter — lets the query builder target a table that wasn't
 * modeled in Schemic: pass a plain name string or an SDK `Table` instead of a `TableDef`. There is
 * no schema, so the data is `Record<string, unknown>`, `.content`/`.merge`/`.set` take a raw object
 * (no codec validation), rows come back undecoded, and callback rows (`.where`/`.set`/`.return`)
 * are a PROXY — any field name resolves to a generic ref. Everything else composes unchanged.
 */

import type { Table } from "surrealdb";
import { z } from "zod";
import type { TableDef } from "../pure";

/** Marker brand for the untyped adapter (a registered symbol so it survives dual-instance loading). */
export const SCHEMALESS: unique symbol = Symbol.for(
  "schemic.surrealdb.schemaless",
);

/** A plain name string or an SDK `Table` — the untyped alternative to a `TableDef`. */
export type UntypedTable = string | Table;

/** The synthetic table type for `string | Table`: an index-signature shape, so `App`/`Row`/`Create`/
 *  `Update` all collapse to `Record<string, unknown>` (data) / a proxy of generic refs (callbacks). */
export type SchemalessTable = TableDef<string, Record<string, z.ZodUnknown>>;

/** True when a builder's table is the untyped adapter — its callback row is a proxy. */
export function isSchemaless(table: unknown): boolean {
  return (
    typeof table === "object" &&
    table !== null &&
    (table as Record<symbol, unknown>)[SCHEMALESS] === true
  );
}

/** The table NAME from a typed def, a plain name string, or an SDK `Table`. */
export function tableName(table: { name: string } | UntypedTable): string {
  return typeof table === "string" ? table : table.name;
}

/** Build the untyped table adapter for a plain string / SDK `Table`. Only the members the query
 *  builders read are present: `name`, a passthrough `object.shape` (any column decodes as-is), an
 *  identity codec, and no `singletonId`. */
export function schemaless(table: UntypedTable): SchemalessTable {
  const passthrough = z.unknown();
  // Any column name resolves to a passthrough schema (projection decode) and is always `in` the shape.
  const shape = new Proxy({} as Record<string, z.ZodType>, {
    get: () => passthrough,
    has: () => true,
  });
  return {
    [SCHEMALESS]: true,
    name: tableName(table),
    singletonId: undefined,
    object: { shape },
    encode: (d: unknown) => d,
    encodePartial: (d: unknown) => d,
    decode: (r: unknown) => r,
  } as unknown as SchemalessTable;
}
