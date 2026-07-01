import { coverage } from "../_kit";
// Reviewed & numbered (walked 1-by-1, grammar order).
import base from "./01-base";
import overwrite from "./02-overwrite";
import ifNotExists from "./03-if-not-exists";
import recordSignup from "./04-record-signup";
import recordSignin from "./05-record-signin";
import withRefresh from "./06-with-refresh";
import authenticate from "./07-authenticate";
import jwtUrl from "./08-jwt-url";
import jwtAlgorithmKey from "./09-jwt-algorithm-key";
// Not yet reached — parked as `00-*` until we walk to each (then it gets its real number).
import bearerRecord from "./00-bearer-record";
import bearerUser from "./00-bearer-user";
import comment from "./00-comment";
import duration from "./00-duration";
import onNamespace from "./00-on-namespace";

/** Every permutation of the `DEFINE ACCESS` statement. A standalone def
 *  (`defineAccess(name).record()/.jwt()/.bearer()…`), so each item pins its single `DEFINE ACCESS …`
 *  line. We're walking this suite 1-by-1 (onDatabase-first; namespace last): items confirmed in review
 *  carry their real number (01, 02, …); everything still pending review is parked under `00-*` and
 *  renumbered as we reach it. Phase 1: ON DATABASE|NAMESPACE / TYPE RECORD|JWT(URL,ALG-KEY)|BEARER /
 *  SIGNUP|SIGNIN|WITH REFRESH|AUTHENTICATE / DURATION / COMMENT + OVERWRITE / IF NOT EXISTS. Phase 2
 *  (secret refs): RECORD WITH JWT / WITH ISSUER KEY; multi-level: ON ROOT + namespace round-trip. */
export const defineAccessCoverage = coverage("DEFINE ACCESS", [
  // [ OVERWRITE | IF NOT EXISTS ] @name ON DATABASE TYPE RECORD …
  base,
  overwrite,
  ifNotExists,
  // TYPE RECORD [ SIGNUP ] [ SIGNIN ] [ WITH REFRESH ] [ AUTHENTICATE ]
  recordSignup,
  recordSignin,
  withRefresh,
  authenticate,
  // TYPE JWT [ ALGORITHM KEY | URL ]
  jwtUrl,
  jwtAlgorithmKey,
  // --- below: not yet reviewed (parked 00-*) ---
  // TYPE BEARER FOR [ USER | RECORD ]
  bearerRecord,
  bearerUser,
  // [ DURATION … ] [ COMMENT … ]
  duration,
  comment,
  // ON NAMESPACE (scope variant — walked last)
  onNamespace,
]);
