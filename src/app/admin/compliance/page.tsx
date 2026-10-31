"use client";
import { useState } from "react";
import { ShieldAlert, ShieldCheck, RefreshCw, X, AlertTriangle, Eye, PlusCircle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useApi, fmtDateTime } from "@/lib/client";

interface FlagRow {
  id: string;
  flagReference: string;
  driverUserId: string;
  odooEmployeeId: number;
  driverName: string;
  driverLogin: string;
  reportingDate: string;
  flagType: string;
  reason: string;
  status: "ACTIVE" | "RESOLVED" | "OVERRIDDEN" | "CANCELLED";
  adminEscalated: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionReason: string | null;
  resolutionRemarks: string | null;
  createdAt: string;
}

interface ComplianceDashboardData {
  reportingDate: string;
  totalExpected: number;
  totalSubmitted: number;
  violationReports: number;
  noViolationDeclarations: number;
  pendingReports: number;
  missingReports: number;
  awaitingReview: number;
  exemptedToday: number;
  activeRestrictions: number;
  generatedAt: string;
}

const Stat = ({ l, v, red }: { l: string; v: number; red?: boolean }) => (
  <div className={`stat ${red && v > 0 ? "navy" : ""}`} style={red && v > 0 ? { background: "#991b1b" } : {}}>
    <small>{l}</small>
    <b>{v}</b>
  </div>
);

const RESOLUTION_REASONS = [
  { value: "REPORT_SUBMITTED", label: "Driver submitted report" },
  { value: "SUBMITTED_EXTERNAL_CHANNEL", label: "Submitted through another approved channel" },
  { value: "INCORRECT_REQUIREMENT", label: "Reporting requirement was incorrectly generated" },
  { value: "APPROVED_EXCEPTION", label: "Approved exception / rest day" },
  { value: "ADMIN_TEMPORARY_OVERRIDE", label: "Admin-authorized temporary override" },
  { value: "OTHER", label: "Other authorized reason" },
];

