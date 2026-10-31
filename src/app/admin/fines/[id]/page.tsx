"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AdminShell from "@/components/AdminShell";
import { api, useApi } from "@/lib/client";

interface Detail {
  fine: { id: string; fineReference: string | null; issuingAuthority: string | null; plateRaw: string | null; plateEmirate: string | null; plateCode: string | null; violationAt: string | null; amount: number | string | null; additionalPenalty: number | string | null; deadline: string | null; deadlineSource: string | null; description: string | null; vehicleMakeModel: string | null; workflow: string; matchStatus: string; manualOverride: boolean; vehicleOdooId: number | null; rejectedReason: string | null; amountPaid?: number | string; paymentClaimedAmount?: number | string | null; paymentReference?: string | null; escalationLevel?: number; closedReason?: string | null; disputeReason?: string | null };
  job: { status: string; provider: string | null; confidence: number | null; errors: string[]; rawText: string | null } | null;
  fromErp: { vehicle: { plate: string; model?: string } | null; driver: { name: string } | null; vendor: { name: string } | null };
  reasons: { code: string; message: string }[]; evidenceUrl: string | null;
}
type Cand = { id: number; plate: string; model?: string };
const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16) : "");        // UTC -> Dubai wall clock
const fromLocal = (s: string) => (s ? new Date(Date.parse(s + ":00Z") - 4 * 3600_000).toISOString() : null);                    // Dubai wall clock -> UTC

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<Detail>(`/api/admin/fines/${id}`);
  const hist = useApi<{ audit: { id: string; action: string; createdAt: string }[]; notifications: { id: string; recipient: string; status: string; createdAt: string }[] }>(`/api/admin/fines/${id}/history`);
  const busyJob = data?.job && ["QUEUED", "PROCESSING"].includes(data.job.status);
  useEffect(() => { if (!busyJob) return; const t = setInterval(reload, 3000); return () => clearInterval(t); }, [busyJob, reload]);
  const [form, setForm] = useState<Record<string, string>>({}); const [cands, setCands] = useState<Cand[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [busy, setBusy] = useState(false); const [dup, setDup] = useState(false);
  const f = data?.fine;
  useEffect(() => { if (f) setForm({ fineReference: f.fineReference ?? "", issuingAuthority: f.issuingAuthority ?? "", plateRaw: f.plateRaw ?? "", plateEmirate: f.plateEmirate ?? "", plateCode: f.plateCode ?? "", violationAt: toLocal(f.violationAt), amount: f.amount != null ? String(f.amount) : "", additionalPenalty: f.additionalPenalty != null ? String(f.additionalPenalty) : "", deadline: toLocal(f.deadline), description: f.description ?? "", vehicleMakeModel: f.vehicleMakeModel ?? "" }); }, [f]);
  const editable = f?.workflow === "REVIEW_REQUIRED";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));
  async function act(path: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    try { const r = await api<{ candidates?: Cand[] }>(`/api/admin/fines/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }); setCands(r.candidates ?? []); setMsg({ ok: true, t: ok }); reload(); return true; }
    catch (e) { const er = e as { code?: string; message: string }; if (er.code === "DUPLICATE") setDup(true); setMsg({ ok: false, t: er.message }); return false; } finally { setBusy(false); }
  }
  const key = useRef(`k${Math.random().toString(36).slice(2)}${Date.now()}`);
  const wf = f?.workflow ?? ""; const post = (p: string, b: unknown, ok: string) => act(p, b, ok).then(r => { hist.reload(); return r; });
  async function vendor(preview: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/fines/${id}/send-notification`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ preview }) }); const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Failed");
      if (preview) { if (confirm(`Send this email to ${j.preview.to}?\n\n${j.preview.subject}\n\n${j.preview.body}`)) await vendor(false); }
      else { setMsg({ ok: true, t: j.duplicate ? "Already sent with this request." : `Handed to the email provider for ${j.sent.to}. Delivery is not confirmed.` }); key.current = `k${Math.random().toString(36).slice(2)}${Date.now()}`; hist.reload(); }
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setBusy(false); }
  }
  async function recordPay() {
    const amt = prompt("Amount paid (AED)?"); if (!amt) return; const ref = prompt("Payment reference (optional)") ?? "";
    const fd = new FormData(); fd.set("amount", amt); fd.set("reference", ref);
    setBusy(true); const r = await fetch(`/api/admin/fines/${id}/record-payment`, { method: "POST", body: fd }); setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Payment recorded. Verify it to count it as paid." } : { ok: false, t: (await r.json().catch(() => null))?.error?.message ?? "Failed" }); reload(); hist.reload();
  }
  const save = () => act("correct", { ...form, violationAt: fromLocal(form.violationAt), deadline: fromLocal(form.deadline) }, "Saved. Matching was re-run against the ERP.");
  const field = (k: string, label: string, type = "text") => <label className="field" key={k}>{label}<input type={type} value={form[k] ?? ""} onChange={set(k)} disabled={!editable} /></label>;

  return (
    <AdminShell title={f?.fineReference ?? "Fine review"} sub={f ? `Status: ${f.workflow.replace(/_/g, " ").toLowerCase()}` : undefined}>
      <p><Link href="/admin/fines">← Back to fines</Link></p>
      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className={msg.ok ? "warn" : "err"} role="status">{msg.t}</div>}
      {busyJob && <div className="warn">OCR is still running. This page refreshes automatically.</div>}
      {data && f && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
          <div className="card">
            <b>Original notice</b>
            {data.evidenceUrl && <iframe title="Fine notice" src={data.evidenceUrl} sandbox="" style={{ width: "100%", height: 520, border: "1px solid var(--line)", borderRadius: 12, marginTop: 8 }} />}
            <details style={{ marginTop: 10 }}><summary>Extracted text{data.job?.provider ? ` (${data.job.provider})` : ""}</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{data.job?.rawText ?? "No text was extracted."}</pre></details>
            <p className="foot" style={{ textAlign: "left" }}>OCR confidence: {data.job?.confidence != null ? `${Math.round(Number(data.job.confidence) * 100)}%` : "not reported by the provider"}{data.job?.errors?.length ? ` · ${data.job.errors.join("; ")}` : ""}</p>
          </div>
          <div>
            {data.reasons.length > 0 && <div className="warn"><b>Needs your attention</b><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{data.reasons.map(r => <li key={r.code}>{r.message}</li>)}</ul></div>}
            <div className="card">
              <b>Extracted and editable (from the notice)</b>
              <div style={{ marginTop: 10 }}>
                {field("fineReference", "Fine reference")}{field("issuingAuthority", "Issuing authority")}{field("plateRaw", "Registration as printed")}{field("plateEmirate", "Emirate (optional)")}{field("plateCode", "Plate code (optional)")}
                {field("violationAt", "Violation date & time (Dubai)", "datetime-local")}{field("amount", "Fine amount (AED)")}{field("additionalPenalty", "Additional penalty (AED)")}{field("deadline", "Payment deadline (leave empty if not on the notice)", "datetime-local")}{field("description", "Violation description")}{field("vehicleMakeModel", "Make / model (only if printed on the notice)")}
              </div>
              {editable && <button className="btn" disabled={busy} onClick={save}>{busy ? "Working…" : "Save and re-match"}</button>}
            </div>
            <div className="card" style={{ marginTop: 12 }}>
              <b>Matched from the ERP (not read from the notice)</b>
              <div className="row" style={{ marginTop: 8 }}><span><small>Vehicle</small>{data.fromErp.vehicle ? `${data.fromErp.vehicle.plate}${data.fromErp.vehicle.model ? ` · ${data.fromErp.vehicle.model}` : ""}` : "No match"}</span><span><small>Match</small>{f.matchStatus.replace(/_/g, " ").toLowerCase()}{f.manualOverride ? " (manual)" : ""}</span></div>
              <div className="row" style={{ marginTop: 8 }}><span><small>Driver at violation time</small>{data.fromErp.driver?.name ?? "Not resolved"}</span><span><small>Vendor</small>{data.fromErp.vendor?.name ?? "Not resolved"}</span></div>
              {cands.length > 0 && editable && <div style={{ marginTop: 10 }}><small>Possible vehicles. Choose the right one:</small>{cands.map(c => <button key={c.id} className="pill" style={{ margin: 4, border: "1px solid var(--line)" }} onClick={() => confirm(`Assign this fine to ${c.plate}? This is recorded as a manual decision.`) && act("correct", { vehicleOdooId: c.id }, "Vehicle assigned manually.")}>{c.plate}{c.model ? ` · ${c.model}` : ""}</button>)}</div>}
            </div>
            {editable && <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" disabled={busy} onClick={() => confirm("Approve this fine? The driver will be notified and it will be queued to be recorded in the ERP.") && act("approve", { confirmNotDuplicate: dup }, "Approved.")}>Approve</button>
              <button className="btn red" disabled={busy} onClick={() => { const r = prompt("Why is this being rejected?"); if (r) act("reject", { reason: r }, "Rejected."); }}>Reject</button>
            </div>}
            {dup && <p className="warn" style={{ marginTop: 10 }}>This may be a duplicate. Tap Approve again only if you have checked it is not.</p>}
            {["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "DISPUTED", "CLOSED"].includes(wf) && <div className="card" style={{ marginTop: 12 }}>
              <b>Workflow: {wf.replace(/_/g, " ").toLowerCase()}{(f.escalationLevel ?? 0) > 0 ? ` · escalated (level ${f.escalationLevel})` : ""}</b>
              <div className="row" style={{ marginTop: 8 }}><span><small>Paid (verified)</small>AED {Number(f.amountPaid ?? 0).toFixed(2)}</span><span><small>Total shown</small>AED {(Number(f.amount ?? 0) + Number(f.additionalPenalty ?? 0)).toFixed(2)}</span></div>
              {f.disputeReason && <p className="warn" style={{ marginTop: 8 }}>Driver dispute: {f.disputeReason}</p>}
              {wf === "PAID_AWAITING_VERIFICATION" && <p className="warn" style={{ marginTop: 8 }}>Payment of AED {Number(f.paymentClaimedAmount ?? 0).toFixed(2)} reported{f.paymentReference ? ` (ref ${f.paymentReference})` : ""}. Check the receipt before verifying.</p>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                {wf !== "CLOSED" && <button className="btn sm" disabled={busy} onClick={() => vendor(true)}>Email vendor…</button>}
                {["ACK_PENDING", "PAYMENT_PENDING"].includes(wf) && <button className="btn sm" style={{ background: "var(--navy)" }} disabled={busy} onClick={recordPay}>Record payment</button>}
                {wf === "PAID_AWAITING_VERIFICATION" && <><button className="btn sm green" disabled={busy} onClick={() => confirm("Verify this payment against the receipt?") && post("verify-payment", { approved: true }, "Payment verified.")}>Verify payment</button>
                  <button className="btn sm red" disabled={busy} onClick={() => { const r = prompt("Why can't the payment be accepted?"); if (r) post("verify-payment", { approved: false, reason: r }, "Payment not accepted."); }}>Not accepted</button></>}
                {wf !== "CLOSED" && <button className="btn sm" style={{ background: "#6b7280" }} disabled={busy} onClick={() => { const r = prompt("Reason for closing without full verified payment?"); if (r) post("close", { reason: r }, "Closed."); }}>Close</button>}
                {["CLOSED", "DISPUTED"].includes(wf) && <button className="btn sm" style={{ background: "#6b7280" }} disabled={busy} onClick={() => { const r = prompt("Reason for reopening?"); if (r) post("reopen", { reason: r }, "Reopened."); }}>Reopen</button>}
              </div>
              {f.closedReason && <p className="foot" style={{ textAlign: "left" }}>Closed: {f.closedReason}</p>}
            </div>}
            {hist.data && (hist.data.audit.length > 0 || hist.data.notifications.length > 0) && <details style={{ marginTop: 12 }}><summary>History</summary>
              <div style={{ fontSize: 13, display: "grid", gap: 4, marginTop: 6 }}>{hist.data.audit.map(a => <div key={a.id}>{a.createdAt.slice(0, 16).replace("T", " ")} · {a.action.replace("fine.", "").replace(/_/g, " ")}</div>)}
                {hist.data.notifications.map(n => <div key={n.id}>{n.createdAt.slice(0, 16).replace("T", " ")} · email to {n.recipient}: {n.status.toLowerCase()}</div>)}</div></details>}
            {f.rejectedReason && <p className="err" style={{ marginTop: 10 }}>Rejected: {f.rejectedReason}</p>}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
