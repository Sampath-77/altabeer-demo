"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, AlertCircle, CheckCircle, Clock, ShieldAlert } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { api, useApi } from "@/lib/client";

interface ExtractedField<T = string> {
  value: T;
  snippet?: string;
  page?: number;
}

interface AdditionalField {
  label: string;
  value: string;
  snippet?: string;
  page?: number;
}

interface Detail {
  fine: {
    id: string;
    fineReference: string | null;
    issuingAuthority: string | null;
    plateRaw: string | null;
    plateEmirate: string | null;
    plateCode: string | null;
    violationAt: string | null;
    amount: number | string | null;
    additionalPenalty: number | string | null;
    deadline: string | null;
    deadlineSource: string | null;
    description: string | null;
    vehicleMakeModel: string | null;
    workflow: string;
    matchStatus: string;
    manualOverride: boolean;
    vehicleOdooId: number | null;
    rejectedReason: string | null;
    amountPaid?: number | string;
    paymentClaimedAmount?: number | string | null;
    paymentReference?: string | null;
    escalationLevel?: number;
    closedReason?: string | null;
    disputeReason?: string | null;
  };
  job: {
    status: string;
    provider: string | null;
    confidence: number | null;
    errors: string[];
    rawText: string | null;
    fields?: Record<string, any>;
  } | null;
  fromErp: {
    vehicle: { plate: string; model?: string; active?: boolean; status?: string; vendorName?: string } | null;
    driver: { name: string } | null;
    driverAtViolation?: { name: string } | null;
    currentDriver?: { id?: number; name: string } | null;
    vendor: { name: string } | null;
  };
  reasons: { code: string; message: string }[];
  evidenceUrl: string | null;
}

type Cand = { id: number; plate: string; model?: string };

const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16) : "");
const fromLocal = (s: string) => (s ? new Date(Date.parse(s + ":00Z") - 4 * 3600_000).toISOString() : null);

