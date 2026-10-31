"use client";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import Pager from "@/components/Pager";
import { useApi, fmtDateTime } from "@/lib/client";

interface R { id: string; actorId: string | null; action: string; entity: string; entityId: string; before: unknown; after: unknown; createdAt: string }
export default function Audit() {
  const [f, setF] = useState({ action: "", entityId: "", page: 1 });
  const q = new URLSearchParams({ page: String(f.page), pageSize: "50", ...(f.action && { action: f.action }), ...(f.entityId && { entityId: f.entityId }) });
  const { data, error, loading } = useApi<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/admin/audit-logs?${q}`);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <AdminShell title="Audit log" sub="Who did what, and what changed. Secrets and passwords are never recorded.">
      <div className="filters"><input aria-label="Filter by action" placeholder="Action, e.g. approved" value={f.action} onChange={e => setF({ ...f, action: e.target.value, page: 1 })} /><input aria-label="Filter by record ID" placeholder="Record ID" value={f.entityId} onChange={e => setF({ ...f, entityId: e.target.value, page: 1 })} /></div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tbl"><table><thead><tr><th>When (Dubai)</th><th>Action</th><th>Actor</th><th>Record</th><th>Change</th></tr></thead><tbody>
        {loading && !data && <tr><td colSpan={5}>Loading…</td></tr>}{data?.rows.length === 0 && <tr><td colSpan={5}>No entries.</td></tr>}
        {data?.rows.map(r => <tr key={r.id}><td>{fmtDateTime(r.createdAt)}</td><td>{r.action}</td><td>{r.actorId ?? "system"}</td><td>{r.entity} {r.entityId.slice(0, 8)}</td>
          <td style={{ whiteSpace: "normal", maxWidth: 420 }}>{r.before || r.after ? <><button style={{ all: "unset", cursor: "pointer", color: "var(--orange)" }} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Show"}</button>{open === r.id && <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{JSON.stringify({ before: r.before, after: r.after }, null, 2)}</pre>}</> : "—"}</td></tr>)}
      </tbody></table></div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={p => setF({ ...f, page: p })} />}
    </AdminShell>
  );
}
