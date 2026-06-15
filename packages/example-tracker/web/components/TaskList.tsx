import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Duration, type Surreal } from "surrealdb";
import type { App } from "@schemic/core";
import type { Task, User } from "../../src/schema";
import {
  type AppProject,
  type AppTask,
  createTask,
  deleteTask,
  listTasks,
  updateTask,
  watchTasks,
} from "../api";

type Status = App<typeof Task>["status"];
type Priority = App<typeof Task>["priority"];
const STATUSES: Status[] = ["todo", "in_progress", "done", "archived"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

interface TaskListProps {
  db: Surreal;
  project: AppProject;
  user: App<typeof User>;
}

export function TaskList({ db, project }: TaskListProps) {
  const [tasks, setTasks] = useState<AppTask[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [estimate, setEstimate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;

  const refresh = useCallback(async () => {
    setTasks(await listTasks(db, projectRef.current.id));
  }, [db]);

  // Initial load + realtime via LIVE SELECT (re-fetch the visible list on any change).
  useEffect(() => {
    void refresh();
    let cleanup = () => {};
    void watchTasks(db, () => void refresh()).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup();
  }, [db, refresh, project.id]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      const input: Parameters<typeof createTask>[1] = {
        project: project.id,
        title: title.trim(),
        priority,
      };
      if (estimate.trim()) input.estimate = new Duration(estimate.trim());
      await createTask(db, input);
      setTitle("");
      setEstimate("");
      setPriority("medium");
      await refresh();
    } catch (e) {
      setError((e as Error).message ?? "Could not create task");
    }
  }

  async function setStatus(t: AppTask, status: Status) {
    await updateTask(db, t.id, {
      status,
      completedAt: status === "done" ? new Date() : null,
    });
    await refresh();
  }

  async function setTaskPriority(t: AppTask, p: Priority) {
    await updateTask(db, t.id, { priority: p });
    await refresh();
  }

  async function remove(t: AppTask) {
    await deleteTask(db, t.id);
    await refresh();
  }

  return (
    <section className="tasks">
      <header className="tasks-head">
        <h2>
          <span className="dot" style={{ background: project.color }} />
          {project.name}
        </h2>
        <span className="muted small">{tasks.length} tasks · realtime</span>
      </header>

      <form className="newtask" onSubmit={onCreate}>
        <input
          className="grow"
          placeholder="Add a task…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          className="estimate"
          placeholder="est. (2h30m)"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="submit" className="primary">
          Add
        </button>
      </form>
      {error && <p className="error">{error}</p>}

      <ul className="tasklist">
        {tasks.map((t) => (
          <li key={String(t.id)} className={`task ${t.status === "done" ? "done" : ""}`}>
            <input
              type="checkbox"
              checked={t.status === "done"}
              onChange={(e) => setStatus(t, e.target.checked ? "done" : "todo")}
            />
            <div className="task-main">
              <span className="task-title">{t.title}</span>
              <div className="task-meta">
                <span className={`badge prio-${t.priority}`}>{t.priority}</span>
                {t.estimate && <span className="badge">{t.estimate.toString()}</span>}
                {t.completedAt && (
                  <span className="muted small">done {t.completedAt.toLocaleDateString()}</span>
                )}
              </div>
            </div>
            <select
              value={t.status}
              onChange={(e) => setStatus(t, e.target.value as Status)}
              className="status"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={t.priority}
              onChange={(e) => setTaskPriority(t, e.target.value as Priority)}
              className="status"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <button type="button" className="del" onClick={() => remove(t)} title="Delete">
              ×
            </button>
          </li>
        ))}
        {tasks.length === 0 && <p className="muted small">No tasks yet — add one above.</p>}
      </ul>
    </section>
  );
}
