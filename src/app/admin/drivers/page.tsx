"use client";
import Link from "next/link";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pager from "@/components/Pager";
import { useApi, fmtDateTime, fmtDuration } from "@/lib/client";

interface R { id: number; name: string; active: boolean; shift: { state: "checked_in" | "checked_out"; checkIn: string | null; lastCheckOut: string | null; durationMinutes: number | null; overdue: boolean };
  vehicle: { plate: string; model: string | null } | null; vendor: { name: string | null } | null }
export default function Drivers() {
  const [f, setF] = useState({ search: "", status: "active", shift: "all", vehicle: "", page: 1 });
  const q = new URLSearchParams({ status: f.status, shift: f.shift, page: String(f.page), pageSize: "25", ...(f.search && { search: f.search }), ...(f.vehicle && { vehicle: f.vehicle }) });
  const { data, error, loading } = useApi<{ rows: R[]; total: number; page: number; pageSize: number; generatedAt: string }>(`/api/admin/drivers?${q}`, 30_000);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v, page: 1 }));
  return (
    <AdminShell title="Driver & Shift Monitoring" sub={data ? `Last synchronised with the ERP ${fmtDateTime(data.generatedAt)}` : undefined}>
      <div className="filters" role="search">
        <input aria-label="Search by name or ID" placeholder="Search name or employee ID" value={f.search} onChange={e => set("search", e.target.value)} />
        <input aria-label="Filter by registration" placeholder="Vehicle registration" value={f.vehicle} onChange={e => set("vehicle", e.target.value)} />
        <select aria-label="Employee status" value={f.status} onChange={e => set("status", e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All employees</option></select>
        <select aria-label="Shift state" value={f.shift} onChange={e => set("shift", e.target.value)}><option value="all">Any shift state</option><option value="in">Checked in</option><option value="out">Checked out</option></select>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tbl"><table>
        <thead><tr><th>Driver</th><th>ID</th><th>Status</th><th>Shift</th><th>Check-in</th><th>Last check-out (14 d)</th><th>Duration</th><th>Vehicle</th><th>Vendor</th></tr></thead>
        <tbody>
          {loading && !data && <tr><td colSpan={9}>Loading…</td></tr>}
          {data?.rows.length === 0 && <tr><td colSpan={9}>No drivers match these filters.</td></tr>}
          {data?.rows.map(r => (
            <tr key={r.id}>
              <td><Link href={`/admin/drivers/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link></td><td>{r.id}</td>
              <td><span className={`tag ${r.active ? "g" : ""}`}>{r.active ? "Active" : "Inactive"}</span></td>
              <td><span className={`tag ${r.shift.overdue ? "r" : r.shift.state === "checked_in" ? "g" : ""}`}>{r.shift.overdue ? "Overdue" : r.shift.state === "checked_in" ? "Checked in" : "Checked out"}</span></td>
              <td>{r.shift.checkIn ? fmtDateTime(r.shift.checkIn) : "—"}</td><td>{r.shift.lastCheckOut ? fmtDateTime(r.shift.lastCheckOut) : "—"}</td>
              <td>{fmtDuration(r.shift.durationMinutes) || "—"}</td>
              <td>{r.vehicle ? `${r.vehicle.plate}${r.vehicle.model ? ` · ${r.vehicle.model}` : ""}` : "None"}</td><td>{r.vendor?.name ?? "—"}</td>
            </tr>))}
        </tbody></table></div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={p => setF(s => ({ ...s, page: p }))} />}
    </AdminShell>
  );
}
