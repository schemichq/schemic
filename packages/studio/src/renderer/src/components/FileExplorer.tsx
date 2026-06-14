import {
  ChevronDown,
  ChevronRight,
  Database,
  FileCode,
  FileCog,
  FileJson,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  type LucideIcon,
  MoreHorizontal,
  PanelLeftClose,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type TreeNode, useStudio } from "../store";
import { ContextMenu, type MenuItem } from "./ContextMenu";

// File Explorer — the Code module's secondary sidebar (canonical design/app.pen
// 'File Explorer'). Lazy project tree over the FileSystem adapter; click a file to open
// it. Full keyboard operability (WAI-ARIA tree), right-click context menu, inline rename,
// and inline new file/folder. Visual polish (indent guides, DnD, git status) is backlog.

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

/** Inline text input for rename / new-entry, indented to match a tree row. */
function InlineInput({
  depth,
  initial,
  icon,
  color,
  selectBase,
  onCommit,
  onCancel,
}: {
  depth: number;
  initial: string;
  icon: LucideIcon;
  color: string;
  selectBase: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const Icon = icon;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (selectBase) {
      const dot = initial.lastIndexOf(".");
      el.setSelectionRange(0, dot > 0 ? dot : initial.length);
    } else {
      el.select();
    }
  }, [initial, selectBase]);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = ref.current?.value.trim() ?? "";
    if (commit && v) onCommit(v);
    else onCancel();
  };

  return (
    <div
      className="tree-row tree-row-input"
      style={{ paddingLeft: 8 + depth * 15 }}
    >
      <span className="tree-chevron" />
      <Icon size={14} style={{ color }} className="tree-icon" />
      <input
        ref={ref}
        className="tree-input"
        defaultValue={initial}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
          e.stopPropagation();
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  depth: number;
  focusedPath: string | null;
  renamingPath: string | null;
  creating: { parentDir: string; kind: "file" | "folder" } | null;
  setFocusedPath: (p: string) => void;
  onContext: (e: React.MouseEvent, node: TreeNode) => void;
  onStartRename: (path: string) => void;
  onRenameCommit: (path: string, value: string) => void;
  onRenameCancel: () => void;
  onCreateCommit: (value: string) => void;
  onCreateCancel: () => void;
  register: (path: string, el: HTMLButtonElement | null) => void;
}

function TreeRow(props: RowProps) {
  const {
    node,
    depth,
    focusedPath,
    renamingPath,
    creating,
    setFocusedPath,
    onContext,
    register,
  } = props;
  const expanded = useStudio((s) => !!s.expanded[node.path]);
  const activePath = useStudio((s) => s.activePath);
  const dirty = useStudio((s) =>
    s.docs.some((d) => d.path === node.path && d.dirty),
  );
  const toggleDir = useStudio((s) => s.toggleDir);
  const openFilePath = useStudio((s) => s.openFilePath);

  const active = !node.isDir && node.path === activePath;
  const renaming = renamingPath === node.path;
  const { icon: FIcon, color } = node.isDir
    ? { icon: expanded ? FolderOpen : Folder, color: "var(--text-muted)" }
    : fileIcon(node.name);

  return (
    <>
      {renaming ? (
        <InlineInput
          depth={depth}
          initial={node.name}
          icon={FIcon}
          color={color}
          selectBase
          onCommit={(v) => props.onRenameCommit(node.path, v)}
          onCancel={props.onRenameCancel}
        />
      ) : (
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
          onFocus={() => setFocusedPath(node.path)}
          onClick={() => {
            setFocusedPath(node.path);
            node.isDir
              ? void toggleDir(node.path)
              : void openFilePath(node.path);
          }}
          onDoubleClick={() => props.onStartRename(node.path)}
          onContextMenu={(e) => onContext(e, node)}
        >
          <span className="tree-chevron">
            {node.isDir &&
              (expanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              ))}
          </span>
          <FIcon size={14} style={{ color }} className="tree-icon" />
          <span className="tree-name">{node.name}</span>
          {dirty && <span className="tree-dot" />}
        </button>
      )}
      {node.isDir && expanded && (
        <>
          {creating?.parentDir === node.path && (
            <InlineInput
              depth={depth + 1}
              initial=""
              icon={creating.kind === "folder" ? Folder : FileCode}
              color="var(--text-muted)"
              selectBase={false}
              onCommit={props.onCreateCommit}
              onCancel={props.onCreateCancel}
            />
          )}
          {node.children?.map((child) => (
            <TreeRow
              key={child.path}
              {...props}
              node={child}
              depth={depth + 1}
            />
          ))}
        </>
      )}
    </>
  );
}