export default function AdminCompliancePage() {
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [search, setSearch] = useState("");
  const [selectedFlag, setSelectedFlag] = useState<FlagRow | null>(null);
  const [resolveReason, setResolveReason] = useState("ADMIN_TEMPORARY_OVERRIDE");
  const [resolveRemarks, setResolveRemarks] = useState("");
  const [isOverride, setIsOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Exemption modal state
  const [showExemptModal, setShowExemptModal] = useState(false);
  const [exemptDriverId, setExemptDriverId] = useState("");
  const [exemptDate, setExemptDate] = useState(new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10));
  const [exemptReason, setExemptReason] = useState("");

  const { data: dash, reload: reloadDash } = useApi<ComplianceDashboardData>("/api/admin/compliance/dashboard");
  const qs = new URLSearchParams({ ...(statusFilter && { status: statusFilter }), ...(search && { search }) }).toString();
  const { data: flagData, loading, error, reload: reloadFlags } = useApi<{ flags: FlagRow[] }>(`/api/admin/compliance/flags?${qs}`);

  const reloadAll = () => {
    reloadDash();
    reloadFlags();
  };

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedFlag) return;
    if (!resolveRemarks.trim()) {
      setActionErr("Please enter remarks/explanation.");
      return;
    }
    setSubmitting(true);
    setActionErr(null);
    try {
      const res = await fetch(`/api/admin/compliance/flags/${selectedFlag.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: resolveReason,
          remarks: resolveRemarks,
          override: isOverride,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Failed to remove restriction.");
      setSelectedFlag(null);
      setResolveRemarks("");
      reloadAll();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGrantExemption(e: React.FormEvent) {
    e.preventDefault();
    if (!exemptDriverId.trim() || !exemptReason.trim()) {
      setActionErr("Please fill in all exemption fields.");
      return;
    }
    setSubmitting(true);
    setActionErr(null);
    try {
      const res = await fetch("/api/admin/compliance/exemptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverUserId: exemptDriverId.trim(),
          reportingDate: exemptDate,
          reason: exemptReason.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Failed to grant exemption.");
      setShowExemptModal(false);
      setExemptReason("");
      reloadAll();
    } catch (e) {
      setActionErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminShell
      title="Driver Compliance Management"
      sub="Review check-in restrictions, approve exemptions, and restore check-in access"
    >
      {/* KPI Cards */}
      {dash && (
        <div className="cards" style={{ marginBottom: 20 }}>
          <Stat l="Active Check-in Restrictions" v={dash.activeRestrictions} red />
          <Stat l="Missing Reports Today" v={dash.missingReports} red />
          <Stat l="Reports Awaiting Review" v={dash.awaitingReview} />
          <Stat l="Reports Submitted Today" v={dash.totalSubmitted} />
          <Stat l="No-Violation Declarations" v={dash.noViolationDeclarations} />
          <Stat l="Violations Reported" v={dash.violationReports} red={dash.violationReports > 0} />
          <Stat l="Exemptions Today" v={dash.exemptedToday} />
        </div>
      )}

      {/* Controls & Actions */}
      <div className="filters" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="Search driver or flag ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: "#fff", minWidth: 220 }}
          />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", background: "#fff" }}
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active Restrictions</option>
            <option value="RESOLVED">Resolved</option>
            <option value="OVERRIDDEN">Overridden</option>
          </select>
          <button className="tag" onClick={reloadAll} title="Refresh"><RefreshCw size={14} /></button>
        </div>
        <div>
          <button className="btn sm" style={{ background: "var(--navy)", width: "auto" }} onClick={() => setShowExemptModal(true)}>
            <PlusCircle size={14} style={{ marginRight: 6, verticalAlign: "middle" }} />
            Grant Exemption
          </button>
        </div>
      </div>

      {error && <div className="err">{error}</div>}
      {loading && !flagData && <div className="card empty">Loading compliance records…</div>}

      {/* Flags Table */}
      {flagData && (
        <div className="tbl tbl-compliance">
          <table>
            <thead>
              <tr>
                <th>Flag Reference</th>
                <th>Driver</th>
                <th>Employee ID</th>
                <th>Missed Date</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Created At</th>
                <th>Resolution Info</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flagData.flags.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>
                    No compliance flags found matching current filters.
                  </td>
                </tr>
              )}
              {flagData.flags.map(flag => (
                <tr key={flag.id} style={flag.status === "ACTIVE" ? { background: "#fef2f2" } : {}}>
                  <td><code style={{ fontWeight: 600 }}>{flag.flagReference}</code></td>
                  <td><b>{flag.driverName}</b><br /><small style={{ color: "var(--mute)" }}>{flag.driverLogin}</small></td>
                  <td>{flag.odooEmployeeId}</td>
                  <td><strong>{flag.reportingDate}</strong></td>
                  <td>
                    {flag.status === "ACTIVE" ? (
                      <span className="badge restricted"><ShieldAlert size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> Restricted</span>
                    ) : flag.status === "RESOLVED" ? (
                      <span className="badge submitted"><ShieldCheck size={12} style={{ verticalAlign: "middle", marginRight: 4 }} /> Resolved</span>
                    ) : (
                      <span className="badge" style={{ background: "#f3f4f6", color: "#374151" }}>{flag.status}</span>
                    )}
                  </td>
                  <td style={{ maxWidth: 220, fontSize: 13 }}>{flag.reason}</td>
                  <td style={{ fontSize: 12 }}>{fmtDateTime(flag.createdAt)}</td>
                  <td style={{ fontSize: 12 }}>
                    {flag.resolvedAt ? (
                      <div>
                        <span>By: {flag.resolvedBy ?? "SYSTEM"}</span><br />
                        <small style={{ color: "var(--mute)" }}>{flag.resolutionRemarks ?? flag.resolutionReason ?? ""}</small>
                      </div>
                    ) : (
                      <span style={{ color: "var(--mute)" }}>—</span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {flag.status === "ACTIVE" && (
                        <button
                          className="tag r"
                          style={{ cursor: "pointer", fontWeight: 600 }}
                          onClick={() => { setSelectedFlag(flag); setActionErr(null); }}
                        >
                          Remove Restriction
                        </button>
                      )}
                      <a
                        href={`/admin/compliance/drivers/${flag.driverUserId}`}
                        style={{ fontSize: 12, color: "var(--navy)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <Eye size={12} /> Profile
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Remove Restriction Confirmation Modal */}
      {selectedFlag && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 9999, padding: 16 }}>
          <div className="card" style={{ maxWidth: 500, width: "100%", background: "#fff", position: "relative" }}>
            <button
              onClick={() => setSelectedFlag(null)}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer" }}
            >
              <X size={20} />
            </button>
            <h2 style={{ margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
              <AlertTriangle color="var(--orange)" size={20} /> Remove Check-In Restriction
            </h2>
            <p style={{ fontSize: 14, color: "var(--mute)", margin: "0 0 14px" }}>
              Driver: <strong>{selectedFlag.driverName}</strong> ({selectedFlag.driverLogin})<br />
              Missed Reporting Date: <strong>{selectedFlag.reportingDate}</strong><br />
              Flag Reference: <code>{selectedFlag.flagReference}</code>
            </p>

            {actionErr && <div className="err">{actionErr}</div>}

            <form onSubmit={handleResolve}>
              <div className="field">
                <label>Resolution Reason <span style={{ color: "var(--red)" }}>*</span></label>
                <select value={resolveReason} onChange={e => setResolveReason(e.target.value)} required>
                  {RESOLUTION_REASONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label>Administrative Explanation / Remarks <span style={{ color: "var(--red)" }}>*</span></label>
                <textarea
                  value={resolveRemarks}
                  onChange={e => setResolveRemarks(e.target.value)}
                  placeholder="Explain why this restriction is being removed (recorded in audit log)…"
                  required
                  rows={3}
                />
              </div>

              <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, fontSize: 14, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isOverride}
                  onChange={e => setIsOverride(e.target.checked)}
                />
                <span>Mark as an administrative override (rather than normal resolution)</span>
              </label>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button type="button" className="btn sm" style={{ background: "var(--line)", color: "var(--ink)", width: "auto" }} onClick={() => setSelectedFlag(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn sm green" style={{ width: "auto" }} disabled={submitting}>
                  {submitting ? "Processing…" : "Confirm & Restore Check-In"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grant Exemption Modal */}
      {showExemptModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 9999, padding: 16 }}>
          <div className="card" style={{ maxWidth: 460, width: "100%", background: "#fff", position: "relative" }}>
            <button
              onClick={() => setShowExemptModal(false)}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer" }}
            >
              <X size={20} />
            </button>
            <h2 style={{ margin: "0 0 12px" }}>Grant Reporting Exemption</h2>
            <p style={{ fontSize: 13, color: "var(--mute)", margin: "0 0 14px" }}>
              Exempt a driver from the daily violation report requirement for a specific date (e.g. approved leave, medical, official rest day).
            </p>

            {actionErr && <div className="err">{actionErr}</div>}

            <form onSubmit={handleGrantExemption}>
              <div className="field">
                <label>Driver User ID or Login ID <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  type="text"
                  placeholder="e.g. drv006 or user ID"
                  value={exemptDriverId}
                  onChange={e => setExemptDriverId(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Exemption Date <span style={{ color: "var(--red)" }}>*</span></label>
                <input
                  type="date"
                  value={exemptDate}
                  onChange={e => setExemptDate(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label>Reason for Exemption <span style={{ color: "var(--red)" }}>*</span></label>
                <textarea
                  value={exemptReason}
                  onChange={e => setExemptReason(e.target.value)}
                  placeholder="e.g. Approved annual leave / Scheduled vehicle maintenance day"
                  required
                  rows={2}
                />
              </div>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}>
                <button type="button" className="btn sm" style={{ background: "var(--line)", color: "var(--ink)", width: "auto" }} onClick={() => setShowExemptModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn sm" style={{ background: "var(--navy)", width: "auto" }} disabled={submitting}>
                  {submitting ? "Saving…" : "Save Exemption"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

