# example-tracker

A full-stack **project / task tracker** that dogfoods [`surreal-zod`](../core) end to
end. The browser talks **directly** to SurrealDB (record access + table permissions),
and the same `surreal-zod` schema module runs **isomorphically** on the server (migration
+ tests) and in the browser (`decode`/`encode`, typed `make`/`makePartial`).

> Built to surface DX friction — see **[DX-FINDINGS.md](./DX-FINDINGS.md)**.

## Architecture

```
src/schema.ts   shared surreal-zod model (User, Project, Task, Comment + Member/Watch/DependsOn)
src/db.ts       isomorphic connection + record-access signup/signin helpers
setup.ts        admin migration (root): DDL via defineTable + raw ACCESS/PERMISSIONS
web/            Vite + React app — connects to SurrealDB directly as an end user
test/           bun integration tests against the live DB
```

- **Schema** (`src/schema.ts`) is the single source of truth. `defineTable` generates the
  `DEFINE TABLE`/`DEFINE FIELD` DDL; `decode`/`encode` map rows ⇄ app types; `make`/
  `makePartial` build `CONTENT`/`MERGE` payloads. `App<>`/`Wire<>`/`Create<>`/`Update<>`
  types are exported.
- **Auth** is SurrealDB **record access**: the browser calls `signup`/`signin` and gets a
  token; every query then runs as that user, so **table PERMISSIONS** scope what they can
  read/write. No app server sits in the middle.
- **Permissions** model: you see a project if you own it, it is public, or you are a member
  (`user ->member-> project` graph). Tasks/comments inherit visibility from their project.

## Run it

Prereq: a SurrealDB **3.x** instance at `ws://127.0.0.1:8000/rpc`.

```bash
# 1. Build the workspace dep once (so Vite can resolve the lib/ build):
cd ../core && bun run build && cd ../example-tracker

# 2. Configure root creds for the migration/tests (never committed):
cp .env.example .env        # then set SURREAL_PASS=...

# 3. Apply schema + record access + permissions (runs as root):
bun run setup

# 4. Dev server (browser app, signs up/in as an end user):
bun run dev                 # http://localhost:5173

# 5. Typecheck / production build / tests:
bun run typecheck
bun run build               # -> ../dist (isomorphic surreal-zod in a browser bundle)
bun test                    # live integration tests (need .env)
```

`setup` and `bun test` read `SURREAL_USER`/`SURREAL_PASS` from `.env`. The browser **never**
sees root credentials — it authenticates per-user via record access.

## What the tests prove

`test/tracker.test.ts` migrates a scratch database, signs up two users via record access,
and asserts:

- `decode` yields app types (`RecordId`, `Date`, `Duration`, enums) and hides `passhash`;
- DB-side defaults (`$default $auth.id`, nested-object defaults, enum defaults) populate;
- `$value updatedAt` advances on every write; `$assert` rejects an empty title;
- `make`/`makePartial` omit DB-filled/readonly fields;
- **permission isolation** — user B cannot see/edit user A's project or tasks until A grants
  membership, after which B can.