export function FileExplorer({ onCollapse }: { onCollapse: () => void }) {
  const tree = useStudio((s) => s.tree);
  const workspaceRoot = useStudio((s) => s.workspaceRoot);
  const openProject = useStudio((s) => s.openProject);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState<{
    parentDir: string;
    kind: "file" | "folder";
  } | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  const projectName = workspaceRoot
    ? (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot)
    : null;

  useEffect(() => {
    if (tree?.[0] && !focusedPath) setFocusedPath(tree[0].path);
  }, [tree, focusedPath]);

  const register = (path: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(path, el);
    else rowRefs.current.delete(path);
  };

  // The directory a create/new action targets: the focused dir, a focused file's parent,
  // or the workspace root.
  const targetDir = (): string => {
    const st = useStudio.getState();
    if (!st.tree || !focusedPath) return workspaceRoot ?? "";
    const row = flattenVisible(st.tree, st.expanded).find(
      (r) => r.node.path === focusedPath,
    );
    if (!row) return workspaceRoot ?? "";
    return row.node.isDir
      ? row.node.path
      : (row.parentPath ?? workspaceRoot ?? "");
  };

  const startCreate = async (parentDir: string, kind: "file" | "folder") => {
    if (
      parentDir !== workspaceRoot &&
      !useStudio.getState().expanded[parentDir]
    )
      await useStudio.getState().toggleDir(parentDir);
    setRenamingPath(null);
    setCreating({ parentDir, kind });
  };

  const commitCreate = (value: string) => {
    const c = creating;
    setCreating(null);
    if (!c) return;
    if (c.kind === "file")
      void useStudio.getState().newFile(c.parentDir, value);
    else void useStudio.getState().newFolder(c.parentDir, value);
  };

  const openContext = (e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    setFocusedPath(node.path);
    const st = useStudio.getState();
    const dir = node.isDir ? node.path : parentOfPath(node.path);
    const name = node.name;
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "New File", onClick: () => void startCreate(dir, "file") },
        { label: "New Folder", onClick: () => void startCreate(dir, "folder") },
        "sep",
        {
          label: "Rename",
          shortcut: "F2",
          onClick: () => setRenamingPath(node.path),
        },
        { label: "Duplicate", onClick: () => void st.duplicateNode(node.path) },
        "sep",
        {
          label: "Copy Path",
          onClick: () => void navigator.clipboard.writeText(node.path),
        },
        {
          label: "Reveal in Finder",
          onClick: () => void st.revealNode(node.path),
        },
        "sep",
        {
          label: "Delete",
          danger: true,
          onClick: () => {
            if (
              window.confirm(`Delete "${name}"? It will be moved to the trash.`)
            )
              void st.deleteNode(node.path);
          },
        },
      ],
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renamingPath || creating) return;
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
      case "F2":
        e.preventDefault();
        setRenamingPath(cur.node.path);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (cur.node.isDir) void st.toggleDir(cur.node.path);
        else void st.openFilePath(cur.node.path);
        break;
    }
  };

  const rowProps = {
    focusedPath,
    renamingPath,
    creating,
    setFocusedPath,
    onContext: openContext,
    onStartRename: (path: string) => {
      setCreating(null);
      setRenamingPath(path);
    },
    onRenameCommit: (path: string, value: string) => {
      setRenamingPath(null);
      void useStudio.getState().renameNode(path, value);
    },
    onRenameCancel: () => setRenamingPath(null),
    onCreateCommit: commitCreate,
    onCreateCancel: () => setCreating(null),
    register,
  };

  return (
    <div className="explorer">
      <div className="explorer-head">
        <FolderOpen size={14} className="explorer-head-icon" />
        <span className="explorer-title">{projectName ?? "Explorer"}</span>
        <div className="pane-spacer" />
        {workspaceRoot && (
          <>
            <button
              type="button"
              className="pane-action"
              title="New File"
              onClick={() => void startCreate(targetDir(), "file")}
            >
              <FilePlus size={14} />
            </button>
            <button
              type="button"
              className="pane-action"
              title="New Folder"
              onClick={() => void startCreate(targetDir(), "folder")}
            >
              <FolderPlus size={14} />
            </button>
            <button
              type="button"
              className="pane-action"
              title="More"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const st = useStudio.getState();
                setMenu({
                  x: r.right - 200,
                  y: r.bottom + 4,
                  items: [
                    {
                      label: "Refresh",
                      onClick: () =>
                        void st.refreshDir(workspaceRoot as string),
                    },
                    {
                      label: "Collapse All",
                      onClick: () =>
                        useStudio.setState((s) => {
                          s.expanded = {};
                        }),
                    },
                    {
                      label: "Reveal in Finder",
                      onClick: () =>
                        void st.revealNode(workspaceRoot as string),
                    },
                  ],
                });
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </>
        )}
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
          {creating?.parentDir === workspaceRoot && (
            <InlineInput
              depth={0}
              initial=""
              icon={creating.kind === "folder" ? Folder : FileCode}
              color="var(--text-muted)"
              selectBase={false}
              onCommit={commitCreate}
              onCancel={() => setCreating(null)}
            />
          )}
          {tree.map((node) => (
            <TreeRow key={node.path} {...rowProps} node={node} depth={0} />
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** Parent directory of a path (local to the component; mirrors the store helper). */
function parentOfPath(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
}
