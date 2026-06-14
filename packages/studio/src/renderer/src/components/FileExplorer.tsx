import {
  ChevronDown,
  ChevronRight,
  Database,
  FileCode,
  FileCog,
  FileJson,
  Folder,
  FolderOpen,
  type LucideIcon,
  PanelLeftClose,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type TreeNode, useStudio } from "../store";

// File Explorer — the Code module's secondary sidebar (canonical design/app.pen
// 'File Explorer'). Lazy project tree over the FileSystem adapter; click a file to
// open it as a tab. Full keyboard operability (WAI-ARIA tree + roving tabindex).
// Context menu / inline rename / new-file flows land next.

function fileIcon(name: string): { icon: LucideIcon; color: string } {
  if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !name.includes(".config."))
    return { icon: FileCode, color: "var(--code-fn)" };
  if (name.endsWith(".surql"))
    return { icon: Database, color: "var(--code-type)" };
  if (name.includes(".config.") || name === "surreal-zod.config.ts")
    return { icon: FileCog, color: "var(--text-muted)" };
  if (name.endsWith(".json"))
    return { icon: FileJson, color: "var(--text-muted)" };
  return { icon: FileCode, color: "var(--text-muted)" };
}

/** A visible (expanded-into) row: node + depth + its parent's path, in display order. */
interface FlatRow {
  node: TreeNode;
  depth: number;
  parentPath: string | null;
}

function flattenVisible(
  nodes: TreeNode[],
  expanded: Record<string, boolean>,
  depth = 0,
  parentPath: string | null = null,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    out.push({ node, depth, parentPath });
    if (node.isDir && expanded[node.path] && node.children)
      flattenVisible(node.children, expanded, depth + 1, node.path, out);
  }
  return out;
}

interface RowProps {
  node: TreeNode;
  depth: number;
  focusedPath: string | null;
  setFocusedPath: (p: string) => void;
  register: (path: string, el: HTMLButtonElement | null) => void;
}

function TreeRow({ node, depth, focusedPath, setFocusedPath, register }: RowProps) {
  const expanded = useStudio((s) => !!s.expanded[node.path]);
  const activePath = useStudio((s) => s.activePath);
  const dirty = useStudio((s) =>
    s.docs.some((d) => d.path === node.path && d.dirty),
  );
  const toggleDir = useStudio((s) => s.toggleDir);
  const openFilePath = useStudio((s) => s.openFilePath);

  const active = !node.isDir && node.path === activePath;
  const { icon: FIcon, color } = node.isDir
    ? { icon: expanded ? FolderOpen : Folder, color: "var(--text-muted)" }
    : fileIcon(node.name);

  return (
    <>
      <button
        type="button"
        // biome-ignore lint/a11y/useSemanticElements: button styled as a treeitem for roving-tabindex keyboard nav.
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={node.isDir ? expanded : undefined}
        aria-selected={active}
        tabIndex={node.path === focusedPath ? 0 : -1}
        ref={(el) => register(node.path, el)}
        className={`tree-row${active ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 15 }}
        onClick={() => {
          setFocusedPath(node.path);
          node.isDir ? void toggleDir(node.path) : void openFilePath(node.path);
        }}
      >
        <span className="tree-chevron">
          {node.isDir &&
            (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </span>
        <FIcon size={14} style={{ color }} className="tree-icon" />
        <span className="tree-name">{node.name}</span>
        {dirty && <span className="tree-dot" />}
      </button>
      {node.isDir &&
        expanded &&
        node.children?.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            focusedPath={focusedPath}
            setFocusedPath={setFocusedPath}
            register={register}
          />
        ))}
    </>
  );
}

export function FileExplorer({ onCollapse }: { onCollapse: () => void }) {
  const tree = useStudio((s) => s.tree);
  const workspaceRoot = useStudio((s) => s.workspaceRoot);
  const openProject = useStudio((s) => s.openProject);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const projectName = workspaceRoot
    ? (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot)
    : null;

  // Seed the roving focus on the first row once a tree loads.
  useEffect(() => {
    if (tree?.[0] && !focusedPath) setFocusedPath(tree[0].path);
  }, [tree, focusedPath]);

  const register = (path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  };

  // WAI-ARIA tree keyboard model. Reads live store state so the visible-row list is current.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const st = useStudio.getState();
    if (!st.tree) return;
    const rows = flattenVisible(st.tree, st.expanded);
    const idx = rows.findIndex((r) => r.node.path === focusedPath);
    if (idx === -1) return;
    const cur = rows[idx];
    const focus = (p: string) => {
      setFocusedPath(p);
      rowRefs.current.get(p)?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (idx < rows.length - 1) focus(rows[idx + 1].node.path);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx > 0) focus(rows[idx - 1].node.path);
        break;
      case "Home":
        e.preventDefault();
        focus(rows[0].node.path);
        break;
      case "End":
        e.preventDefault();
        focus(rows[rows.length - 1].node.path);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (cur.node.isDir) {
          if (!st.expanded[cur.node.path]) void st.toggleDir(cur.node.path);
          else if (rows[idx + 1]?.parentPath === cur.node.path)
            focus(rows[idx + 1].node.path);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (cur.node.isDir && st.expanded[cur.node.path])
          void st.toggleDir(cur.node.path);
        else if (cur.parentPath) focus(cur.parentPath);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (cur.node.isDir) void st.toggleDir(cur.node.path);
        else void st.openFilePath(cur.node.path);
        break;
    }
  };

  return (
    <div className="explorer">
      <div className="explorer-head">
        <FolderOpen size={14} className="explorer-head-icon" />
        <span className="explorer-title">{projectName ?? "Explorer"}</span>
        <div className="pane-spacer" />
        <button
          type="button"
          className="pane-action"
          title="Collapse Explorer"
          onClick={onCollapse}
        >
          <PanelLeftClose size={14} />
        </button>
      </div>
      {tree ? (
        // biome-ignore lint/a11y/useSemanticElements: ARIA tree container for keyboard navigation.
        <div
          className="tree-scroll"
          role="tree"
          aria-label="Project files"
          onKeyDown={onKeyDown}
        >
          {tree.map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              focusedPath={focusedPath}
              setFocusedPath={setFocusedPath}
              register={register}
            />
          ))}
        </div>
      ) : (
        <div className="explorer-empty">
          <FolderOpen size={30} className="explorer-empty-icon" />
          <p className="explorer-empty-title">No project open</p>
          <p className="explorer-empty-hint">
            Open a surreal-zod project folder.
          </p>
          <button
            type="button"
            className="run-btn explorer-open"
            onClick={() => void openProject()}
          >
            <FolderOpen size={14} />
            Open Folder
          </button>
        </div>
      )}
    </div>
  );
}
