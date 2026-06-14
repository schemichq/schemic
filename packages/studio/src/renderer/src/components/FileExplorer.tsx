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
import { type TreeNode, useStudio } from "../store";

// File Explorer — the Code module's secondary sidebar (canonical design/app.pen
// 'File Explorer'). Lazy project tree over the FileSystem adapter; click a file to
// open it as a tab. New File / context menu land when those flows are built.

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

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const expanded = useStudio((s) => !!s.expanded[node.path]);
  const activePath = useStudio((s) => s.activePath);
  const dirty = useStudio((s) =>
    s.docs.some((d) => d.path === node.path && d.dirty),
  );
  const toggleDir = useStudio((s) => s.toggleDir);
  const openFilePath = useStudio((s) => s.openFilePath);

  const active = !node.isDir && node.path === activePath;
  const { icon: FIcon, color } = node.isDir
    ? {
        icon: expanded ? FolderOpen : Folder,
        color: "var(--text-muted)",
      }
    : fileIcon(node.name);

  return (
    <>
      <button
        type="button"
        className={`tree-row${active ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 15 }}
        onClick={() =>
          node.isDir ? void toggleDir(node.path) : void openFilePath(node.path)
        }
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
          <TreeRow key={child.path} node={child} depth={depth + 1} />
        ))}
    </>
  );
}

export function FileExplorer({ onCollapse }: { onCollapse: () => void }) {
  const tree = useStudio((s) => s.tree);
  const workspaceRoot = useStudio((s) => s.workspaceRoot);
  const openProject = useStudio((s) => s.openProject);

  const projectName = workspaceRoot
    ? (workspaceRoot.split(/[\\/]/).filter(Boolean).pop() ?? workspaceRoot)
    : null;

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
        <div className="tree-scroll">
          {tree.map((node) => (
            <TreeRow key={node.path} node={node} depth={0} />
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
