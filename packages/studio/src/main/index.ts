import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { generateSurql } from "./codegen";
import { setTsEventSink, stopTsServer, tsNotify, tsRequest } from "./lsp";
import {
  setSurqlEventSink,
  stopSurqlLsp,
  surqlLspAvailable,
  surqlNotify,
  surqlRequest,
} from "./surqlLsp";

// WSL/headless friendliness: avoid GPU + sandbox issues when running under WSLg.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("no-sandbox");
// The @surrealdb/wasm engine uses SharedArrayBuffer; enable it without requiring
// cross-origin isolation (which file:// can't satisfy cleanly).
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer");

// Custom-titlebar window controls (the chrome draws its own traffic lights).
ipcMain.on("win:minimize", (e) =>
  BrowserWindow.fromWebContents(e.sender)?.minimize(),
);
ipcMain.on("win:maximize", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on("win:close", (e) =>
  BrowserWindow.fromWebContents(e.sender)?.close(),
);

// User settings persistence (`userData/settings.json`). Sync read so the renderer can
// init settings before first paint (no flash); async write on change.
const settingsPath = () => join(app.getPath("userData"), "settings.json");
function readUserSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}
ipcMain.on("settings:read", (e) => {
  e.returnValue = readUserSettings();
});
ipcMain.on("settings:write", (_e, values: Record<string, unknown>) => {
  try {
    const p = settingsPath();
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(values, null, 2));
  } catch (err) {
    console.error("settings write failed", err);
  }
});

// Filesystem access, scoped to explicitly-allowed roots (opened projects/files) so
// the renderer can't read/write arbitrary paths. Roots are added by the open dialogs
// or `fs:addRoot`. (FileSystem capability adapter, D34.)
const allowedRoots = new Set<string>();
function addRoot(p: string): void {
  allowedRoots.add(resolve(p));
}
function assertAllowed(p: string): string {
  const abs = resolve(p);
  for (const root of allowedRoots) {
    if (abs === root || abs.startsWith(root + sep)) return abs;
  }
  throw new Error(`path outside any open workspace: ${p}`);
}
ipcMain.handle("fs:addRoot", (_e, p: string) => addRoot(p));
ipcMain.handle("fs:read", (_e, p: string) =>
  readFile(assertAllowed(p), "utf8"),
);
ipcMain.handle("fs:write", async (_e, p: string, c: string) => {
  await writeFile(assertAllowed(p), c, "utf8");
});
ipcMain.handle("fs:readdir", async (_e, p: string) => {
  const entries = await readdir(assertAllowed(p), { withFileTypes: true });
  return entries.map((d) => ({ name: d.name, isDir: d.isDirectory() }));
});
ipcMain.handle("fs:exists", async (_e, p: string) => {
  try {
    await stat(assertAllowed(p));
    return true;
  } catch {
    return false;
  }
});
// Generate SurrealQL from a schema file (path-scoped like fs:*). The codegen runs the
// user's TS via jiti in the main process. (Engine bridge, Slice 2.)
ipcMain.handle("codegen:fromFile", (_e, p: string, content?: string) =>
  generateSurql(assertAllowed(p), content),
);

// Real TypeScript language service (tsserver). The renderer opens/edits docs via notify
// and asks for completions/hover/etc via request; tsserver events (diagnostics) are
// pushed back on `lsp:event`. tsserver reads the project from disk (node_modules/tsconfig).
setTsEventSink((msg) => {
  for (const w of BrowserWindow.getAllWindows())
    w.webContents.send("lsp:event", msg);
});
ipcMain.on("lsp:notify", (_e, command: string, args: unknown) =>
  tsNotify(command, args),
);
ipcMain.handle("lsp:request", (_e, command: string, args: unknown) =>
  tsRequest(command, args),
);

// SurrealQL language server (standalone stdio LSP) for .surql intelligence. Optional —
// only wired if the binary is found (env SURREALQL_LSP / PATH / ~/.cargo/bin).
setSurqlEventSink((msg) => {
  for (const w of BrowserWindow.getAllWindows())
    w.webContents.send("surql:event", msg);
});
ipcMain.handle("surql:available", () => surqlLspAvailable());
ipcMain.on(
  "surql:notify",
  (_e, method: string, params: unknown, rootUri: string | null) =>
    void surqlNotify(method, params, rootUri),
);
ipcMain.handle(
  "surql:request",
  (_e, method: string, params: unknown, rootUri: string | null) =>
    surqlRequest(method, params, rootUri),
);

ipcMain.handle("dialog:openDirectory", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  const dir = r.canceled ? null : (r.filePaths[0] ?? null);
  if (dir) addRoot(dir);
  return dir;
});
ipcMain.handle("dialog:openFile", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"] });
  const file = r.canceled ? null : (r.filePaths[0] ?? null);
  if (file) addRoot(dirname(file));
  return file;
});

// Dev screenshot hook: SZ_SHOT=<path> captures the renderer once loaded, then quits.
const SHOT = process.env.SZ_SHOT;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    backgroundColor: "#0e0c14",
    title: "Reverie Studio",
    frame: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (SHOT) {
    win.webContents.once("did-finish-load", async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const image = await win.webContents.capturePage();
      writeFileSync(SHOT, image.toPNG());
      app.quit();
    });
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopTsServer();
  stopSurqlLsp();
  app.quit();
});
