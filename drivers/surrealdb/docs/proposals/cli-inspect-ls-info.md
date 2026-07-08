# Proposal: `ls` / `info` — inspect schema resources (snapshot or DB)

Status: **PROPOSED** (Manuel-approved shape; core-dev owns the CLI implementation). Author:
driver-dev-surrealdb. A cross-driver `@schemic/cli` feature — spec'd here because the data comes from
the driver's introspection + the neutral kind registry; core-dev implements the command.

## Motivation

Today the CLI can act on the schema (`pull`, `diff`, `push`, migrations) but you can't just **look at**
what's in it. `diff` shows the *delta* between snapshot and DB; there's no way to see the *inventory* of
either side, or to dump one entity's resolved definition. `ls`/`info` fill that: a read-only inspection
+ diagnosis surface that composes with the existing commands ("why does `diff` show a change on
`user`?" → `sc table info user --from both`).

## Grammar: noun-first, `sc <kind> <verb>`

The CLI already ships **noun-first, kind-scoped** commands (`sc access rotate` / `push` / `diff` /
`check`). Adding verb-first `sc ls <kind>` would fork the grammar (is it `sc ls access` or `sc access
ls`?). So `ls`/`info` adopt the **existing** noun-first rule, and the whole surface gets one clean law:

- **Whole-schema operation → a top-level verb**: `sc pull`, `sc diff`, `sc push`.
- **Anything scoped to a kind → `sc <kind> <verb>`**: `sc access ls|info|rotate|…`, `sc table ls|info`,
  `sc index ls|info`, `sc function ls|info`, …

This makes **`access` stop being a special case** — it's just the kind that happens to carry extra
verbs (`rotate`/`push`/`diff`/`check`) on top of the universal `ls`/`info` every kind gets. Kinds come
from the neutral kind registry, so core-dev wires `ls`/`info` **once** and every driver's kinds get
them for free (surrealdb today: `table`, `access`, `index`, `event`, `function`, `analyzer`, `param`).

### Commands

```
sc <kind> ls   [--from snapshot|db|both] [--json]     # list entities of a kind
sc <kind> info <name> [--from …] [--json]             # one entity's resolved definition (+ sub-resources)
sc ls          [--from …] [--json]                    # OVERVIEW: every kind + counts (the one top-level verb)
```

- `sc access ls` → the access defs; `sc table ls` → the tables; etc.
- `sc ls` (no kind) is the single deliberate verb-first exception — a cross-kind **overview** (kinds +
  counts), the entry point you drill into with `sc <kind> ls`. It is an overview, not a per-kind
  duplicate, so it doesn't reintroduce the two-grammars problem.

## Source: `--from snapshot | db | both`

The point is to inspect **either side** and diagnose drift:

- `--from snapshot` — the local schema snapshot (core's snapshot engine). Offline, no connection.
- `--from db` — live introspection (the driver's `introspectAll()` / `introspectStructured()`).
- `--from both` — **the diagnostic default**: snapshot vs DB side-by-side with a drift marker
  (`=` in sync, `~` differs, `+` only in DB, `-` only in snapshot). Complements `diff` (diff = the
  delta; `ls --from both` = the inventory with drift flags). Degrades to snapshot-only with a note when
  no connection is configured. *(Default is core-dev's call — `both` is the most diagnostic; `snapshot`
  is the fastest/offline.)*

## `info` — one entity's detail

`sc <kind> info <name>` prints the entity's **resolved DDL** from the chosen source, plus its
sub-resources and dependencies:

- `sc table info user` → the `DEFINE TABLE` + its fields / indexes / events inline (they're
  table-scoped kinds), and (with `--from both`) a per-line drift marker.
- `sc access info account` → the `DEFINE ACCESS` DDL (secrets already redacted by introspection).

**Addressing note for table-scoped kinds** (`field`/`index`/`event` belong to a table): `sc index ls`
lists all indexes *with their table*; `sc index info <table> <name>` (or `<table>.<name>`) addresses
one. The driver's introspection already carries the table context. Exact addressing is core-dev's to
finalize; the driver supplies whatever key shape the CLI settles on.

## What the driver provides (surrealdb: ready today)

No new driver surface needed for v1:
- **kinds** — the neutral kind registry enumerates them.
- **entities per kind** — `introspectAll()` returns them (DB side); the snapshot engine returns the
  snapshot side.
- **per-entity detail** — the same introspection carries each entity's struct/DDL for `info`.

If `info` wants richer detail than `introspectAll` exposes (e.g. dependency edges rendered), I'll
extend the surrealdb introspection to surface it — flag it and I'll add it driver-side.

## Ownership + next step

`ls`/`info` live in `@schemic/cli` (**core-dev**), generated generically from the kind registry so all
drivers inherit them. This doc is the spec; core-dev owns the command implementation + the final calls
on `--from` default, `info` addressing, and output formatting. driver-dev-surrealdb guarantees the
introspection data behind it and adopts any introspection-contract change core-dev needs.

## Open questions (for core-dev)

1. `--from` default — `both` (diagnostic) vs `snapshot` (offline/fast)?
2. `info` addressing for table-scoped kinds — `sc index info <table> <name>` vs `<table>.<name>` vs
   folding them under `sc table info <table>` only?
3. Should `sc <kind> ls`/`info` be auto-registered from the kind registry (uniform, zero per-driver
   wiring) or explicitly declared per kind (lets a kind opt out / customize)?
