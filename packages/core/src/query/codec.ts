import { z } from "zod";

/**
 * One selected projection column: the output key (`as`) plus the source Zod schema to decode it through.
 * The schema may itself be a `z.object(...)` for a nested projection — the driver's builder assembles the
 * tree; core just decodes it.
 */
export interface ProjectionField {
  readonly as: string;
  readonly schema: z.ZodType;
}

/**
 * Build an ad-hoc Zod object codec for a projection (a subset / rename of a table's columns). A full-row
 * read decodes through the driver's `TableDef`; a *projection* isn't a full row, so this assembles a
 * codec from exactly the selected columns' schemas.
 */
export function projectionSchema(
  fields: readonly ProjectionField[],
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.as] = f.schema;
  return z.object(shape);
}

/** Decode raw projected rows (DB wire → app values) through the ad-hoc projection codec. */
export function decodeProjection<T = Record<string, unknown>>(
  fields: readonly ProjectionField[],
  rows: readonly unknown[],
): T[] {
  const schema = projectionSchema(fields);
  return rows.map((r) => z.decode(schema, r as never) as T);
}
