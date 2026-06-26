import { coverage } from "../_kit";
import assert from "./14-assert";
import base from "./01-base";
import comment from "./20-comment";
import computed from "./15-computed";
import defaultAlways from "./11-default-always";
import defaultExpr from "./10-default";
import flexible from "./04-flexible";
import ifNotExists from "./03-if-not-exists";
import overwrite from "./02-overwrite";
import permissionsForOps from "./18-permissions-for-ops";
import permissionsFull from "./17-permissions-full";
import permissionsNone from "./16-permissions-none";
import permissionsSameAs from "./19-permissions-same-as";
import readonly from "./12-readonly";
import referenceOnDeleteCascade from "./06-reference-on-delete-cascade";
import referenceOnDeleteIgnore from "./07-reference-on-delete-ignore";
import referenceOnDeleteReject from "./05-reference-on-delete-reject";
import referenceOnDeleteThen from "./09-reference-on-delete-then";
import referenceOnDeleteUnset from "./08-reference-on-delete-unset";
import value from "./13-value";

/** Every permutation of the `DEFINE FIELD` statement, in grammar order. A field is authored inline on
 *  a table (`s.*` builders + `$`-methods), so each item is a minimal table whose emit includes the
 *  pinned `DEFINE FIELD …` line. */
export const defineFieldCoverage = coverage("DEFINE FIELD", [
  // [ OVERWRITE | IF NOT EXISTS ] @name ON [ TABLE ] @table [ TYPE @type ]
  base,
  overwrite,
  ifNotExists,
  // [ [ FLEXIBLE ] TYPE @type ]
  flexible,
  // [ REFERENCE [ ON DELETE REJECT | CASCADE | IGNORE | UNSET | THEN @expression ] ]
  referenceOnDeleteReject,
  referenceOnDeleteCascade,
  referenceOnDeleteIgnore,
  referenceOnDeleteUnset,
  referenceOnDeleteThen,
  // [ DEFAULT [ALWAYS] @expression ]
  defaultExpr,
  defaultAlways,
  // [ READONLY ]
  readonly,
  // [ VALUE @expression ]
  value,
  // [ ASSERT @expression ]
  assert,
  // [ COMPUTED @expression ]
  computed,
  // [ PERMISSIONS [ NONE | FULL | FOR select/create/update @expression ] ]  (no FOR delete on fields)
  permissionsNone,
  permissionsFull,
  permissionsForOps,
  permissionsSameAs,
  // [ COMMENT @string ]
  comment,
]);
