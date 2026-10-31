"use client";
import { useRef, useState } from "react";
import { ShieldCheck, Plus } from "lucide-react";
import Shell from "@/components/Shell";
import { api, useApi, fmtDate, fmtDateTime } from "@/lib/client";

interface F { id: string; reference: string | null; plate: string | null; vehicle: string | null; violationAt: string | null; amount: number | null; additionalPenalty: number | null; paid: number; outstanding: number; description: string | null; deadline: string | null; workflow: string; awaitingReview: boolean; canAcknowledge: boolean; canDispute: boolean; canSubmitPayment: boolean; hasNotice: boolean; escalated: boolean }
const LABEL: Record<string, string> = { REVIEW_REQUIRED: "Awaiting review", ACK_PENDING: "Acknowledgement pending", ACKNOWLEDGED: "Acknowledged", PAYMENT_PENDING: "Payment pending", PAID_AWAITING_VERIFICATION: "Paid, awaiting verification", UNDER_REVIEW: "Under review", DISPUTED: "Disputed", CLOSED: "Closed", REJECTED: "Not accepted" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());

export default function Fines() {
  const { data, error, loading, reload } = useApi<{ fines: F[]; summary: { unresolved: number; outstanding: number } }>("/api/fines", 60_000);
  const [open, setOpen] = useState<string | null>(null); const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false);
  const [rep, setRep] = useState({ amount: "", date: today(), note: "" }); const [pay, setPay] = useState({ amount: "", reference: "" }); const file = useRef<HTMLInputElement>(null);
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); setMsg(null); try { await fn(); setMsg({ ok: true, t: ok }); reload(); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setBusy(false); } }
  const post = (p: string, b?: unknown) => api(p, { method: "POST", body: JSON.stringify(b ?? {}) });
  async function sendPay(id: string) {
    const f = file.current?.files?.[0]; if (!f) throw new Error("Attach the payment receipt.");
    const fd = new FormData(); fd.set("file", f); fd.set("amount", pay.amount); fd.set("reference", pay.reference);
    const r = await fetch(`/api/fines/${id}/payment-evidence`, { method: "POST", body: fd }); if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? "Upload failed.");
  }
  return (
    <Shell title="Fines & Deductions" subtitle="Traffic fines recorded against your vehicle">
      {(error || msg) && <div className={msg?.ok ? "warn" : "err"} role="alert">{msg?.t ?? error}</div>}
      <div className="qa" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
        <div className="card" style={{ textAlign: "center", background: data && data.summary.outstanding > 0 ? "#fff7ed" : "#f0fdf4" }}><small>Outstanding</small><b style={{ display: "block", fontSize: 20 }}>AED {(data?.summary.outstanding ?? 0).toFixed(2)}</b><small>verified fines only</small></div>
        <div className="card" style={{ textAlign: "center" }}><small>Open fines</small><b style={{ display: "block", fontSize: 20 }}>{data?.summary.unresolved ?? 0}</b><small>need action or payment</small></div>
      </div>
      {loading && !data ? <div className="card empty">Loading…</div> : !data?.fines.length ? (
        <div className="card empty"><ShieldCheck color="#16a34a" /><b>No fines on record</b>Fines appear here once Al Tabeer has verified them.</div>
      ) : <div className="hist">{data.fines.map(f => (
        <div className="card" key={f.id}>
          <button style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }} aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)}>
            <div className="row"><div><b>{f.reference ?? "Reported fine"}</b><small>{f.vehicle ?? f.plate ?? "Vehicle not matched yet"}{f.violationAt ? ` · ${fmtDate(f.violationAt)}` : ""}</small></div><div style={{ textAlign: "right" }}><b>AED {(f.amount ?? 0).toFixed(2)}</b><small>{LABEL[f.workflow] ?? f.workflow}</small></div></div>
            {f.escalated && <div className="err" style={{ marginTop: 8, marginBottom: 0 }}>This fine is overdue. Please contact operations.</div>}
          </button>
          {open === f.id && <div style={{ marginTop: 12, fontSize: 14, display: "grid", gap: 8 }}>
            {f.description && <div><small>Violation</small>{f.description}</div>}
            <div className="row"><span><small>Outstanding</small>AED {f.outstanding.toFixed(2)}</span><span><small>Deadline</small>{f.deadline ? fmtDateTime(f.deadline) : "Not stated on the notice"}</span></div>
            {f.awaitingReview && <p className="warn" style={{ margin: 0 }}>You reported this fine. It is not counted until Al Tabeer verifies it against a notice.</p>}
            {f.hasNotice && <a href={`/api/fines/${f.id}/evidence`} target="_blank" rel="noreferrer" style={{ color: "var(--orange)", fontWeight: 600 }}>View the fine notice</a>}
            {f.canAcknowledge && <><p style={{ margin: 0, color: "var(--mute)" }}>Acknowledging confirms you have seen this fine. It does not decide who is responsible.</p>
              <button className="btn" disabled={busy} onClick={() => run(() => post(`/api/fines/${f.id}/acknowledge`), "Acknowledged.")}>Acknowledge</button></>}
            {f.canSubmitPayment && <div className="card" style={{ background: "#f8fafc" }}><b>Report a payment</b>
              <label className="field" style={{ marginTop: 8 }}>Amount paid (AED)<input inputMode="decimal" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} /></label>
              <label className="field">Payment reference (optional)<input value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} /></label>
              <input ref={file} type="file" accept="image/*,application/pdf" style={{ marginBottom: 10 }} />
              <button className="btn" disabled={busy} onClick={() => run(() => sendPay(f.id), "Submitted. Al Tabeer will verify your payment.")}>Submit payment receipt</button></div>}
            {f.canDispute && <button className="btn sm red" disabled={busy} style={{ justifySelf: "start" }} onClick={() => { const r = prompt("Why do you dispute this fine?"); if (r) run(() => post(`/api/fines/${f.id}/dispute`, { reason: r }), "Dispute sent to operations."); }}>Dispute this fine</button>}
          </div>}
        </div>))}</div>}
      <h2><Plus size={16} style={{ verticalAlign: -2 }} /> Report a fine</h2>
      <div className="card">
        <p style={{ marginTop: 0, color: "var(--mute)", fontSize: 14 }}>Got a fine we haven&apos;t recorded? Tell us. It is reviewed against the official notice before it counts.</p>
        <div className="row"><label className="field" style={{ flex: 1 }}>Amount (AED)<input inputMode="decimal" placeholder="0.00" value={rep.amount} onChange={e => setRep({ ...rep, amount: e.target.value })} /></label>
          <label className="field" style={{ flex: 1 }}>Date<input type="date" max={today()} value={rep.date} onChange={e => setRep({ ...rep, date: e.target.value })} /></label></div>
        <label className="field">Reference / note (optional)<input placeholder="e.g. Salik gate, fine ticket no." value={rep.note} onChange={e => setRep({ ...rep, note: e.target.value })} /></label>
        <button className="btn" disabled={busy} onClick={() => run(async () => { await post("/api/fines/report", { amount: Number(rep.amount), date: rep.date, note: rep.note }); setRep({ amount: "", date: today(), note: "" }); }, "Sent for review.")}>Send for review</button>
      </div>
    </Shell>
  );
}
