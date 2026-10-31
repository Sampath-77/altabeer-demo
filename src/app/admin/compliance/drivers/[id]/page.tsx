"use client";
import { useState } from "react";
import { ShieldAlert, ShieldCheck, ArrowLeft, RefreshCw, AlertTriangle, FileText, Download } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useApi, fmtDateTime } from "@/lib/client";

interface DriverProfileData {
  user: {
    id: string;
    loginId: string;
    role: string;
    status: string;
    odooEmployeeId: number | null;
    createdAt: string;
  };
  employee: {
    id: number;
    name: string;
    active: boolean;
    jobTitle?: string;
  } | null;
  assignment: {
    vehicle: { id: number; plate: string; model?: string; vendorId?: number };
    assignment: { from: string; to?: string | null };
  } | null;
  shifts: {
    id: number;
    checkIn: string;
    checkOut?: string | null;
  }[];
  checkInStatus: {
    eligible: boolean;
    activeFlag: {
      id: string;
      flagReference: string;
      reportingDate: string;
      reason: string;
      createdAt: string;
    } | null;
  };
  reports: {
    id: string;
    reportReference: string;
    reportingDate: string;
    reportType: string;
    violationCategory: string | null;
    violationDescription: string | null;
    violationLocation: string | null;
    violationDatetime: string | null;
    fineReference: string | null;
    reportedFineAmount: number | null;
    driverExplanation: string | null;
    declarationConfirmed: boolean;
    submissionStatus: string;
    submittedLate: boolean;
    adminRemarks: string | null;
    submittedAt: string;
    attachments: { id: string; originalFilename: string; fileSizeBytes: number }[];
  }[];
  flags: {
    id: string;
    flagReference: string;
    reportingDate: string;
    reason: string;
    status: string;
    resolvedAt: string | null;
    resolvedBy: string | null;
    resolutionRemarks: string | null;
    createdAt: string;
  }[];
  exemptions: {
    id: string;
    reportingDate: string;
    reason: string;
    approvedBy: string;
    approvedAt: string;
  }[];
  auditLogs: {
    id: string;
    action: string;
    performedBy: string;
    performedByRole: string;
    reason: string | null;
    createdAt: string;
  }[];
}

