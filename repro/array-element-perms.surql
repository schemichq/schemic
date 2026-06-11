-- ============================================================================
-- Repro: array ELEMENT-level permissions don't filter correctly (SurrealDB 3.1.3)
-- ============================================================================
-- A SELECT permission on an array element (`items.*`) is meant to hide/show each
-- element. Instead, when it evaluates to `false` it leaks the ODD-indexed elements
-- (a mutate-while-iterating-by-index bug). FIELD-level perms (`items`) work fine.
--
-- Apply (root auth):
--   surreal sql --endpoint ws://localhost:8000 \
--     --username root --password "$SURREAL_PASS" --multi < array-element-perms.surql
--
-- Then query as a given user (record auth):  ./show.sh 2
--
-- Permissions (both depend only on the AUTH user, not the item):
--   items     visible to EVEN users           ($auth.n % 2 == 0)
--   items.*   visible to every 4th user        ($auth.n % 4 == 0)
--
-- Expected vs actual for the 6-element record [a,b,c,d,e,f]:
--   user:1 (n=1)  field hidden          -> {}                 (correct)
--   user:2 (n=2)  field ok, elems denied-> items: []          ... but ACTUAL: [b,d,f]  <-- BUG
--   user:4 (n=4)  field ok, elems ok    -> items: [a..f]      (correct)
-- ============================================================================

DEFINE NAMESPACE IF NOT EXISTS test;
USE NS test;
DEFINE DATABASE IF NOT EXISTS perm_repro;
USE NS test DB perm_repro;

-- clean slate (re-runnable)
REMOVE TABLE IF EXISTS test;
REMOVE TABLE IF EXISTS user;
REMOVE ACCESS IF EXISTS account ON DATABASE;

DEFINE TABLE user SCHEMALESS PERMISSIONS FULL;
DEFINE TABLE test SCHEMAFULL PERMISSIONS FOR select FULL;

-- field-level perm: only EVEN users may see the `items` field
DEFINE FIELD items ON test TYPE array<object>
    PERMISSIONS FOR select WHERE $auth.n % 2 == 0;

-- element-level perm: only every-4th user may see each element.
-- OVERWRITE because `array<object>` already auto-created `items.*` as a plain object.
DEFINE FIELD OVERWRITE items.* ON test TYPE object
    PERMISSIONS FOR select WHERE $auth.n % 4 == 0;

DEFINE FIELD items.*.name ON test TYPE string;

-- record access so we can authenticate AS a `user` record
DEFINE ACCESS account ON DATABASE TYPE RECORD
    SIGNIN ( SELECT * FROM type::record("user", $id) )
    DURATION FOR SESSION 1h, FOR TOKEN 1h;

-- users carry a numeric `n` (the permission condition reads $auth.n)
CREATE user:1 SET n = 1;
CREATE user:2 SET n = 2;
CREATE user:3 SET n = 3;
CREATE user:4 SET n = 4;
CREATE user:6 SET n = 6;
CREATE user:8 SET n = 8;

-- the record under test: 6 elements
CREATE test:rec SET items = [
    { name: "a" }, { name: "b" }, { name: "c" },
    { name: "d" }, { name: "e" }, { name: "f" }
];
