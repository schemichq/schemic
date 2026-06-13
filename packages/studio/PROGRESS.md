# Reverie Studio — Implementation Progress

**Principle:** the app surfaces only what is *actually implemented*. The activity rail starts
**empty**; a module is added the moment it's built. Marks: `[x]` = built & working in the app ·
`[ ]` = not done. Static placeholders / decided-but-unbuilt items are `[ ]` (with a note), not `[x]`.

- **Canonical UI source:** `design/app.pen` (D33, the `design-expert` agent) — two-tier titlebar.
  Earlier `A` / `OaUSf` in `website.pen` is superseded (D32 → D33).
- **Decisions of record:** `design/app-spec.md` Decision Log (D1–D34).

## Shell / chrome
- [x] Electron + electron-vite + React 19 + TS scaffold (`packages/studio`), builds + runs (WSLg)
- [x] dockview workbench (resizable / dockable panes)
- [x] Monaco editor (local workers, `reverie-dark` theme, minimal `surrealql` language)
- [x] Brand fonts (Geist Variable + JetBrains Mono, ligatures)
- [x] Frameless window + custom window controls (min/max/close) wired via IPC; web build = no OS controls
- [x] Activity rail — canonical **Nav Item** (72px, icon+label, indicator-bar states: default/hover/active/focus). P1 = **Code only**; module items added as they ship, system items (Settings/Help) held until their pages exist (Manuel)
- [x] Two-tier titlebar from `design/app.pen` (D33), rendered:
  - [x] Variation **C (default)** — logo · Reverie · menus · window controls / project + connection switchers · drift chip · account
  - [x] Variation **B (flagged)** — switcher-centric single bar; selected via the `titlebar.variant` **setting** (D36)
- [x] StatusBar component rendered
- [x] Results header — format dropdown (Table/JSON toggle works)
- [x] Static titlebar app-menus **removed** (surface only what's implemented; commands live in the Cmd/K palette)
- [ ] StatusBar shows **static** placeholder data — live wiring pending
- [ ] Titlebar project/connection switchers + drift chip + account are **static** (interactivity pending — needs D28 + project/org subsystems)
- [ ] Result "Tree" view mode (only Table/JSON exist)
- [ ] Action surfaces — not implemented; placement *decided* (design-expert): Run in Query toolbar + Cmd/Enter · Pull/Push via drift chip → diff panel + Migrations bar · Search = Cmd/K palette

## Code Editor view (canonical `design/app.pen` "output treatments")
- [x] **Editor pane = file tabs** — multi-doc tab strip (file-code icon, active = canvas bg + 2px accent underline, dirty dot, close); Monaco bound to the active doc
- [x] **Contextual output pane** — `.surql` active file → Result; `.ts`/`.js` → SurrealQL preview (read-only). Default type derived from the active file's language
- [x] **Reusable `PaneHeader`** (matches `ooDTM`) — type icon + accent-underlined title + **type-switcher dropdown** (SurrealQL / Result / Terminal / Problems, switch in place); lock shown when read-only
- [x] dockview group tab bar hidden — each pane carries its own canonical header (rearrange/detach is Slice 3)
- [x] Result body — **live** results: dynamic table / JSON toggle, row+timing meta, error display
- [x] **Run loop** — Run button + Cmd/Ctrl+Enter → real query results (WASM sandbox engine)
- [ ] **Live codegen** — `.ts` → generated SurrealQL is a read-only placeholder until the main-process engine bridge lands (Slice 2); then linked cursor↔DEFINE highlighting
- [ ] **Full dock** (Slice 3) — N-pane subtabs + `+`, vertical split, detach-to-tab, collapse-to-strip
- [ ] Terminal — real xterm + `sz` output stream (a **static placeholder** pane is currently rendered; Terminal is also a selectable output type)

## Modules (each adds a rail item when implemented)
- [ ] Schema (`sz.*` TS editor → generated SurrealQL)
- [ ] Query / Playground (real toolbar: run modes, saved/history/variables)
- [ ] Explorer (tables · grid · inspector)
- [ ] Migrations (timeline · diff · apply/rollback)
- [ ] Designer (ER canvas ↔ code)
- [ ] Dashboards (component palette · widgets)
- [ ] Diff / Sync (drift · sync · pull)
- [ ] Connections (manager: Personal / org, auth-level form)

## Subsystems
- [x] **State store** — Zustand + `mutative` middleware (D35); holds settings + open docs (tabs) + query/result. Docs model: `docs[]` + `activePath`, per-doc content/dirty, scratch buffer
- [x] **Settings system (D36) — core** — registry (`defineSetting`) + user-scope persistence (`userData/settings.json` via main IPC, sync read = no-flash). First real setting: **`titlebar.variant`** (reactive + persisted; verified)
- [ ] Settings — project scope (`.reverie/settings.json`), and the settings **page UI** (awaits design-expert)
- [x] **Command registry + command palette (cmdk)** (D36/D37) — commands: `query.run`, `titlebar.switchStyle`, `command.palette`, `project.open`, `file.open`, `file.save`; editor Run/Cmd-Enter routed through it
- [x] **Keybinding registry (TanStack Hotkeys)** — registry-driven; `Mod+K` / `Mod+Shift+P` → palette, `Mod+O` → open file, `Mod+S` → save. Cmd/Enter + Cmd/K also bound inside Monaco (editor swallows the chord) so they work when the editor is focused
- [x] **FileSystem adapter (LocalFS)** — main-process `node:fs` over IPC, **scoped to allowed roots** (path-traversal blocked); open project (dir dialog), open/save file → editor loads & writes real files. Verified read+save round-trip.
- [x] **Status-bar segment registry + `statusbar.segments` setting (D38)** — dynamic, settings-driven; **aligned to canonical `design/app.pen`**: left = branch · migrations | ns/db | problems, right = language · cursor | indentation · encoding, with group dividers, multi-status states, `warning-amber` token, 28px, desktop-only Branch
- [ ] Status-bar segment **data + contextual visibility** — wire to real diagnostics / editor focus / connection / git / migrations (currently placeholder + always-shown)
- [ ] MCP server (external agents) + Sidekick (TanStack AI) over the registries (D37)
- [x] **Adapter / runtime pattern established** — `QueryEngine` interface + `runtime` registry + one impl
- [x] **`WasmQueryEngine`** (`@surrealdb/wasm`, renderer, seeded `mem://`) — powers the Run loop (playground profile)
- [ ] Other capability adapters (`Terminal` / `SecretStore`) — not yet created
- [ ] FS: file-tree / project explorer UI, file watching, dirty-state indicator, VirtualFS (web)
- [ ] Connection subsystem (D28): registry + main-process manager + IPC + Remote ws connect/test + switchers
- [ ] Secrets via Electron `safeStorage` (D27)
- [ ] Organizations (D24–D31): workspace switcher, sign-in, share-to-team, org management
- [ ] Local SurrealDB version manager + WSL interop (D15)
- [ ] Migrate engine adapter to main process (`@surrealdb/node` / Remote) when D28 lands

## Tooling / verification
- [x] Screenshot pipeline (`SZ_SHOT` capturePage; WSLg)
- [x] Playwright-Electron drivers (`e2e/drive.mjs`, `e2e/capture.mjs`, `e2e/probe.mjs`)
- [ ] `@playwright/test` E2E specs

## Design references
- `design/app.pen` — canonical app UI (design-expert). `design/website.pen` — earlier frames at Y < 0.
- `design/app-spec.md` — full product spec + Decision Log (D1–D34).