export default function DriverComplianceProfilePage({ params }: { params: { id: string } }) {
  const { data, loading, error, reload } = useApi<DriverProfileData>(`/api/admin/compliance/drivers/${params.id}`);
  const [tab, setTab] = useState<"reports" | "flags" | "exemptions" | "shifts" | "audit">("reports");

  const [resolvingFlagId, setResolvingFlagId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!resolvingFlagId || !remarks.trim()) return;
    setBusy(true);
    setActionErr(null);
    try {
      const res = await fetch(`/api/admin/compliance/flags/${resolvingFlagId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "ADMIN_TEMPORARY_OVERRIDE",
          remarks: remarks.trim(),
          override: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Failed to remove restriction.");
      setResolvingFlagId(null);
      setRemarks("");
      reload();
    } catch (err) {
      setActionErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell
      title={data ? `Compliance Profile: ${data.employee?.name ?? data.user.loginId}` : "Driver Compliance Profile"}
      sub="Detailed daily reports, attendance history, and restriction overrides"
    >
      <div style={{ marginBottom: 16 }}>
        <a href="/admin/compliance" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--navy)" }}>
          <ArrowLeft size={16} /> Back to Compliance Management
        </a>
      </div>

      {error && <div className="err">{error}</div>}
      {loading && !data && <div className="card empty">Loading driver compliance profile…</div>}

      {data && (
        <>
          {/* Top Overview Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 20 }}>
            {/* Identity & ERP Info */}
            <div className="card">
              <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Driver Information</h3>
              <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                <div className="row">
                  <span style={{ color: "var(--mute)" }}>Name</span>
                  <b>{data.employee?.name ?? "—"}</b>
                </div>
                <div className="row">
                  <span style={{ color: "var(--mute)" }}>App Login</span>
                  <code>{data.user.loginId}</code>
                </div>
                <div className="row">
                  <span style={{ color: "var(--mute)" }}>Odoo Employee ID</span>
                  <span>{data.user.odooEmployeeId ?? "—"}</span>
                </div>
                <div className="row">
                  <span style={{ color: "var(--mute)" }}>Role / Job</span>
                  <span>{data.employee?.jobTitle ?? data.user.role}</span>
                </div>
                <div className="row">
                  <span style={{ color: "var(--mute)" }}>Account Status</span>
                  <span className="badge submitted">{data.user.status}</span>
                </div>
              </div>
            </div>

            {/* Check-In Eligibility Status Card */}
            <div className="card" style={!data.checkInStatus.eligible ? { borderColor: "#fca5a5", background: "#fef2f2" } : { borderColor: "#bbf7d0", background: "#f0fdf4" }}>
              <h3 style={{ margin: "0 0 10px", fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
                {data.checkInStatus.eligible ? (
                  <><ShieldCheck color="var(--green)" /> Check-In Allowed</>
                ) : (
                  <><ShieldAlert color="var(--red)" /> Check-In Restricted</>
                )}
              </h3>
              {data.checkInStatus.eligible ? (
                <p style={{ fontSize: 14, color: "#166534", margin: "0 0 10px" }}>
                  This driver is fully compliant. No active daily report restrictions.
                </p>
              ) : (
                <div style={{ fontSize: 13, color: "#7f1d1d" }}>
                  <p style={{ margin: "0 0 6px" }}>
                    Missing daily report for: <strong>{data.checkInStatus.activeFlag?.reportingDate}</strong>
                  </p>
                  <p style={{ margin: "0 0 10px" }}>
                    Flag Ref: <code>{data.checkInStatus.activeFlag?.flagReference}</code>
                  </p>
                  <button
                    className="btn sm red"
                    style={{ width: "auto" }}
                    onClick={() => {
                      setResolvingFlagId(data.checkInStatus.activeFlag!.id);
                      setActionErr(null);
                    }}
                  >
                    Remove Restriction & Restore Check-In
                  </button>
                </div>
              )}
            </div>

            {/* Vehicle Assignment */}
            <div className="card">
              <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Assigned Vehicle</h3>
              {data.assignment ? (
                <div style={{ display: "grid", gap: 6, fontSize: 14 }}>
                  <div className="row">
                    <span style={{ color: "var(--mute)" }}>Plate</span>
                    <b>{data.assignment.vehicle.plate}</b>
                  </div>
                  <div className="row">
                    <span style={{ color: "var(--mute)" }}>Model</span>
                    <span>{data.assignment.vehicle.model ?? "—"}</span>
                  </div>
                  <div className="row">
                    <span style={{ color: "var(--mute)" }}>Assigned Since</span>
                    <span>{data.assignment.assignment.from.slice(0, 10)}</span>
                  </div>
                </div>
              ) : (
                <p style={{ color: "var(--mute)", fontSize: 14 }}>No current vehicle assigned in Odoo fleet.</p>
              )}
            </div>
          </div>

          {/* Action dialog if removing restriction */}
          {resolvingFlagId && (
            <div className="card" style={{ marginBottom: 20, border: "2px solid var(--orange)" }}>
              <h3 style={{ margin: "0 0 8px", display: "flex", alignItems: "center", gap: 8 }}>
                <AlertTriangle color="var(--orange)" size={18} /> Confirm Restriction Removal
              </h3>
              {actionErr && <div className="err">{actionErr}</div>}
              <form onSubmit={handleResolve}>
                <div className="field">
                  <label>Administrative Explanation (Audit Log) *</label>
                  <input
                    type="text"
                    placeholder="Enter reason for restoring check-in permission…"
                    value={remarks}
                    onChange={e => setRemarks(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="btn sm" style={{ background: "var(--line)", color: "var(--ink)", width: "auto" }} onClick={() => setResolvingFlagId(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn sm green" style={{ width: "auto" }} disabled={busy}>
                    {busy ? "Processing…" : "Restore Access"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: 8, borderBottom: "1px solid var(--line)", marginBottom: 16 }}>
            <button
              onClick={() => setTab("reports")}
              style={{
                padding: "10px 16px",
                border: "none",
                background: "none",
                fontWeight: tab === "reports" ? 700 : 500,
                borderBottom: tab === "reports" ? "2px solid var(--orange)" : "none",
                color: tab === "reports" ? "var(--orange)" : "var(--mute)",
              }}
            >
              Daily Reports ({data.reports.length})
            </button>
            <button
              onClick={() => setTab("flags")}
              style={{
                padding: "10px 16px",
                border: "none",
                background: "none",
                fontWeight: tab === "flags" ? 700 : 500,
                borderBottom: tab === "flags" ? "2px solid var(--orange)" : "none",
                color: tab === "flags" ? "var(--orange)" : "var(--mute)",
              }}
            >
              Compliance Flags ({data.flags.length})
            </button>
            <button
              onClick={() => setTab("exemptions")}
              style={{
                padding: "10px 16px",
                border: "none",
                background: "none",
                fontWeight: tab === "exemptions" ? 700 : 500,
                borderBottom: tab === "exemptions" ? "2px solid var(--orange)" : "none",
                color: tab === "exemptions" ? "var(--orange)" : "var(--mute)",
              }}
            >
              Exemptions ({data.exemptions.length})
            </button>
            <button
              onClick={() => setTab("shifts")}
              style={{
                padding: "10px 16px",
                border: "none",
                background: "none",
                fontWeight: tab === "shifts" ? 700 : 500,
                borderBottom: tab === "shifts" ? "2px solid var(--orange)" : "none",
                color: tab === "shifts" ? "var(--orange)" : "var(--mute)",
              }}
            >
              Recent Shifts ({data.shifts.length})
            </button>
            <button
              onClick={() => setTab("audit")}
              style={{
                padding: "10px 16px",
                border: "none",
                background: "none",
                fontWeight: tab === "audit" ? 700 : 500,
                borderBottom: tab === "audit" ? "2px solid var(--orange)" : "none",
                color: tab === "audit" ? "var(--orange)" : "var(--mute)",
              }}
            >
              Audit Trail ({data.auditLogs.length})
            </button>
          </div>

          {/* Tab 1: Daily Reports */}
          {tab === "reports" && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Description & Notes</th>
                    <th>Fine Details</th>
                    <th>Evidence</th>
                    <th>Status</th>
                    <th>Submitted At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.reports.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No daily reports submitted yet.</td></tr>
                  )}
                  {data.reports.map(r => (
                    <tr key={r.id}>
                      <td><code>{r.reportReference}</code></td>
                      <td><b>{r.reportingDate}</b></td>
                      <td>
                        <span className={`badge ${r.reportType === "VIOLATION" ? "violation" : "noviolation"}`}>
                          {r.reportType === "VIOLATION" ? "Violation" : "No Violation"}
                        </span>
                      </td>
                      <td>{r.violationCategory?.replace(/_/g, " ") ?? "—"}</td>
                      <td style={{ maxWidth: 260, fontSize: 13 }}>
                        {r.violationDescription ? <div><strong>Desc:</strong> {r.violationDescription}</div> : null}
                        {r.driverExplanation ? <div style={{ color: "var(--mute)" }}><strong>Expl:</strong> {r.driverExplanation}</div> : null}
                        {r.adminRemarks ? <div style={{ color: "#166534" }}><strong>Admin:</strong> {r.adminRemarks}</div> : null}
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {r.reportedFineAmount != null ? (
                          <><b>AED {r.reportedFineAmount.toFixed(2)}</b><br /><small>{r.fineReference ?? ""}</small></>
                        ) : "—"}
                      </td>
                      <td>
                        {r.attachments.length > 0 ? (
                          <div style={{ display: "grid", gap: 4 }}>
                            {r.attachments.map(att => (
                              <a
                                key={att.id}
                                href={`/api/compliance/attachments/${att.id}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ fontSize: 12, color: "var(--navy)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}
                              >
                                <Download size={12} /> {att.originalFilename}
                              </a>
                            ))}
                          </div>
                        ) : <span style={{ color: "var(--mute)" }}>—</span>}
                      </td>
                      <td>
                        <span className="badge submitted">{r.submissionStatus}</span>
                        {r.submittedLate && <span className="badge pending" style={{ marginLeft: 4 }}>Late</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDateTime(r.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 2: Compliance Flags */}
          {tab === "flags" && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Flag Ref</th>
                    <th>Reporting Date</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Resolution Info</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flags.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No compliance flags on record.</td></tr>
                  )}
                  {data.flags.map(f => (
                    <tr key={f.id}>
                      <td><code>{f.flagReference}</code></td>
                      <td><strong>{f.reportingDate}</strong></td>
                      <td style={{ maxWidth: 300, fontSize: 13 }}>{f.reason}</td>
                      <td>
                        <span className={`badge ${f.status === "ACTIVE" ? "restricted" : "submitted"}`}>
                          {f.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {f.resolvedAt ? (
                          <div>
                            <span>Resolved by: {f.resolvedBy}</span><br />
                            <small style={{ color: "var(--mute)" }}>{f.resolutionRemarks ?? ""}</small>
                          </div>
                        ) : "—"}
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtDateTime(f.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 3: Exemptions */}
          {tab === "exemptions" && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Reporting Date</th>
                    <th>Reason</th>
                    <th>Approved By</th>
                    <th>Approved At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exemptions.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No exemptions approved for this driver.</td></tr>
                  )}
                  {data.exemptions.map(e => (
                    <tr key={e.id}>
                      <td><strong>{e.reportingDate}</strong></td>
                      <td>{e.reason}</td>
                      <td>{e.approvedBy}</td>
                      <td style={{ fontSize: 12 }}>{fmtDateTime(e.approvedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 4: Shifts */}
          {tab === "shifts" && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Shift ID</th>
                    <th>Check In</th>
                    <th>Check Out</th>
                  </tr>
                </thead>
                <tbody>
                  {data.shifts.length === 0 && (
                    <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No recent attendance records found.</td></tr>
                  )}
                  {data.shifts.map(s => (
                    <tr key={s.id}>
                      <td>#{s.id}</td>
                      <td>{fmtDateTime(s.checkIn)}</td>
                      <td>{s.checkOut ? fmtDateTime(s.checkOut) : <span className="tag g">In Progress</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab 5: Audit Trail */}
          {tab === "audit" && (
            <div className="tbl">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Performed By</th>
                    <th>Role</th>
                    <th>Reason / Details</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {data.auditLogs.length === 0 && (
                    <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No compliance audit logs for this driver.</td></tr>
                  )}
                  {data.auditLogs.map(l => (
                    <tr key={l.id}>
                      <td><code style={{ fontWeight: 600 }}>{l.action}</code></td>
                      <td>{l.performedBy}</td>
                      <td><span className="badge submitted">{l.performedByRole}</span></td>
                      <td style={{ maxWidth: 300, fontSize: 13 }}>{l.reason ?? "—"}</td>
                      <td style={{ fontSize: 12 }}>{fmtDateTime(l.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AdminShell>
  );
}

