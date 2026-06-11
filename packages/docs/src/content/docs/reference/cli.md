---
title: CLI reference
description: The sz / surreal-zod command-line interface.
---

:::note[Placeholder]
Scaffold page — the full command reference lands in a later pass.
:::

| Command | What it does |
| --- | --- |
| `sz gen` | Diff schema vs snapshot, write up/down migration |
| `sz migrate` | Apply pending migrations, record applied tag + sha |
| `sz diff --live` | Diff schema against the running database |
| `sz verify` | Replay every migration on a throwaway DB and check it reproduces your schema |
| `sz pull` | Introspect a database into TypeScript schema files |
| `sz sync` | Reconcile the database to your schema directly, no files |
