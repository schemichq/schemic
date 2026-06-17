// The portable FIELD SUBSTRATE — the dialect-independent field model the kind registry builds on.
//
// core-v2 (the kind-registry flip) retired the fixed-slot `PortableDb` (tables/functions/accesses/
// natives) + the per-slot object types (`PortableTable`/`PortableEvent`/…): a schema is now a flat
// `PortableObject[]` of OPEN kinds (see ../kind), each driver owning its own portable shape. What
// stays in core is the SUBSTRATE every kind composes — a field's structured {@link PortableType} +
// its clauses — so a table kind (Postgres `PgTablePortable`, …) nests `PortableField`s and the
// cross-driver field model + Zod drop-in keep working.
//
// Field/permission CLAUSES (default/value/assert/index spec/…) are carried verbatim as dialect
// expression strings: they don't port across dialects, so a foreign driver honors the ones it can and
// surfaces the rest as a documented capability gap. Only the keystone (the TYPE) is fully portable.

import type { PortableType } from "./portable";

/** CRUD permissions — each a boolean (FULL/NONE) or a dialect WHERE-expression string (carried verbatim). */
export interface PortablePermissions {
  select?: boolean | string;
  create?: boolean | string;
  update?: boolean | string;
  delete?: boolean | string;
}

/** A field in the portable substrate: a structured {@link PortableType} + its dialect clauses (verbatim). */
export interface PortableField {
  name: string;
  type: PortableType;
  flexible?: boolean;
  readonly?: boolean;
  default?: string;
  default_always?: boolean;
  value?: string;
  computed?: string;
  assert?: string;
  /**
   * A field-level CHECK constraint (dialect boolean expression, carried verbatim). DISTINCT from
   * `assert`: that is Surreal's `ASSERT`; this is the SQL `CHECK` a driver like Postgres emits. A
   * driver maps whichever of the two it supports and surfaces the other as a capability gap.
   */
  check?: string;
  comment?: string;
  /** Referential action(s) on a foreign reference. A driver honors the actions it supports. */
  reference?: { on_delete?: string; on_update?: string };
  /**
   * Auto-generated identity column — `GENERATED ALWAYS`/`BY DEFAULT AS IDENTITY`; a `serial`/
   * auto-increment column maps here too. Absent → an ordinary column. Drivers without identity ignore it.
   */
  identity?: "always" | "by-default";
  permissions?: PortablePermissions;
  table: string;
}
