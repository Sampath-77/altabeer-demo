"use client";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pager from "@/components/Pager";
import { useApi } from "@/lib/client";

interface V { id: number; name: string; email?: string; phone?: string; activeVehicles: number }
export default function Vendors() {
  const [search, setSearch] = useState(""); const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ rows: V[]; total: number; page: number; pageSize: number }>(`/api/admin/vendors?page=${page}&pageSize=25${search ? `&search=${encodeURIComponent(search)}` : ""}`);
  return (
    <AdminShell title="Vendors" sub="Contacts and vehicle counts from the ERP. Vendors have no logins; fine totals and notification history arrive with the fines stage.">
      <div className="filters"><input aria-label="Search vendors" placeholder="Search vendor name" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tbl"><table><thead><tr><th>Vendor</th><th>Email</th><th>Phone</th><th>Active vehicles</th></tr></thead><tbody>
        {loading && !data && <tr><td colSpan={4}>Loading…</td></tr>}{data?.rows.length === 0 && <tr><td colSpan={4}>No vendors match.</td></tr>}
        {data?.rows.map(v => <tr key={v.id}><td><b>{v.name}</b></td><td>{v.email ?? "—"}</td><td>{v.phone ?? "—"}</td><td>{v.activeVehicles}</td></tr>)}
      </tbody></table></div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </AdminShell>
  );
}
