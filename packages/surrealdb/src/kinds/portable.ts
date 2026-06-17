// The PORTABLE objects for the SurrealDB kind registry (core-v2, docs/kind-registry-contract.md
// slice 2). Each is a {@link PortableObject} (tagged `kind`/`name` for the generic spine) wrapping
// the canonical {@link DefineStatement}(s) the legacy diff engine already produces — so a kind's
// `emit`/`overwrite` reuse the SAME renderer + clause maps the fixed-slot `surrealDriver.diff` uses,
// and parity is byte-exact by construction (see ./registry.ts).
//
// SurrealDB authors index/event INLINE on the table, but the contract models them as their OWN kinds
// (deps/owner -> table). The driver-side EXPLODE (./explode.ts) fans a `TableDef` into one table object
// + N index + M event objects BEFORE lowering, so `KindEngine.lower` stays a clean 1:1. Fields stay
// NESTED in the table object (a table HAS fields — they are the shared substrate, not a kind), and the
// table kind owns field-level diff inside its `overwrite`.

import type { PortableObject, Ref } from "@schemic/core";
import type { DefineStatement } from "../ddl";

/**
 * A table's portable form: its `DEFINE TABLE` head + its `DEFINE FIELD` statements (nested). Indexes
 * and events are EXCLUDED — they are their own kinds. `deps` carries the table's cross-kind edges
 * (a RELATION's in/out endpoint tables), computed at explode time.
 */
export interface PTable extends PortableObject {
  readonly kind: "table";
  readonly name: string;
  /** The `DEFINE TABLE` head statement (carries the table-level clause map for `ALTER TABLE`). */
  readonly head: DefineStatement;
  /** The nested `DEFINE FIELD` statements (each carries its clause map for `ALTER FIELD`). */
  readonly fields: DefineStatement[];
  /** Objects this table must be emitted AFTER — a RELATION's in/out tables. */
  readonly deps: Ref[];
}

/** An index's portable form: the `DEFINE INDEX` statement + its owning table. */
export interface PIndex extends PortableObject {
  readonly kind: "index";
  readonly name: string;
  readonly table: string;
  readonly stmt: DefineStatement;
}

/** An event's portable form: the `DEFINE EVENT` statement + its owning table. `deps` carries any
 *  `fn::` functions the WHEN/THEN call (so a called function emits BEFORE the event). */
export interface PEvent extends PortableObject {
  readonly kind: "event";
  readonly name: string;
  readonly table: string;
  readonly stmt: DefineStatement;
  readonly deps: Ref[];
}

/**
 * A db-level function's portable form — OPAQUE (a neutral identity + its canonical `DEFINE FUNCTION`
 * statement, round-tripped verbatim). `deps` carries any OTHER `fn::` functions its body calls.
 */
export interface PFunction extends PortableObject {
  readonly kind: "function";
  readonly name: string;
  readonly stmt: DefineStatement;
  readonly deps: Ref[];
}

/**
 * A db-level access/auth definition's portable form — OPAQUE. `deps` carries any `fn::` functions its
 * SIGNUP/SIGNIN/AUTHENTICATE call (so those functions emit BEFORE the access).
 */
export interface PAccess extends PortableObject {
  readonly kind: "access";
  readonly name: string;
  readonly stmt: DefineStatement;
  readonly deps: Ref[];
}

/** Every portable object a SurrealDB schema lowers to. */
export type SurrealPortable = PTable | PIndex | PEvent | PFunction | PAccess;

/**
 * The authoring-side definables the explode produces. They ALREADY carry the normalized, canonical
 * `DefineStatement`(s) (the explode runs `schemaStruct` + `structuredSnapshot` first), so each kind's
 * `lower` is the identity — exactly the pattern core's `kind-registry.test.ts` uses.
 */
export type SurrealDefinable = SurrealPortable;
