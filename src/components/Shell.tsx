"use client";
import Nav from "./Nav";
import { LogOut } from "lucide-react";
import { api } from "@/lib/client";

export default function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  }

  return (
    <div className="app">
      <header className="hdr" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <button onClick={logout} className="icon-btn" title="Sign out" aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>
      <main>{children}</main>
      <Nav />
    </div>
  );
}
