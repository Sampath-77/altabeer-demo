"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export default function Login() {
  const [loginId, setId] = useState(""); const [password, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api<{ user: { role: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify({ loginId, password }) });
      window.location.replace(r.user.role === "ADMIN" ? "/admin" : "/");
    }
    catch (x) { setErr((x as Error).message); setBusy(false); }
  }
  return (
    <div className="app"><main className="login">
      <div className="hdr"><h1>Al Tabeer</h1><p>Sign in with the login ID provided by Al Tabeer</p></div>
      <form onSubmit={submit} className="card">
        {err && <div className="err" role="alert">{err}</div>}
        <label className="field">Login ID<input value={loginId} onChange={e => setId(e.target.value)} autoComplete="username" required /></label>
        <label className="field">Password<input type="password" value={password} onChange={e => setPw(e.target.value)} autoComplete="current-password" required /></label>
        <button className="btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </main></div>
  );
}