function valOrFallback(fieldObj: any, fallbackText = "Not available in document"): string {
  if (fieldObj === undefined || fieldObj === null) return fallbackText;
  if (typeof fieldObj === "object" && "value" in fieldObj) {
    if (fieldObj.value === null || fieldObj.value === undefined || fieldObj.value === "") return fallbackText;
    return String(fieldObj.value);
  }
  if (fieldObj === "") return fallbackText;
  return String(fieldObj);
}

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useApi<Detail>(`/api/admin/fines/${id}`);
  const hist = useApi<{ audit: { id: string; action: string; createdAt: string }[]; notifications: { id: string; recipient: string; status: string; createdAt: string }[] }>(`/api/admin/fines/${id}/history`);
  const busyJob = data?.job && ["QUEUED", "PROCESSING"].includes(data.job.status);
  useEffect(() => { if (!busyJob) return; const t = setInterval(reload, 3000); return () => clearInterval(t); }, [busyJob, reload]);

  const [form, setForm] = useState<Record<string, string>>({});
  const [cands, setCands] = useState<Cand[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState(false);
  const [activeTab, setActiveTab] = useState<"review" | "all-fields" | "raw">("review");

  const f = data?.fine;
  const ocrFields = data?.job?.fields || {};

  useEffect(() => {
    if (f) {
      setForm({
        fineReference: f.fineReference ?? "",
        issuingAuthority: f.issuingAuthority ?? "",
        plateRaw: f.plateRaw ?? "",
        plateEmirate: f.plateEmirate ?? "",
        plateCode: f.plateCode ?? "",
        violationAt: toLocal(f.violationAt),
        amount: f.amount != null ? String(f.amount) : "",
        additionalPenalty: f.additionalPenalty != null ? String(f.additionalPenalty) : "",
        deadline: toLocal(f.deadline),
        description: f.description ?? "",
        vehicleMakeModel: f.vehicleMakeModel ?? "",
      });
    }
  }, [f]);

  const editable = f?.workflow === "REVIEW_REQUIRED";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }));

  async function act(path: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await api<{ candidates?: Cand[] }>(`/api/admin/fines/${id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      setCands(r.candidates ?? []);
      setMsg({ ok: true, t: ok });
      reload();
      return true;
    } catch (e) {
      const er = e as { code?: string; message: string };
      if (er.code === "DUPLICATE") setDup(true);
      setMsg({ ok: false, t: er.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const key = useRef(`k${Math.random().toString(36).slice(2)}${Date.now()}`);
  const wf = f?.workflow ?? "";
  const post = (p: string, b: unknown, ok: string) => act(p, b, ok).then(r => { hist.reload(); return r; });

  async function vendor(preview: boolean) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/fines/${id}/send-notification`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ preview }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Failed");
      if (preview) {
        if (confirm(`Send this email to ${j.preview.to}?\n\n${j.preview.subject}\n\n${j.preview.body}`)) await vendor(false);
      } else {
        setMsg({ ok: true, t: j.duplicate ? "Already sent with this request." : `Handed to the email provider for ${j.sent.to}. Delivery is not confirmed.` });
        key.current = `k${Math.random().toString(36).slice(2)}${Date.now()}`;
        hist.reload();
      }
    } catch (e) { setMsg({ ok: false, t: (e as Error).message }); } finally { setBusy(false); }
  }

  async function recordPay() {
    const amt = prompt("Amount paid (AED)?"); if (!amt) return;
    const ref = prompt("Payment reference (optional)") ?? "";
    const fd = new FormData(); fd.set("amount", amt); fd.set("reference", ref);
    setBusy(true);
    const r = await fetch(`/api/admin/fines/${id}/record-payment`, { method: "POST", body: fd });
    setBusy(false);
    setMsg(r.ok ? { ok: true, t: "Payment recorded. Verify it to count it as paid." } : { ok: false, t: (await r.json().catch(() => null))?.error?.message ?? "Failed" });
    reload(); hist.reload();
  }

  const save = () => act("correct", { ...form, violationAt: fromLocal(form.violationAt), deadline: fromLocal(form.deadline) }, "Saved. Matching was re-run against the ERP.");
  const field = (k: string, label: string, type = "text") => (
    <label className="field" key={k}>
      {label}
      <input type={type} value={form[k] ?? ""} onChange={set(k)} disabled={!editable} />
    </label>
  );

  const confidenceScore = data?.job?.confidence != null ? Number(data.job.confidence) : null;
  const isLowConfidence = confidenceScore != null && confidenceScore < 0.85;

  return (
    <AdminShell title={f?.fineReference ?? "Fine review"} sub={f ? `Status: ${f.workflow.replace(/_/g, " ").toLowerCase()}` : undefined}>
      <p style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link href="/admin/fines">← Back to fines</Link>
        <span style={{ display: "flex", gap: 8 }}>
          <button className={`tag ${activeTab === "review" ? "g" : ""}`} onClick={() => setActiveTab("review")}>Structured Review</button>
          <button className={`tag ${activeTab === "all-fields" ? "g" : ""}`} onClick={() => setActiveTab("all-fields")}>All Extracted Fields (OCR)</button>
          <button className={`tag ${activeTab === "raw" ? "g" : ""}`} onClick={() => setActiveTab("raw")}>Raw OCR Text</button>
        </span>
      </p>

      {error && <div className="err" role="alert">{error}</div>}
      {msg && <div className={msg.ok ? "warn" : "err"} role="status">{msg.t}</div>}
      {busyJob && <div className="warn">OCR is still running. This page refreshes automatically.</div>}

      {data && f && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 16, alignItems: "start" }}>
          {/* SECTION 7: ORIGINAL CHALLAN DOCUMENT */}
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <b>Section 7 — Original Challan Document</b>
              {data.evidenceUrl && (
                <div style={{ display: "flex", gap: 6 }}>
                  <a className="tag" href={data.evidenceUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    <ExternalLink size={13} /> Open
                  </a>
                  <a className="tag g" href={data.evidenceUrl} target="_blank" rel="noreferrer" download style={{ display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
                    <Download size={13} /> Download
                  </a>
                </div>
              )}
            </div>
            {data.evidenceUrl ? (
              (data as unknown as { isPdf?: boolean }).isPdf ? (
                <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden", marginTop: 8 }}>
                  <iframe title="Fine notice" src={data.evidenceUrl} style={{ width: "100%", height: 560, border: "none" }} />
                </div>
              ) : (
                <div style={{ textAlign: "center", marginTop: 8, background: "#f8fafc", padding: 12, borderRadius: 12, border: "1px solid var(--line)", overflow: "auto", minHeight: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.evidenceUrl}
                    alt="Original Challan Notice"
                    style={{ maxWidth: "100%", height: "auto", maxHeight: 560, objectFit: "contain", borderRadius: 8, display: "inline-block", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }}
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = "none";
                      const p = img.parentElement;
                      if (p && !p.querySelector(".img-error-fallback")) {
                        const fallback = document.createElement("div");
                        fallback.className = "img-error-fallback";
                        fallback.style.padding = "24px 12px";
                        fallback.style.textAlign = "center";
                        fallback.innerHTML = `
                          <div style="font-weight: 600; color: #1e293b; margin-bottom: 6px;">Original Document Available</div>
                          <div style="font-size: 13px; color: #64748b; margin-bottom: 12px;">Click below to open the original file directly.</div>
                          <a href="${data.evidenceUrl}" target="_blank" rel="noreferrer" class="btn" style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; font-size: 13px; text-decoration: none;">View Original File</a>
                        `;
                        p.appendChild(fallback);
                      }
                    }}
                  />
                </div>
              )
            ) : (
              <div className="card empty" style={{ minHeight: 180, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <b>No Document Attached</b>
                <span style={{ fontSize: 13, color: "var(--mute)" }}>No notice file was uploaded for this fine.</span>
              </div>
            )}
            <div style={{ marginTop: 10, padding: 8, background: "#f8fafc", borderRadius: 8, fontSize: 13 }}>
              <div><b>OCR Provider:</b> {data.job?.provider ?? "OCR.Space / Tesseract"}</div>
              <div><b>Processing status:</b> <span className={`tag ${data.job?.status === "DONE" ? "g" : ""}`}>{data.job?.status ?? "Unknown"}</span></div>
              <div>
                <b>Confidence:</b>{" "}
                {confidenceScore != null ? (
                  <span style={{ color: isLowConfidence ? "#b91c1c" : "#15803d", fontWeight: "bold" }}>
                    {Math.round(confidenceScore * 100)}% {isLowConfidence ? "(Needs verification)" : "(High confidence)"}
                  </span>
                ) : (
                  <span>Needs verification (confidence not reported)</span>
                )}
              </div>
              {data.job?.errors?.length ? <div style={{ color: "#b91c1c" }}><b>Errors:</b> {data.job.errors.join("; ")}</div> : null}
            </div>
          </div>

          <div>
            {data.reasons.length > 0 && (
              <div className="warn" style={{ marginBottom: 14 }}>
                <b>Review Flags (Needs Attention)</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {data.reasons.map(r => <li key={r.code}>{r.message}</li>)}
                </ul>
              </div>
            )}

            {/* TAB 1: STRUCTURED REVIEW SECTIONS 1 - 6 & 8 */}
            {activeTab === "review" && (
              <>
                {/* SECTION 1: FINE OVERVIEW */}
                <div className="card" style={{ marginBottom: 14 }}>
                  <b>Section 1 — Fine Overview</b>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, fontSize: 13 }}>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Fine Reference</small><b>{f.fineReference ?? valOrFallback(ocrFields.fineNumber)}</b></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Issuing Authority</small><b>{f.issuingAuthority ?? valOrFallback(ocrFields.issuingAuthority)}</b></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Registration Plate</small><b>{f.plateRaw ?? "Not available"}</b></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Total Fine</small><b>AED {f.amount != null ? Number(f.amount).toFixed(2) : "0.00"}</b></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Violation Date</small><span>{f.violationAt ? toLocal(f.violationAt).replace("T", " ") : "Not available"}</span></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Payment Deadline</small><span>{f.deadline ? toLocal(f.deadline).replace("T", " ") : "None specified"}</span></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Workflow Status</small><span className="tag">{f.workflow.replace(/_/g, " ").toLowerCase()}</span></div>
                    <div><small style={{ color: "var(--muted)", display: "block" }}>Match Status</small><span className={`tag ${f.matchStatus === "MATCHED" ? "g" : ""}`}>{f.matchStatus.replace(/_/g, " ").toLowerCase()}</span></div>
                  </div>
                </div>

                {/* EDITABLE FIELDS CARD */}
                <div className="card" style={{ marginBottom: 14 }}>
                  <b>Extracted & Editable Fields (from Notice)</b>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 10px" }}>Admin verification required. Edits are recorded for audit purposes.</p>
                  <div style={{ marginTop: 10 }}>
                    {field("fineReference", "Fine reference")}
                    {field("issuingAuthority", "Issuing authority")}
                    {field("plateRaw", "Registration as printed")}
                    {field("plateEmirate", "Emirate")}
                    {field("plateCode", "Plate code")}
                    {field("violationAt", "Violation date & time (Dubai)", "datetime-local")}
                    {field("amount", "Fine amount (AED)")}
                    {field("additionalPenalty", "Additional penalty (AED)")}
                    {field("deadline", "Payment deadline (Dubai)", "datetime-local")}
                    {field("description", "Violation description")}
                    {field("vehicleMakeModel", "Make / model")}
                  </div>
                  {editable && (
                    <button className="btn" style={{ marginTop: 10 }} disabled={busy} onClick={save}>
                      {busy ? "Working…" : "Save and re-match against ERP"}
                    </button>
                  )}
                </div>

                {/* SECTION 2 & 6: VEHICLE & DRIVER MAPPING */}
                <div className="card" style={{ marginBottom: 14 }}>
                  <b>Section 2 & 6 — Vehicle, Vendor & Driver Mapping</b>
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>Clearly separating OCR-extracted data from live Odoo ERP records.</p>

                  <div style={{ marginTop: 8, padding: 8, background: "#f8fafc", borderRadius: 8 }}>
                    <small style={{ fontWeight: "bold", color: "#1e3a5f" }}>Odoo ERP Matched Information</small>
                    <div className="row" style={{ marginTop: 6, fontSize: 13 }}>
                      <span><small>Matched Vehicle:</small> {data.fromErp.vehicle ? `${data.fromErp.vehicle.plate} (${data.fromErp.vehicle.model ?? "Model not set"})` : "No vehicle match"}</span>
                      <span><small>Status:</small> {data.fromErp.vehicle?.active ? "Active in Fleet" : "Inactive / Unregistered"}</span>
                    </div>
                    <div className="row" style={{ marginTop: 6, fontSize: 13 }}>
                      <span><small>Assigned Vendor:</small> <b>{data.fromErp.vendor?.name ?? data.fromErp.vehicle?.vendorName ?? "Vendor not assigned in Odoo"}</b></span>
                    </div>
                    <div className="row" style={{ marginTop: 6, fontSize: 13 }}>
                      <span><small>Driver at Violation Time:</small> <b>{data.fromErp.driverAtViolation?.name ?? data.fromErp.driver?.name ?? "No assignment logged"}</b></span>
                      <span><small>Current Driver:</small> {data.fromErp.currentDriver?.name ?? "Unassigned"}</span>
                    </div>
                  </div>

                  {cands.length > 0 && editable && (
                    <div style={{ marginTop: 10 }}>
                      <small>Possible vehicle candidates in Odoo. Tap to assign:</small>
                      {cands.map(c => (
                        <button key={c.id} className="pill" style={{ margin: 4, border: "1px solid var(--line)" }}
                          onClick={() => confirm(`Assign this fine to ${c.plate}? This is recorded as a manual decision.`) && act("correct", { vehicleOdooId: c.id }, "Vehicle assigned manually.")}>
                          {c.plate}{c.model ? ` · ${c.model}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* SECTION 3: VIOLATION DETAILS */}
                <div className="card" style={{ marginBottom: 14 }}>
                  <b>Section 3 — Violation Details (OCR Extracted)</b>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, fontSize: 13 }}>
                    <div><small style={{ color: "var(--muted)" }}>Violation Code:</small> {valOrFallback(ocrFields.violationCode)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Violation Category:</small> {valOrFallback(ocrFields.violationCategory)}</div>
                    <div style={{ gridColumn: "1 / -1" }}><small style={{ color: "var(--muted)" }}>Description:</small> {valOrFallback(ocrFields.description)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Location / Place:</small> {valOrFallback(ocrFields.violationLocation)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Road Name / Highway:</small> {valOrFallback(ocrFields.roadName)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Area / District:</small> {valOrFallback(ocrFields.area)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Speed Limit:</small> {ocrFields.speedLimit?.value ? `${ocrFields.speedLimit.value} km/h` : "Not available in document"}</div>
                    <div><small style={{ color: "var(--muted)" }}>Recorded Speed:</small> {ocrFields.recordedSpeed?.value ? `${ocrFields.recordedSpeed.value} km/h` : "Not available in document"}</div>
                    {ocrFields.authorityComments && (
                      <div style={{ gridColumn: "1 / -1" }}><small style={{ color: "var(--muted)" }}>Authority Comments:</small> {valOrFallback(ocrFields.authorityComments)}</div>
                    )}
                  </div>
                </div>

                {/* SECTION 4 & 5: FINANCIAL & PAYMENT DETAILS */}
                <div className="card" style={{ marginBottom: 14 }}>
                  <b>Section 4 & 5 — Financial & Payment Information</b>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10, fontSize: 13 }}>
                    <div><small style={{ color: "var(--muted)" }}>Original Fine Amount:</small> AED {f.amount != null ? Number(f.amount).toFixed(2) : "0.00"}</div>
                    <div><small style={{ color: "var(--muted)" }}>Additional Penalty / Late Fee:</small> AED {f.additionalPenalty != null ? Number(f.additionalPenalty).toFixed(2) : "0.00"}</div>
                    <div><small style={{ color: "var(--muted)" }}>Discount Amount:</small> {ocrFields.discountAmount?.value ? `AED ${Number(ocrFields.discountAmount.value).toFixed(2)}` : "Not available in document"}</div>
                    <div><small style={{ color: "var(--muted)" }}>Discount Deadline:</small> {valOrFallback(ocrFields.discountDeadline)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Admin / Service Charges:</small> {ocrFields.adminCharges?.value ? `AED ${Number(ocrFields.adminCharges.value).toFixed(2)}` : "None"}</div>
                    <div><small style={{ color: "var(--muted)" }}>Total Payable:</small> <b>AED {(Number(f.amount ?? 0) + Number(f.additionalPenalty ?? 0)).toFixed(2)}</b></div>
                    <div><small style={{ color: "var(--muted)" }}>Payment Channel:</small> {valOrFallback(ocrFields.paymentChannel)}</div>
                    <div><small style={{ color: "var(--muted)" }}>Payment Reference:</small> {valOrFallback(ocrFields.paymentReference ?? f.paymentReference)}</div>
                    {ocrFields.paymentUrl?.value && (
                      <div style={{ gridColumn: "1 / -1" }}>
                        <small style={{ color: "var(--muted)" }}>Payment Portal URL:</small>{" "}
                        <a href={ocrFields.paymentUrl.value} target="_blank" rel="noreferrer" style={{ wordBreak: "break-all" }}>
                          {ocrFields.paymentUrl.value} <ExternalLink size={12} style={{ display: "inline" }} />
                        </a>
                      </div>
                    )}
                    {ocrFields.paymentInstructions?.value && (
                      <div style={{ gridColumn: "1 / -1" }}><small style={{ color: "var(--muted)" }}>Payment Instructions:</small> {ocrFields.paymentInstructions.value}</div>
                    )}
                  </div>
                </div>

                {/* SECTION 8: ADDITIONAL EXTRACTED FIELDS */}
                {Array.isArray(ocrFields.additionalFields) && ocrFields.additionalFields.length > 0 && (
                  <div className="card" style={{ marginBottom: 14 }}>
                    <b>Section 8 — Additional Extracted Fields ({ocrFields.additionalFields.length})</b>
                    <p style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 8px" }}>Dynamic key-value pairs captured from the challan notice.</p>
                    <div className="tbl" style={{ marginTop: 8 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Label as Printed</th>
                            <th>Extracted Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ocrFields.additionalFields.map((af: AdditionalField, i: number) => (
                            <tr key={i}>
                              <td><b>{af.label}</b></td>
                              <td>{af.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* TAB 2: ALL EXTRACTED FIELDS TABLE */}
            {activeTab === "all-fields" && (
              <div className="card" style={{ marginBottom: 14 }}>
                <b>All Extracted Fields (Complete OCR Inventory)</b>
                <div className="tbl" style={{ marginTop: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Field Name</th>
                        <th>Extracted Value</th>
                        <th>Original Snippet / Line</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(ocrFields)
                        .filter(([k]) => k !== "additionalFields" && k !== "warnings" && k !== "rawText")
                        .map(([k, v]: [string, any]) => (
                          <tr key={k}>
                            <td><code>{k}</code></td>
                            <td><b>{valOrFallback(v)}</b></td>
                            <td style={{ fontSize: 12, color: "var(--muted)" }}>{v?.snippet ?? "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: RAW OCR TEXT */}
            {activeTab === "raw" && (
              <div className="card" style={{ marginBottom: 14 }}>
                <b>Raw OCR Provider Output</b>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#f8fafc", padding: 12, borderRadius: 8, maxHeight: 500, overflow: "auto" }}>
                  {data.job?.rawText ?? "No raw text available."}
                </pre>
              </div>
            )}

            {/* WORKFLOW ACTIONS */}
            {editable && (
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn" disabled={busy} onClick={() => confirm("Approve this fine? The driver will be notified and it will be queued to be recorded in the ERP.") && act("approve", { confirmNotDuplicate: dup }, "Approved.")}>
                  Approve Fine
                </button>
                <button className="btn red" disabled={busy} onClick={() => { const r = prompt("Why is this being rejected?"); if (r) act("reject", { reason: r }, "Rejected."); }}>
                  Reject Notice
                </button>
              </div>
            )}
            {dup && <p className="warn" style={{ marginTop: 10 }}>This may be a duplicate. Tap Approve again only if you have checked it is not.</p>}

            {["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "DISPUTED", "CLOSED"].includes(wf) && (
              <div className="card" style={{ marginTop: 12 }}>
                <b>Workflow: {wf.replace(/_/g, " ").toLowerCase()}{(f.escalationLevel ?? 0) > 0 ? ` · escalated (level ${f.escalationLevel})` : ""}</b>
                <div className="row" style={{ marginTop: 8 }}>
                  <span><small>Paid (verified)</small> AED {Number(f.amountPaid ?? 0).toFixed(2)}</span>
                  <span><small>Total shown</small> AED {(Number(f.amount ?? 0) + Number(f.additionalPenalty ?? 0)).toFixed(2)}</span>
                </div>
                {f.disputeReason && <p className="warn" style={{ marginTop: 8 }}>Driver dispute: {f.disputeReason}</p>}
                {wf === "PAID_AWAITING_VERIFICATION" && (
                  <p className="warn" style={{ marginTop: 8 }}>
                    Payment of AED {Number(f.paymentClaimedAmount ?? 0).toFixed(2)} reported{f.paymentReference ? ` (ref ${f.paymentReference})` : ""}. Check the receipt before verifying.
                  </p>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {wf !== "CLOSED" && <button className="btn sm" disabled={busy} onClick={() => vendor(true)}>Email vendor…</button>}
                  {["ACK_PENDING", "PAYMENT_PENDING"].includes(wf) && <button className="btn sm" style={{ background: "var(--navy)" }} disabled={busy} onClick={recordPay}>Record payment</button>}
                  {wf === "PAID_AWAITING_VERIFICATION" && (
                    <>
                      <button className="btn sm green" disabled={busy} onClick={() => confirm("Verify this payment against the receipt?") && post("verify-payment", { approved: true }, "Payment verified.")}>Verify payment</button>
                      <button className="btn sm red" disabled={busy} onClick={() => { const r = prompt("Why can't the payment be accepted?"); if (r) post("verify-payment", { approved: false, reason: r }, "Payment not accepted."); }}>Not accepted</button>
                    </>
                  )}
                  {wf !== "CLOSED" && <button className="btn sm" style={{ background: "#6b7280" }} disabled={busy} onClick={() => { const r = prompt("Reason for closing without full verified payment?"); if (r) post("close", { reason: r }, "Closed."); }}>Close</button>}
                  {["CLOSED", "DISPUTED"].includes(wf) && <button className="btn sm" style={{ background: "#6b7280" }} disabled={busy} onClick={() => { const r = prompt("Reason for reopening?"); if (r) post("reopen", { reason: r }, "Reopened."); }}>Reopen</button>}
                </div>
                {f.closedReason && <p className="foot" style={{ textAlign: "left" }}>Closed: {f.closedReason}</p>}
              </div>
            )}

            {hist.data && (hist.data.audit.length > 0 || hist.data.notifications.length > 0) && (
              <details style={{ marginTop: 12 }}>
                <summary>Audit History & Sent Notifications</summary>
                <div style={{ fontSize: 13, display: "grid", gap: 4, marginTop: 6 }}>
                  {hist.data.audit.map(a => <div key={a.id}>{a.createdAt.slice(0, 16).replace("T", " ")} · {a.action.replace("fine.", "").replace(/_/g, " ")}</div>)}
                  {hist.data.notifications.map(n => <div key={n.id}>{n.createdAt.slice(0, 16).replace("T", " ")} · email to {n.recipient}: {n.status.toLowerCase()}</div>)}
                </div>
              </details>
            )}
            {f.rejectedReason && <p className="err" style={{ marginTop: 10 }}>Rejected: {f.rejectedReason}</p>}
          </div>
        </div>
      )}
    </AdminShell>
  );
}
