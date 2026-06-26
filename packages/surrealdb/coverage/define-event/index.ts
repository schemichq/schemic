import { coverage } from "../_kit";
import asyncEvent from "./04-async";
import asyncTuned from "./05-async-tuned";
import base from "./01-base";
import comment from "./08-comment";
import ifNotExists from "./03-if-not-exists";
import overwrite from "./02-overwrite";
import thenOrdered from "./07-then-ordered";
import whenOmitted from "./06-when-omitted";

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
