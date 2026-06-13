import { create } from "zustand";
import { mutative } from "zustand-mutative";
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

function langFromPath(name: string): string {
  if (name.endsWith(".surql")) return "surrealql";
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return "typescript";
  if (name.endsWith(".js")) return "javascript";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".md")) return "markdown";
  return "plaintext";
}

const DEFAULT_QUERY = `-- edit and Run (Cmd/Ctrl+Enter)
SELECT id, name, email, age
FROM user
WHERE age >= 18
ORDER BY age DESC;`;

const SCRATCH_PATH = "scratch://query.surql";

function scratchDoc(): Doc {
  return {
    path: SCRATCH_PATH,
    name: "query.surql",
    language: "surrealql",
    content: DEFAULT_QUERY,
    dirty: false,
    scratch: true,
  };
}

interface StudioState {
  // Settings (user scope) — overrides on top of registered defaults.
  userSettings: Record<string, unknown>;
  setSetting: (key: string, value: unknown) => void;
  // Command palette.
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  // Workspace.
  workspaceRoot: string | null;
  openProject: (dir?: string) => Promise<void>;
  // Open documents (editor tabs).
  docs: Doc[];
  activePath: string | null;
  setActivePath: (path: string) => void;
  closeDoc: (path: string) => void;
  setContent: (path: string, content: string) => void;
  openFileDialog: () => Promise<void>;
  openFilePath: (path: string) => Promise<void>;
  saveActive: () => Promise<void>;
  /** Bumps when a file is written to disk — codegen reads disk, so it re-runs on save. */
  fileEpoch: number;
  // Linked highlighting: the field/table identifier under the editor cursor, matched
  // against generated DEFINE lines in the SurrealQL preview.
  linkedName: string | null;
  setLinkedName: (name: string | null) => void;
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
    openProject: async (dir) => {
      let root = dir ?? null;
      if (!root) root = (await window.studio?.fs.openDirectoryDialog()) ?? null;
      if (!root) return;
      await window.studio?.fs.addRoot(root);
      set((s) => {
        s.workspaceRoot = root;
      });
    },
    docs: [scratchDoc()],
    activePath: SCRATCH_PATH,
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
        s.fileEpoch++;
      });
    },
    fileEpoch: 0,
    linkedName: null,
    setLinkedName: (name) =>
      set((s) => {
        if (s.linkedName !== name) s.linkedName = name;
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
