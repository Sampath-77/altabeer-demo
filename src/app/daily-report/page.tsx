"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Upload, X, AlertTriangle, Clipboard } from "lucide-react";
import Shell from "@/components/Shell";
import { api, useApi, fmtDateTime } from "@/lib/client";

const CATEGORIES = [
  ["SPEEDING", "Speeding"], ["PARKING_VIOLATION", "Parking Violation"],
  ["RED_LIGHT_VIOLATION", "Red-Light Violation"], ["WRONG_PARKING", "Wrong Parking"],
  ["LANE_VIOLATION", "Lane Violation"], ["VEHICLE_ACCIDENT", "Vehicle Accident"],
  ["VEHICLE_DAMAGE", "Vehicle Damage"], ["VEHICLE_INCIDENT", "Vehicle-Related Incident"],
  ["OTHER", "Other"],
] as const;

interface Asg { assignment: { plate: string; model: string | null } | null }
interface SubmitResult { reportReference: string; reportingDate: string; reportType: string; submittedAt: string; submittedLate: boolean }

function dubaiDateStr(offsetDays = 0) {
  const d = new Date(Date.now() + 4 * 3600_000 - offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}
function fmtDateLabel(d: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T00:00:00+04:00"));
}

function DailyReportForm() {
  const searchParams = useSearchParams();
  const prefillDate = searchParams.get("date") ?? dubaiDateStr();

  const [reportType, setReportType] = useState<"VIOLATION" | "NO_VIOLATION" | null>(null);
  const [date, setDate] = useState(prefillDate);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [violationDate, setViolationDate] = useState("");
  const [violationTime, setViolationTime] = useState("");
  const [fineRef, setFineRef] = useState("");
  const [fineAmount, setFineAmount] = useState("");
  const [explanation, setExplanation] = useState("");
  const [declared, setDeclared] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: dash } = useApi<Asg>("/api/driver/dashboard");
  const plate = dash?.assignment?.plate;
  const model = dash?.assignment?.model;

  const today = dubaiDateStr();
  const yesterday = dubaiDateStr(1);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reportType) { setError("Select a report type."); return; }
    if (reportType === "VIOLATION") {
      if (!category) { setError("Select a violation category."); return; }
      if (!description.trim()) { setError("Describe the violation or incident."); return; }
      if (!explanation.trim()) { setError("Provide your explanation."); return; }
    }
    if (reportType === "NO_VIOLATION" && !declared) { setError("Confirm the declaration before submitting."); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("reportingDate", date);
      form.append("reportType", reportType);
      if (reportType === "VIOLATION") {
        form.append("violationCategory", category);
        form.append("violationDescription", description);
        form.append("violationLocation", location);
        if (violationDate) form.append("violationDatetime", `${violationDate}T${violationTime || "00:00"}:00+04:00`);
        form.append("fineReference", fineRef);
        if (fineAmount) form.append("reportedFineAmount", fineAmount);
        form.append("driverExplanation", explanation);
      }
      form.append("declarationConfirmed", declared ? "true" : "false");
      for (const f of files) form.append("file", f);
      const r = await fetch("/api/driver/daily-reports/submit", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Submission failed.");
      setResult(j);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files, ...Array.from(list)].slice(0, 5);
    setFiles(next);
  }

  if (result) {
    return (
      <Shell title="Daily Violation Report" subtitle="Mandatory daily compliance">
        <div className="success-modal card">
          <div className="check"><CheckCircle2 size={28} /></div>
          <h2 style={{ margin: "0 0 8px" }}>Report Submitted</h2>
          <p style={{ color: "var(--mute)", margin: "0 0 16px" }}>Your daily report has been recorded successfully.</p>
          <div className="card row" style={{ marginBottom: 10 }}>
            <div><small>Reference</small><b style={{ fontFamily: "monospace" }}>{result.reportReference}</b></div>
            <div style={{ textAlign: "right" }}><small>Date</small><b>{fmtDateLabel(result.reportingDate)}</b></div>
          </div>
          <div className="card row" style={{ marginBottom: 10 }}>
            <div><small>Type</small><b>{result.reportType === "NO_VIOLATION" ? "No Violation Declaration" : "Violation / Incident Report"}</b></div>
            <div style={{ textAlign: "right" }}><small>Submitted</small><b>{fmtDateTime(result.submittedAt)}</b></div>
          </div>
          {result.submittedLate && <div className="warn" style={{ marginBottom: 10 }}>This report was submitted after the reporting deadline. It has been recorded with its actual submission timestamp.</div>}
          <a href="/" className="btn" style={{ display: "block", textAlign: "center" }}>Back to Home</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="Daily Violation Report" subtitle="Mandatory daily compliance — submit by end of working day">
      {error && <div className="err" role="alert">{error}</div>}
      <form onSubmit={handleSubmit}>
        {/* Date selector */}
        <div className="form-section">
          <h3>Reporting Date</h3>
          <div className="field">
            <select value={date} onChange={e => setDate(e.target.value)} disabled={!!searchParams.get("date")}>
              <option value={today}>Today — {fmtDateLabel(today)}</option>
              <option value={yesterday}>Yesterday — {fmtDateLabel(yesterday)}</option>
            </select>
            {searchParams.get("date") && date !== today && date !== yesterday && (
              <p style={{ fontSize: 12, color: "var(--mute)", margin: "6px 0 0" }}>Reporting for {fmtDateLabel(date)} (pending report)</p>
            )}
          </div>
        </div>

        {/* Vehicle info (auto-populated) */}
        {(plate || model) && (
          <div className="form-section">
            <h3>Your Assigned Vehicle</h3>
            <div className="card row">
              <div><small>Registration</small><b>{plate ?? "—"}</b></div>
              <div style={{ textAlign: "right" }}><small>Make/Model</small><b>{model ?? "—"}</b></div>
            </div>
          </div>
        )}

        {/* Report type selection */}
        <div className="form-section">
          <h3>Report Type <span style={{ color: "var(--red)" }}>*</span></h3>
          <div className="radio-group">
            <label className={`radio-opt ${reportType === "VIOLATION" ? "selected" : ""}`}>
              <input type="radio" name="rtype" value="VIOLATION" onChange={() => setReportType("VIOLATION")} />
              <div>
                <b style={{ display: "flex", alignItems: "center", gap: 6 }}><AlertTriangle size={16} color="var(--red)" /> I have a violation or incident to report</b>
                <small style={{ color: "var(--mute)" }}>Traffic violation, vehicle accident, damage, or any related incident</small>
              </div>
            </label>
            <label className={`radio-opt ${reportType === "NO_VIOLATION" ? "selected" : ""}`}>
              <input type="radio" name="rtype" value="NO_VIOLATION" onChange={() => setReportType("NO_VIOLATION")} />
              <div>
                <b style={{ display: "flex", alignItems: "center", gap: 6 }}><CheckCircle2 size={16} color="var(--green)" /> I have no violations or incidents to report</b>
                <small style={{ color: "var(--mute)" }}>Confirm that today was incident-free</small>
              </div>
            </label>
          </div>
        </div>

        {/* Violation form */}
        {reportType === "VIOLATION" && (
          <>
            <div className="form-section">
              <h3>Violation Details</h3>
              <div className="field">
                <label>Violation Category <span style={{ color: "var(--red)" }}>*</span></label>
                <select value={category} onChange={e => setCategory(e.target.value)} required>
                  <option value="">Select category…</option>
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Description <span style={{ color: "var(--red)" }}>*</span></label>
                <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what happened in detail…" maxLength={1000} required />
              </div>
              <div className="field">
                <label>Location (optional)</label>
                <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g., Sheikh Zayed Road, Al Quoz" maxLength={200} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Violation Date</label>
                  <input type="date" value={violationDate} onChange={e => setViolationDate(e.target.value)} max={today} />
                </div>
                <div className="field">
                  <label>Violation Time</label>
                  <input type="time" value={violationTime} onChange={e => setViolationTime(e.target.value)} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div className="field">
                  <label>Fine Reference No. (optional)</label>
                  <input type="text" value={fineRef} onChange={e => setFineRef(e.target.value)} placeholder="e.g., TF-2026-XXXXX" maxLength={60} />
                </div>
                <div className="field">
                  <label>Fine Amount AED (optional)</label>
                  <input type="number" value={fineAmount} onChange={e => setFineAmount(e.target.value)} placeholder="0.00" min={0} max={100000} step={0.01} />
                </div>
              </div>
            </div>

            <div className="form-section">
              <h3>Your Explanation <span style={{ color: "var(--red)" }}>*</span></h3>
              <div className="field">
                <textarea value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="Explain the circumstances in your own words…" maxLength={1000} required />
              </div>
            </div>

            <div className="form-section">
              <h3>Supporting Evidence (optional)</h3>
              <p style={{ fontSize: 13, color: "var(--mute)", margin: "0 0 10px" }}>Upload photographs, official fine notices, or other documents. Max 5 files, 8 MB each. JPEG, PNG, WebP, or PDF.</p>
              <div className="file-upload-area" onClick={() => fileRef.current?.click()}>
                <Upload size={24} style={{ margin: "0 auto 8px", display: "block" }} />
                Tap to upload photos or documents
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple style={{ display: "none" }} onChange={e => addFiles(e.target.files)} />
              {files.length > 0 && (
                <div className="file-list" style={{ marginTop: 10 }}>
                  {files.map((f, i) => (
                    <div key={i} className="file-item">
                      <span>{f.name} <span style={{ color: "var(--mute)", fontSize: 11 }}>({(f.size / 1024).toFixed(0)} KB)</span></span>
                      <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer" }}><X size={14} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* No-violation declaration */}
        {reportType === "NO_VIOLATION" && (
          <div className="form-section">
            <h3>Declaration</h3>
            <div className="declaration-box">
              <Clipboard size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              <strong>I confirm that I have no traffic violations, incidents, or vehicle-related issues to report for this working day ({fmtDateLabel(date)}).</strong>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", fontSize: 14 }}>
              <input type="checkbox" checked={declared} onChange={e => setDeclared(e.target.checked)} style={{ marginTop: 3, accentColor: "var(--orange)" }} />
              <span>I confirm the above declaration is true and accurate to the best of my knowledge.</span>
            </label>
          </div>
        )}

        {reportType && (
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Submitting…" : "Submit Daily Report"}
          </button>
        )}
      </form>
    </Shell>
  );
}

export default function DailyReportPage() {
  return (
    <Suspense fallback={<div className="card empty">Loading…</div>}>
      <DailyReportForm />
    </Suspense>
  );
}

