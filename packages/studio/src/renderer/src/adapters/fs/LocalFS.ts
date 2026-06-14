import type { DirEntry, FileSystem } from "../FileSystem";

// Desktop filesystem: proxies to the main process over IPC (main owns node:fs and
// enforces the allowed-roots scoping). The web playground will use a VirtualFS instead.
export class LocalFS implements FileSystem {
  readonly id = "local";
  private get bridge() {
    const fs = window.studio?.fs;
    if (!fs) throw new Error("filesystem unavailable (no main process)");
    return fs;
  }
  readFile(path: string): Promise<string> {
    return this.bridge.read(path);
  }
  writeFile(path: string, content: string): Promise<void> {
    return this.bridge.write(path, content);
  }
  readDir(path: string): Promise<DirEntry[]> {
    return this.bridge.readdir(path);
  }
  exists(path: string): Promise<boolean> {
    return this.bridge.exists(path);
  }
  create(path: string): Promise<void> {
    return this.bridge.create(path);
  }
  mkdir(path: string): Promise<void> {
    return this.bridge.mkdir(path);
  }
  rename(from: string, to: string): Promise<void> {
    return this.bridge.rename(from, to);
  }
  copy(from: string, to: string): Promise<void> {
    return this.bridge.copy(from, to);
  }
  trash(path: string): Promise<void> {
    return this.bridge.trash(path);
  }
  reveal(path: string): Promise<void> {
    return this.bridge.reveal(path);
  }
}
