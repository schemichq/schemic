import { coverage } from "../_kit";
import authenticate from "./11-authenticate";
import base from "./01-base";
import bearerRecord from "./07-bearer-record";
import bearerUser from "./08-bearer-user";
import comment from "./13-comment";
import duration from "./12-duration";
import ifNotExists from "./03-if-not-exists";
import jwtAlgorithmKey from "./06-jwt-algorithm-key";
import jwtUrl from "./05-jwt-url";
import onNamespace from "./04-on-namespace";
import overwrite from "./02-overwrite";
import recordSignupSignin from "./09-record-signup-signin";
import withRefresh from "./10-with-refresh";

/** Every permutation of the `DEFINE ACCESS` statement, in grammar order. A standalone def
 *  (`defineAccess(name).record()/.jwt()/.bearer()…`), so each item pins its single `DEFINE ACCESS …`
 *  line. Phase 1: ON DATABASE|NAMESPACE / TYPE RECORD|JWT(URL,ALG-KEY)|BEARER / SIGNUP|SIGNIN|WITH
 *  REFRESH|AUTHENTICATE / DURATION / COMMENT + OVERWRITE / IF NOT EXISTS. Phase 2 (secret refs):
 *  RECORD WITH JWT / WITH ISSUER KEY; multi-level: ON ROOT + namespace round-trip. */
export const defineAccessCoverage = coverage("DEFINE ACCESS", [
  // [ OVERWRITE | IF NOT EXISTS ] @name ON [ NAMESPACE | DATABASE ] TYPE …
  base,
  overwrite,
  ifNotExists,
  onNamespace,
  // TYPE JWT [ ALGORITHM KEY | URL ]
  jwtUrl,
  jwtAlgorithmKey,
  // TYPE BEARER FOR [ USER | RECORD ]
  bearerRecord,
  bearerUser,
  // TYPE RECORD [ SIGNUP ] [ SIGNIN ] [ WITH REFRESH ] [ AUTHENTICATE ]
  recordSignupSignin,
  withRefresh,
  authenticate,
  // [ DURATION … ] [ COMMENT … ]
  duration,
  comment,
]);
