import { useEffect, useRef, useState } from "react";
import { type Surreal, surql } from "surrealdb";
import type { App as AppType } from "@schemic/core";
import { connect, signIn, signUp } from "../src/db";
import { User } from "../src/schema";
import { Auth, type AuthFields, type AuthMode } from "./components/Auth";
import { Tracker } from "./components/Tracker";

type AppUser = AppType<typeof User>;
const TOKEN_KEY = "tracker.token";

export function App() {
  const dbRef = useRef<Surreal | null>(null);
  const startedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadUser(db: Surreal): Promise<AppUser | null> {
    // `decode` on the client: the row's RecordId / DateTime become app types.
    const [rows] = await db.query<[unknown[]]>(surql`SELECT * FROM user WHERE id = $auth.id`);
    return rows[0] ? User.decode(rows[0]) : null;
  }

  useEffect(() => {
    if (startedRef.current) return; // guard React StrictMode double-mount
    startedRef.current = true;
    (async () => {
      const db = await connect();
      dbRef.current = db;
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        try {
          await db.authenticate(token);
          setUser(await loadUser(db));
        } catch {
          localStorage.removeItem(TOKEN_KEY);
        }
      }
      setReady(true);
    })();
  }, []);

  async function handleAuth(mode: AuthMode, fields: AuthFields) {
    const db = dbRef.current;
    if (!db) return;
    setBusy(true);
    setError(null);
    try {
      const token =
        mode === "signup"
          ? await signUp(db, fields)
          : await signIn(db, { email: fields.email, pass: fields.pass });
      localStorage.setItem(TOKEN_KEY, token);
      setUser(await loadUser(db));
    } catch (e) {
      setError((e as Error).message ?? "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    localStorage.removeItem(TOKEN_KEY);
    try {
      await dbRef.current?.invalidate();
    } catch {
      /* ignore */
    }
    setUser(null);
  }

  if (!ready) return <div className="center muted">Connecting to SurrealDB…</div>;
  if (!user || !dbRef.current) return <Auth busy={busy} error={error} onSubmit={handleAuth} />;
  return <Tracker db={dbRef.current} user={user} onSignOut={handleSignOut} />;
}
