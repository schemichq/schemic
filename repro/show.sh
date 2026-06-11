#!/usr/bin/env bash
# show.sh <userId> — print `test:rec` as seen by user:<userId>, authenticated as that
# record via the `account` access. Demonstrates the array-element-permission bug set up
# by array-element-perms.surql.
#
#   ./show.sh 2      # field visible, elements "denied" -> leaks [b,d,f] instead of []
#   ./show.sh 4      # everything visible
#   ./show.sh 1      # field hidden -> {}
#
# Env overrides: SURREAL_HTTP (default http://localhost:8000), SURREAL_NS (test),
#                SURREAL_DB (perm_repro), SURREAL_ACCESS (account).
set -euo pipefail

uid="${1:?usage: $0 <userId>   e.g. $0 2}"
http="${SURREAL_HTTP:-http://localhost:8000}"
ns="${SURREAL_NS:-test}"
db="${SURREAL_DB:-perm_repro}"
ac="${SURREAL_ACCESS:-account}"

# 1) sign in as user:<uid> through the record access -> JWT
token=$(curl -fsS -X POST "$http/signin" \
    -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d "{\"ns\":\"$ns\",\"db\":\"$db\",\"ac\":\"$ac\",\"id\":$uid}" \
    | jq -r '.token // empty')

if [ -z "$token" ]; then
    echo "signin failed for user:$uid (is the data loaded? see array-element-perms.surql)" >&2
    exit 1
fi

# 2) run the query AS that user and print the record it actually sees
echo "== test:rec as seen by user:$uid =="
curl -fsS -X POST "$http/sql" \
    -H "Authorization: Bearer $token" \
    -H "surreal-ns: $ns" -H "surreal-db: $db" \
    -H 'Accept: application/json' \
    --data 'SELECT * FROM ONLY test:rec;' \
    | jq '.[0].result'
