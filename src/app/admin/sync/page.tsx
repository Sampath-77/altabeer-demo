"use client";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, useApi, fmtDateTime } from "@/lib/client";

interface S { checkedAt: string; odoo: { ok: boolean; latencyMs?: number; error?: string }; outbox: { pending: number; retrying: number; dead: number; sent: number; oldestUnsentAt: string | null };
  resources: { resource: string; lastSyncAt: string | null; lastError: string | null }[]; problems: { id: string; operation: string; status: string; attempts: number; nextAttemptAt: string; lastError: string | null; updatedAt: string }[] }
const NAMES: Record<string, string> = { outbox: "Writes to the ERP", "fines-reconcile": "Fine comparison with the ERP", expenses: "Expense status updates", payslips: "Payslip announcements" };
export default function Sync() {
  const { data, error, reload } = useApi<S>("/api/admin/sync-status", 15_000); const [msg, setMsg] = useState<string | null>(null);
  async function retry(id: string) { try { await api(`/api/admin/sync/${id}/retry`, { method: "POST" }); setMsg("Queued for another attempt."); reload(); } catch (e) { setMsg((e as Error).message); } }
  return (
    <AdminShell title="Sync status" sub="Health of the connection between this app and the Al Tabeer ERP. Employees, vehicles, attendance, expenses and payslips are read live from the ERP; fines are written to it.">
      {(error || msg) && <div className={error ? "err" : "warn"} role="status">{error ?? msg}</div>}
      {data && <>
        <div className="cards">
          <div className={`stat ${data.odoo.ok ? "" : "off"}`}><small>ERP connection</small><b>{data.odoo.ok ? "Reachable" : "Unreachable"}</b><em>{data.odoo.ok ? `${data.odoo.latencyMs} ms` : data.odoo.error}</em></div>
          <div className="stat"><small>Waiting to send</small><b>{data.outbox.pending}</b><em>{data.outbox.oldestUnsentAt ? `Oldest from ${fmtDateTime(data.outbox.oldestUnsentAt)}` : "Nothing waiting"}</em></div>
          <div className="stat"><small>Retrying</small><b>{data.outbox.retrying}</b><em>Temporary failures, retried with backoff</em></div>
          <div className="stat navy"><small>Needs attention</small><b>{data.outbox.dead}</b><em>Gave up after retries or was rejected by the ERP</em></div>
        </div>
        <h2>Background jobs</h2>
        <div className="tbl"><table><thead><tr><th>Job</th><th>Last success</th><th>Last problem</th></tr></thead><tbody>
          {data.resources.length === 0 && <tr><td colSpan={3}>No job has reported yet. Is the worker running?</td></tr>}
          {data.resources.map(r => <tr key={r.resource}><td>{NAMES[r.resource] ?? r.resource}</td><td>{r.lastSyncAt ? fmtDateTime(r.lastSyncAt) : "never"}</td><td>{r.lastError ? <span className="tag r">{r.lastError}</span> : "—"}</td></tr>)}
        </tbody></table></div>
        <h2>Failed or retrying operations</h2>
        <div className="tbl"><table><thead><tr><th>Operation</th><th>Status</th><th>Attempts</th><th>Next attempt</th><th>Error</th><th /></tr></thead><tbody>
          {data.problems.length === 0 && <tr><td colSpan={6}>No problems.</td></tr>}
          {data.problems.map(p => <tr key={p.id}><td>{p.operation}</td><td><span className={`tag ${p.status === "DEAD" ? "r" : "o"}`}>{p.status === "DEAD" ? "needs attention" : "retrying"}</span></td><td>{p.attempts}</td><td>{p.status === "DEAD" ? "—" : fmtDateTime(p.nextAttemptAt)}</td><td style={{ whiteSpace: "normal", maxWidth: 320 }}>{p.lastError ?? "—"}</td>
            <td><button className="btn sm" onClick={() => confirm("Retry this operation now? It is safe to repeat: the ERP write cannot create a duplicate.") && retry(p.id)}>Retry</button></td></tr>)}
        </tbody></table></div>
        <p className="foot">Checked {fmtDateTime(data.checkedAt)}. Conflicts (a fine edited in the ERP) appear in the notification list and the audit log.</p>
      </>}
    </AdminShell>
  );
}
