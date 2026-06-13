/// <reference types="vite/client" />

interface StudioBridge {
  platform: string;
  versions: Record<string, string | undefined>;
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
  settings: {
    initial: Record<string, unknown>;
    save: (values: Record<string, unknown>) => void;
  };
  fs: {
    read: (path: string) => Promise<string>;
    write: (path: string, content: string) => Promise<void>;
    readdir: (path: string) => Promise<Array<{ name: string; isDir: boolean }>>;
    exists: (path: string) => Promise<boolean>;
    addRoot: (path: string) => Promise<void>;
    openDirectoryDialog: () => Promise<string | null>;
    openFileDialog: () => Promise<string | null>;
  };
  codegen: {
    fromFile: (
      path: string,
      content?: string,
    ) => Promise<{ ok: boolean; surql?: string; error?: string }>;
  };
  lsp: {
    notify: (command: string, args: unknown) => void;
    request: (command: string, args: unknown) => Promise<unknown>;
    onEvent: (cb: (msg: unknown) => void) => () => void;
  };
  surql: {
    available: () => Promise<boolean>;
    notify: (method: string, params: unknown, rootUri: string | null) => void;
    request: (
      method: string,
      params: unknown,
      rootUri: string | null,
    ) => Promise<unknown>;
    onEvent: (cb: (msg: unknown) => void) => () => void;
  };
}

interface Window {
  studio?: StudioBridge;
}
