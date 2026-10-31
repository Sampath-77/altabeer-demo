"use client";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pager from "@/components/Pager";
import { useApi } from "@/lib/client";

interface V { id: number; plate: string; model: string | null; active: boolean; vendor: { name: string | null } | null; driver: { name: string | null; since: string } | null }
export default function Vehicles() {
  const [search, setSearch] = useState(""); const [status, setStatus] = useState("active"); const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ rows: V[]; total: number; page: number; pageSize: number }>(`/api/admin/vehicles?status=${status}&page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  return (
    <AdminShell title="Vehicles" sub="Registration, vendor and current driver from the ERP. Fine history arrives with the fines stage.">
      <div className="filters">
        <input aria-label="Search registration" placeholder="Search registration" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Vehicle status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tbl"><table><thead><tr><th>Registration</th><th>Make / model</th><th>Status</th><th>Vendor</th><th>Current driver</th></tr></thead><tbody>
        {loading && !data && <tr><td colSpan={5}>Loading…</td></tr>}{data?.rows.length === 0 && <tr><td colSpan={5}>No vehicles match.</td></tr>}
        {data?.rows.map(v => <tr key={v.id}><td><b>{v.plate}</b></td><td>{v.model ?? "—"}</td><td><span className={`tag ${v.active ? "g" : ""}`}>{v.active ? "Active" : "Inactive"}</span></td><td>{v.vendor?.name ?? "—"}</td><td>{v.driver?.name ?? "Unassigned"}</td></tr>)}
      </tbody></table></div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </AdminShell>
  );
}
