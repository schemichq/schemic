import { coverage } from "../_kit";
import asyncEvent from "./async";
import asyncTuned from "./async-tuned";
import base from "./base";
import comment from "./comment";
import ifNotExists from "./if-not-exists";
import overwrite from "./overwrite";
import thenOrdered from "./then-ordered";
import whenOmitted from "./when-omitted";

/** Every permutation of the `DEFINE EVENT` statement, in grammar order. An event is authored on a table
 *  (`.event(name, { when?, then, async?, comment? })`), so each item is a minimal table whose emit pins
 *  the `DEFINE EVENT …` line. */
export const defineEventCoverage = coverage("DEFINE EVENT", [
  // [ OVERWRITE | IF NOT EXISTS ] @name ON [ TABLE ] @table [ ASYNC … ] [ WHEN … ] THEN … [ COMMENT … ]
  base,
  overwrite,
  ifNotExists,
  // [ ASYNC [ RETRY @retry ] [ MAXDEPTH @max_depth ] ]
  asyncEvent,
  asyncTuned,
  // [ WHEN @condition ] (omitted -> fires every change)
  whenOmitted,
  // THEN @action -- single (base) + ordered list
  thenOrdered,
  // [ COMMENT @string ]
  comment,
]);
