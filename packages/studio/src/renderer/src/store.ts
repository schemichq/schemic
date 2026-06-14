import { create } from "zustand";
import { mutative } from "zustand-mutative";
import type { Span, SpanLink } from "./adapters/Codegen";
import type { QueryOutcome } from "./adapters/QueryEngine";
import { getFileSystem, getQueryEngine } from "./runtime";
import "./settings/defs"; // register built-in setting definitions (side effect)
import { getSettingDef } from "./settings/registry";

/** One open document = one editor tab. `scratch` docs are not backed by disk. */
export type Doc = {
  path: string;
  name: string;
  language: string;
  content: string;
  dirty: boolean;
  scratch: boolean;
};

/** A node in the project file tree. `children: null` = a directory not yet read. */
export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[] | null;
};

/** Join a child name onto a parent path, matching the parent's separator. */
function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]$/, "")}${sep}${name}`;
}

/** The parent directory of a path. */
function parentOf(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
}

/** Is `path` inside directory `dir`? */
function isUnder(path: string, dir: string): boolean {
  return path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);
}

/** Split a filename into base + extension (extension includes the dot, empty if none). */
function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { base: name.slice(0, dot), ext: name.slice(dot) }
    : { base: name, ext: "" };
}

const IGNORED_ENTRIES = new Set([".git", "node_modules"]);

async function readTree(dir: string): Promise<TreeNode[]> {
  const entries = await getFileSystem().readDir(dir);
  return entries
    .filter(
      (e) => !IGNORED_ENTRIES.has(e.name) && !e.name.includes(".reverie-tmp."),
    )
    .map((e) => ({
      name: e.name,
      path: joinPath(dir, e.name),
      isDir: e.isDir,
      children: null,
    }))
    .sort(
      (a, b) =>
        Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
    );
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children) {
      const hit = findNode(n.children, path);
      if (hit) return hit;
    }
  }
  return null;
}

function langFromPath(name: string): string {
  if (name.endsWith(".surql")) return "surrealql";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "typescript";
  if (name.endsWith(".js")) return "javascript";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".md")) return "markdown";
  return "plaintext";
}

interface StudioState {
  // Settings (user scope) — overrides on top of registered defaults.
  userSettings: Record<string, unknown>;
  setSetting: (key: string, value: unknown) => void;
  // Command palette.
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  // Workspace + project file tree.
  workspaceRoot: string | null;
  openProject: (dir?: string) => Promise<void>;
  tree: TreeNode[] | null;
  expanded: Record<string, boolean>;
  toggleDir: (path: string) => Promise<void>;
  // File mutations (over the FileSystem adapter), each refreshes the affected directory.
  refreshDir: (dirPath: string) => Promise<void>;
  newFile: (parentDir: string, name: string) => Promise<void>;
  newFolder: (parentDir: string, name: string) => Promise<void>;
  renameNode: (path: string, newName: string) => Promise<void>;
  duplicateNode: (path: string) => Promise<void>;
  deleteNode: (path: string) => Promise<void>;
  revealNode: (path: string) => Promise<void>;
  // Open documents (editor tabs).
  docs: Doc[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  closeDoc: (path: string) => void;
  setContent: (path: string, content: string) => void;
  openFileDialog: () => Promise<void>;
  openFilePath: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  // Cursor sync: the codegen span map (per-clause source span <-> generated span), plus the
  // currently-linked pair and which editor drove it — so the OTHER editor reveals + highlights
  // its paired span without an editor highlighting its own cursor.
  codegenMap: SpanLink[];
  setCodegenMap: (map: SpanLink[]) => void;
  linked: {
    source: Span;
    gen: Span;
    from: "editor" | "preview";
  } | null;
  setLinked: (
    linked: {
      source: Span;
      gen: Span;
      from: "editor" | "preview";
    } | null,
  ) => void;
  // Query / results.
  outcome: QueryOutcome | null;
  running: boolean;
  run: () => Promise<void>;
}

const initialSettings =
  (typeof window !== "undefined" && window.studio?.settings?.initial) || {};

/** The active document, or null. Use as a selector: `useStudio(activeDoc)`. */
export const activeDoc = (s: StudioState): Doc | null =>
  s.docs.find((d) => d.path === s.activePath) ?? null;

export const useStudio = create<StudioState>()(
  mutative((set, get) => ({
    userSettings: { ...initialSettings },
    setSetting: (key, value) => {
      set((s) => {
        s.userSettings[key] = value;
      });
      window.studio?.settings.save(get().userSettings);
    },
    paletteOpen: false,
    setPaletteOpen: (open) =>
      set((s) => {
        s.paletteOpen = open;
      }),
    workspaceRoot: null,
    tree: null,
    expanded: {},
    openProject: async (dir) => {
      let root = dir ?? null;
      if (!root) root = (await window.studio?.fs.openDirectoryDialog()) ?? null;
      if (!root) return;
      await window.studio?.fs.addRoot(root);
      const children = await readTree(root);
      set((s) => {
        s.workspaceRoot = root;
        s.tree = children;
        s.expanded = {};
      });
    },
    toggleDir: async (path) => {
      const node = get().tree ? findNode(get().tree as TreeNode[], path) : null;
      if (!node || !node.isDir) return;
      // Lazy-load children the first time. Expand immediately so a loading skeleton
      // shows while readDir is in flight, then fill the children in.
      if (node.children === null) {
        set((s) => {
          s.expanded[path] = true;
        });
        const children = await readTree(path);
        set((s) => {
          const n = s.tree && findNode(s.tree, path);
          if (n) n.children = children;
        });
        return;
      }
      set((s) => {
        s.expanded[path] = !s.expanded[path];
      });
    },
    refreshDir: async (dirPath) => {
      const children = await readTree(dirPath);
      set((s) => {
        if (dirPath === s.workspaceRoot) {
          s.tree = children;
          return;
        }
        const n = s.tree && findNode(s.tree, dirPath);
        if (n) {
          n.children = children;
          s.expanded[dirPath] = true;
        }
      });
    },
    newFile: async (parentDir, name) => {
      const path = joinPath(parentDir, name);
      await getFileSystem().create(path);
      await get().refreshDir(parentDir);
      await get().openFilePath(path);
    },
    newFolder: async (parentDir, name) => {
      await getFileSystem().mkdir(joinPath(parentDir, name));
      await get().refreshDir(parentDir);
    },
    renameNode: async (path, newName) => {
      const parent = parentOf(path);
      const to = joinPath(parent, newName);
      if (to === path) return;
      await getFileSystem().rename(path, to);
      // Re-key any open docs that were the renamed node (or live under a renamed dir).
      set((s) => {
        for (const d of s.docs) {
          if (d.path === path) {
            d.path = to;
            d.name = newName;
            d.language = langFromPath(newName);
          } else if (isUnder(d.path, path)) {
            d.path = to + d.path.slice(path.length);
          }
        }
        if (s.activePath === path) s.activePath = to;
        else if (s.activePath && isUnder(s.activePath, path))
          s.activePath = to + s.activePath.slice(path.length);
      });
      await get().refreshDir(parent);
    },
    duplicateNode: async (path) => {
      const parent = parentOf(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      const { base, ext } = splitName(name);
      const fs = getFileSystem();
      let dest = joinPath(parent, `${base} copy${ext}`);
      for (let n = 2; await fs.exists(dest); n++)
        dest = joinPath(parent, `${base} copy ${n}${ext}`);
      await fs.copy(path, dest);
      await get().refreshDir(parent);
    },
    deleteNode: async (path) => {
      await getFileSystem().trash(path);
      set((s) => {
        const gone = (p: string) => p === path || isUnder(p, path);
        const idx = s.docs.findIndex((d) => gone(d.path));
        s.docs = s.docs.filter((d) => !gone(d.path));
        if (s.activePath && gone(s.activePath)) {
          const next = s.docs[idx] ?? s.docs[idx - 1] ?? null;
          s.activePath = next?.path ?? null;
        }
      });
      await get().refreshDir(parentOf(path));
    },
    revealNode: async (path) => {
      await getFileSystem().reveal(path);
    },
    docs: [],
    activePath: null,
    setActivePath: (path) =>
      set((s) => {
        if (s.docs.some((d) => d.path === path)) s.activePath = path;
      }),
    closeDoc: (path) =>
      set((s) => {
        const idx = s.docs.findIndex((d) => d.path === path);
        if (idx === -1) return;
        s.docs.splice(idx, 1);
        if (s.activePath === path) {
          const next = s.docs[idx] ?? s.docs[idx - 1] ?? null;
          s.activePath = next?.path ?? null;
        }
      }),
    setContent: (path, content) =>
      set((s) => {
        const doc = s.docs.find((d) => d.path === path);
        if (!doc) return;
        doc.content = content;
        if (!doc.scratch) doc.dirty = true;
      }),
    openFileDialog: async () => {
      const path = (await window.studio?.fs.openFileDialog()) ?? null;
      if (path) await get().openFilePath(path);
    },
    openFilePath: async (path) => {
      const existing = get().docs.find((d) => d.path === path);
      if (existing) {
        set((s) => {
          s.activePath = path;
        });
        return;
      }
      const content = await getFileSystem().readFile(path);
      const name = path.split(/[\\/]/).pop() ?? path;
      set((s) => {
        s.docs.push({
          path,
          name,
          language: langFromPath(name),
          content,
          dirty: false,
          scratch: false,
        });
        s.activePath = path;
      });
    },
    saveActive: async () => {
      const doc = activeDoc(get());
      if (!doc || doc.scratch) return;
      await getFileSystem().writeFile(doc.path, doc.content);
      set((s) => {
        const d = s.docs.find((x) => x.path === doc.path);
        if (d) d.dirty = false;
      });
    },
    codegenMap: [],
    setCodegenMap: (map) =>
      set((s) => {
        s.codegenMap = map;
      }),
    linked: null,
    setLinked: (linked) =>
      set((s) => {
        s.linked = linked;
      }),
    outcome: null,
    running: false,
    run: async () => {
      const st = get();
      if (st.running) return;
      const doc = activeDoc(st);
      const sql = doc?.content ?? "";
      set((s) => {
        s.running = true;
      });
      const outcome = await getQueryEngine().query(sql);
      set((s) => {
        s.outcome = outcome;
        s.running = false;
      });
    },
  })),
);

/** Effective setting value: user override if present, else the registered default. */
export function useSetting<T = unknown>(key: string): T {
  return useStudio((s) =>
    key in s.userSettings ? s.userSettings[key] : getSettingDef(key)?.default,
  ) as T;
}

/** Non-reactive read of a setting (for commands / non-React code). */
export function getSetting<T = unknown>(key: string): T {
  const s = useStudio.getState();
  return (
    key in s.userSettings ? s.userSettings[key] : getSettingDef(key)?.default
  ) as T;
}
