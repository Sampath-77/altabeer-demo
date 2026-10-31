"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import Pager from "@/components/Pager";
import { useApi, fmtDateTime } from "@/lib/client";

interface R { id: string; fineReference: string | null; violationAt: string | null; noticeReceivedAt: string; plateRaw: string | null; amount: number | string | null; deadline: string | null; workflow: string; matchStatus: string; reviewReasons: string[] }
const STATES: [string, string][] = [["", "Any status"], ["REVIEW_REQUIRED", "Needs review"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["ACK_PENDING", "Acknowledgement pending"], ["PAYMENT_PENDING", "Payment pending"], ["CLOSED", "Closed"]];
export default function Fines() {
  const [f, setF] = useState({ status: "", q: "", plate: "", page: 1 });
  const q = new URLSearchParams({ page: String(f.page), pageSize: "25", ...(f.status && { status: f.status }), ...(f.q && { q: f.q }), ...(f.plate && { plate: f.plate }) });
  const { data, error, loading, reload } = useApi<{ rows: R[]; total: number; page: number; pageSize: number }>(`/api/admin/fines?${q}`, 30_000);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false); const pick = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v, page: 1 }));
  async function up(files: FileList | null) {
    if (!files?.length) return; setBusy(true); setMsg(null);
    let okN = 0; const errs: string[] = [];
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.set("file", file);
      const r = await fetch("/api/admin/fines/upload", { method: "POST", body: fd }).catch(() => null);
      if (r?.ok) okN++; else errs.push(`${file.name}: ${(await r?.json().catch(() => null))?.error?.message ?? "upload failed"}`);
    }
    setBusy(false); setMsg({ ok: errs.length === 0, t: `${okN} uploaded and queued for OCR.${errs.length ? " " + errs.join(" ") : ""}` }); reload();
  }
  return (
    <AdminShell title="Fine Detection" sub="Upload fine notices, review the extracted data and approve or reject. Nothing is approved automatically.">
      <input ref={pick} type="file" hidden multiple accept="image/*,application/pdf" onChange={e => { up(e.target.files); e.target.value = ""; }} />
      <div className="filters">
        <button className="btn sm" disabled={busy} onClick={() => pick.current?.click()}><Upload size={16} style={{ verticalAlign: -3 }} /> {busy ? "Uploading…" : "Upload notices"}</button>
        <input aria-label="Search reference" placeholder="Fine reference" value={f.q} onChange={e => set("q", e.target.value)} />
        <input aria-label="Search plate" placeholder="Plate" value={f.plate} onChange={e => set("plate", e.target.value)} />
        <select aria-label="Status" value={f.status} onChange={e => set("status", e.target.value)}>{STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      {msg && <div className={msg.ok ? "warn" : "err"} role="status">{msg.t}</div>}
      {error && <div className="err" role="alert">{error}</div>}
      <div className="tbl"><table><thead><tr><th>Reference</th><th>Plate</th><th>Violation (Dubai)</th><th>Received</th><th>Amount (AED)</th><th>Deadline</th><th>Status</th><th>Review flags</th></tr></thead><tbody>
        {loading && !data && <tr><td colSpan={8}>Loading…</td></tr>}{data?.rows.length === 0 && <tr><td colSpan={8}>No fines yet. Upload a notice to start.</td></tr>}
        {data?.rows.map(r => (
          <tr key={r.id}>
            <td><Link href={`/admin/fines/${r.id}`} style={{ fontWeight: 600 }}>{r.fineReference ?? "Unread, open to review"}</Link></td><td>{r.plateRaw ?? "—"}</td>
            <td>{r.violationAt ? fmtDateTime(r.violationAt) : "—"}</td><td>{fmtDateTime(r.noticeReceivedAt)}</td><td>{r.amount != null ? Number(r.amount).toFixed(2) : "—"}</td><td>{r.deadline ? fmtDateTime(r.deadline) : "Not verified"}</td>
            <td><span className={`tag ${r.workflow === "APPROVED" ? "g" : r.workflow === "REJECTED" ? "r" : "o"}`}>{r.workflow.replace(/_/g, " ").toLowerCase()}</span></td><td>{r.reviewReasons.length || "—"}</td>
          </tr>))}
      </tbody></table></div>
      {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={p => setF(s => ({ ...s, page: p }))} />}
    </AdminShell>
  );
}
