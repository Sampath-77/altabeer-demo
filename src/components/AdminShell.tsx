"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LayoutDashboard, Users, Car, Building2, ScanSearch, RefreshCw, ScrollText, BarChart3, LogOut, ClipboardList, ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import AppBrandWatermark from "./AppBrandWatermark";

const items = [
  ["/admin", "Overview", LayoutDashboard],
  ["/admin/drivers", "Driver & Shift Monitoring", Users],
  ["/admin/daily-reports", "Daily Reports", ClipboardList],
  ["/admin/compliance", "Driver Compliance", ShieldCheck],
  ["/admin/fines", "Fine Detection", ScanSearch],
  ["/admin/reports", "Reports", BarChart3],
  ["/admin/vehicles", "Vehicles", Car],
  ["/admin/vendors", "Vendors", Building2],
  ["/admin/sync", "Sync status", RefreshCw],
  ["/admin/audit", "Audit log", ScrollText],
] as const;
export default function AdminShell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  const p = usePathname(); const [ok, setOk] = useState(false);
  const [adminUser, setAdminUser] = useState<{ loginId: string; name?: string | null; jobTitle?: string | null } | null>(null);
  useEffect(() => {
    api<{ user: { role: string; loginId: string; name?: string | null; jobTitle?: string | null } }>("/api/me")
      .then(r => {
        if (r.user.role !== "ADMIN") location.href = "/";
        else {
          setAdminUser(r.user);
          setOk(true);
        }
      })
      .catch(() => {});
  }, []);
  async function out() { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.href = "/login"; }
  if (!ok) return <div className="adm"><div className="content">Checking access…</div></div>;
  return (
    <div className="adm">
      <AppBrandWatermark />
      <aside>
        <div style={{ padding: "0 8px 12px" }}>
          <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>Al Tabeer Admin</h1>
          {adminUser && (
            <small style={{ color: "var(--orange)", fontWeight: 600, display: "block", fontSize: 12 }}>
              {adminUser.name ? `${adminUser.name} (${adminUser.jobTitle ?? "Admin"})` : adminUser.loginId}
            </small>
          )}
        </div>
        {items.map(([h, l, I]) => <Link key={h} href={h} aria-current={p === h || (h !== "/admin" && p.startsWith(h)) ? "page" : undefined}><I size={18} />{l}</Link>)}
        <button onClick={out} style={{ marginTop: "auto" }}><LogOut size={18} />Sign out</button>
      </aside>
      <div className="content"><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}{children}</div>
    </div>
  );
}
