import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Surreal } from "surrealdb";
import type { App } from "surreal-zod";
import type { User } from "../../src/schema";
import { type AppProject, createProject, listProjects } from "../api";
import { TaskList } from "./TaskList";

interface TrackerProps {
  db: Surreal;
  user: App<typeof User>;
  onSignOut: () => void;
}

export function Tracker({ db, user, onSignOut }: TrackerProps) {
  const [projects, setProjects] = useState<AppProject[]>([]);
  const [selected, setSelected] = useState<AppProject | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listProjects(db);
    setProjects(list);
    setSelected((cur) => list.find((p) => String(p.id) === String(cur?.id)) ?? list[0] ?? null);
  }, [db]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    try {
      // `Create<typeof Project>`: only `name` is required; owner/createdAt/settings
      // are DB-filled, so `make()` lets us omit them.
      const created = await createProject(db, { name: name.trim() });
      setName("");
      await refresh();
      setSelected(created);
    } catch (e) {
      setError((e as Error).message ?? "Could not create project");
    }
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          tracker
          <span className="who">{user.name}</span>
        </div>

        <form className="newproject" onSubmit={onCreate}>
          <input
            placeholder="New project…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="primary">
            +
          </button>
        </form>
        {error && <p className="error">{error}</p>}

        <nav className="projects">
          {projects.map((p) => (
            <button
              type="button"
              key={String(p.id)}
              className={`project ${String(p.id) === String(selected?.id) ? "active" : ""}`}
              onClick={() => setSelected(p)}
            >
              <span className="dot" style={{ background: p.color }} />
              <span className="pname">{p.name}</span>
            </button>
          ))}
          {projects.length === 0 && <p className="muted small">No projects yet.</p>}
        </nav>

        <button type="button" className="signout" onClick={onSignOut}>
          Sign out
        </button>
      </aside>

      <main className="main">
        {selected ? (
          <TaskList db={db} project={selected} user={user} />
        ) : (
          <div className="center muted">Create a project to get started.</div>
        )}
      </main>
    </div>
  );
}
