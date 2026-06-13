import { contextBridge, ipcRenderer } from "electron";

// Minimal, safe surface for the renderer. Grows as the studio needs main-process APIs.
contextBridge.exposeInMainWorld("studio", {
  platform: process.platform,
  versions: process.versions,
  window: {
    minimize: () => ipcRenderer.send("win:minimize"),
    maximize: () => ipcRenderer.send("win:maximize"),
    close: () => ipcRenderer.send("win:close"),
  },
  settings: {
    // Synchronous so the store can initialize before first paint (no flash).
    initial: ipcRenderer.sendSync("settings:read") as Record<string, unknown>,
    save: (values: Record<string, unknown>) =>
      ipcRenderer.send("settings:write", values),
  },
  fs: {
    read: (path: string): Promise<string> =>
      ipcRenderer.invoke("fs:read", path),
    write: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke("fs:write", path, content),
    readdir: (path: string) => ipcRenderer.invoke("fs:readdir", path),
    exists: (path: string): Promise<boolean> =>
      ipcRenderer.invoke("fs:exists", path),
    addRoot: (path: string): Promise<void> =>
      ipcRenderer.invoke("fs:addRoot", path),
    openDirectoryDialog: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:openDirectory"),
    openFileDialog: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:openFile"),
  },
  codegen: {
    fromFile: (
      path: string,
      content?: string,
    ): Promise<{ ok: boolean; surql?: string; error?: string }> =>
      ipcRenderer.invoke("codegen:fromFile", path, content),
  },
});
