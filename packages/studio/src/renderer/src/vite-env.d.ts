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
    ) => Promise<{ ok: boolean; surql?: string; error?: string }>;
  };
}

interface Window {
  studio?: StudioBridge;
}
