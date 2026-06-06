import { type FormEvent, useState } from "react";

export type AuthMode = "signin" | "signup";
export interface AuthFields {
  name: string;
  email: string;
  pass: string;
}

interface AuthProps {
  busy: boolean;
  error: string | null;
  onSubmit: (mode: AuthMode, fields: AuthFields) => void;
}

/** Sign up / sign in directly against SurrealDB record access. */
export function Auth({ busy, error, onSubmit }: AuthProps) {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [fields, setFields] = useState<AuthFields>({ name: "", email: "", pass: "" });

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit(mode, fields);
  }

  return (
    <div className="center">
      <form className="card auth" onSubmit={submit}>
        <h1>tracker</h1>
        <p className="muted">Direct-to-SurrealDB, schema shared via surreal-zod.</p>

        <div className="tabs">
          <button
            type="button"
            className={mode === "signin" ? "active" : ""}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
          >
            Sign up
          </button>
        </div>

        {mode === "signup" && (
          <label>
            Name
            <input
              value={fields.name}
              onChange={(e) => setFields({ ...fields, name: e.target.value })}
              required
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            value={fields.email}
            onChange={(e) => setFields({ ...fields, email: e.target.value })}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={fields.pass}
            onChange={(e) => setFields({ ...fields, pass: e.target.value })}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
