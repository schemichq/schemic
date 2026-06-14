// Capability interface: filesystem access. Impls are chosen by the runtime profile
// (LocalFS over IPC on desktop; VirtualFS in the web playground; remote/cloud later).
// Async so an impl can be in-process or IPC-backed transparently. (D34)

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface FileSystem {
  readonly id: string;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  exists(path: string): Promise<boolean>;
  /** Create an empty file (fails if it already exists). */
  create(path: string): Promise<void>;
  /** Create a directory (fails if it already exists). */
  mkdir(path: string): Promise<void>;
  /** Move/rename a path. */
  rename(from: string, to: string): Promise<void>;
  /** Recursively copy a file/dir (fails if the destination exists). */
  copy(from: string, to: string): Promise<void>;
  /** Send a path to the OS trash (recoverable). */
  trash(path: string): Promise<void>;
  /** Reveal a path in the OS file manager. */
  reveal(path: string): Promise<void>;
}
