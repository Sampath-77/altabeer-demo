"use client";
import { useState } from "react";
import { Download, RefreshCw, Eye, CheckCircle2, AlertTriangle, Clock, MinusCircle } from "lucide-react";
import AdminShell from "@/components/AdminShell";
import { useApi, fmtDateTime } from "@/lib/client";

function dubaiToday() {
  return new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
}
function dubaiYesterday() {
  return new Date(Date.now() + 4 * 3600_000 - 86400_000).toISOString().slice(0, 10);
}

interface Summary {
  totalExpected: number; totalSubmitted: number; violationCount: number;
  noViolationCount: number; pendingCount: number; missingCount: number;
  exemptedCount: number; awaitingReviewCount: number; restrictedCount: number;
}

interface Report {
  id: string; reportReference: string; reportType: string; violationCategory: string | null;
  submissionStatus: string; submittedAt: string; submittedLate: boolean; adminRemarks: string | null;
}

interface Row {
  driverUserId: string; odooEmployeeId: number; driverName: string;
  vehiclePlate: string | null; vehicleModel: string | null; vendorName: string | null;
  reportingDate: string; rowStatus: "SUBMITTED" | "PENDING" | "MISSING" | "EXEMPTED";
  report: Report | null; attachmentCount: number;
  flagStatus: string | null; exemption: { reason: string } | null;
}

interface DailyReportsData {
  reportingDate: string; summary: Summary; rows: Row[]; generatedAt: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  SUBMITTED: { label: "Submitted", cls: "submitted" },
  PENDING: { label: "Pending", cls: "pending" },
  MISSING: { label: "Missing", cls: "missing" },
  EXEMPTED: { label: "Exempted", cls: "exempted" },
};
const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  VIOLATION: { label: "Violation", cls: "violation" },
  NO_VIOLATION: { label: "No Violation", cls: "noviolation" },
};

const Stat = ({ l, v, sub, red }: { l: string; v: number; sub?: string; red?: boolean }) => (
  <div className={`stat ${red && v > 0 ? "navy" : ""}`} style={red && v > 0 ? { background: "#991b1b" } : {}}>
    <small>{l}</small><b>{v}</b>{sub && <em>{sub}</em>}
  </div>
);

export default function DailyReportsPage() {
  const today = dubaiToday();
  const yesterday = dubaiYesterday();
  const [date, setDate] = useState(today);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const qs = new URLSearchParams({ date, ...(search && { search }), ...(statusFilter && { status: statusFilter }), ...(typeFilter && { reportType: typeFilter }) }).toString();
  const { data, loading, error, reload } = useApi<DailyReportsData>(`/api/admin/daily-reports?${qs}`);

  const exportCsv = () => { window.open(`/api/admin/daily-reports/export?date=${date}&format=csv`, "_blank"); };

  return (
    <AdminShell
      title="Daily Driver Reports"
      sub={data ? `${data.reportingDate} · Generated ${fmtDateTime(data.generatedAt)} · ${data.summary.totalSubmitted}/${data.summary.totalExpected} submitted` : "Loading…"}
    >
      {/* Date Selector */}
      <div className="filters" style={{ marginBottom: 16, alignItems: "center" }}>
        <button className={`tag ${date === today ? "g" : ""}`} onClick={() => setDate(today)}>Today</button>
        <button className={`tag ${date === yesterday ? "g" : ""}`} onClick={() => setDate(yesterday)}>Yesterday</button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} max={today}
          style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "8px 12px", font: "inherit", background: "#fff" }} />
        <button className="tag" onClick={reload} title="Refresh"><RefreshCw size={14} /></button>
        <button className="tag g" onClick={exportCsv} title="Export CSV"><Download size={14} /> CSV</button>
      </div>

      {/* KPI Cards */}
      {data && (
        <div className="cards" style={{ marginBottom: 20 }}>
          <Stat l="Expected to report" v={data.summary.totalExpected} />
          <Stat l="Reports submitted" v={data.summary.totalSubmitted} sub={`${data.summary.totalExpected > 0 ? Math.round(100 * data.summary.totalSubmitted / data.summary.totalExpected) : 0}%`} />
          <Stat l="Violation reports" v={data.summary.violationCount} red />
          <Stat l="No-violation declarations" v={data.summary.noViolationCount} />
          <Stat l="Pending" v={data.summary.pendingCount} />
          <Stat l="Missing (deadline passed)" v={data.summary.missingCount} red />
          <Stat l="Exempted" v={data.summary.exemptedCount} />
          <Stat l="Awaiting review" v={data.summary.awaitingReviewCount} />
          <Stat l="Drivers restricted" v={data.summary.restrictedCount} red />
        </div>
      )}

      {/* Filters */}
      <div className="filters">
        <input placeholder="Search driver, vehicle…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", font: "inherit", background: "#fff", minWidth: 200 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", font: "inherit", background: "#fff" }}>
          <option value="">All statuses</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="PENDING">Pending</option>
          <option value="MISSING">Missing</option>
          <option value="EXEMPTED">Exempted</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ border: "1px solid var(--line)", borderRadius: 12, padding: "10px 12px", font: "inherit", background: "#fff" }}>
          <option value="">All types</option>
          <option value="VIOLATION">Violation</option>
          <option value="NO_VIOLATION">No Violation</option>
        </select>
      </div>

      {/* Error / Loading */}
      {error && <div className="err">{error}</div>}
      {loading && !data && <div className="card empty">Loading report data…</div>}

      {/* Main table */}
      {data && (
        <div className="tbl tbl-compliance">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Emp. ID</th>
                <th>Vehicle</th>
                <th>Vendor</th>
                <th>Reporting Date</th>
                <th>Report Type</th>
                <th>Status</th>
                <th>Category</th>
                <th>Submitted At</th>
                <th>Evidence</th>
                <th>Compliance</th>
                <th>Check-In</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={13} style={{ textAlign: "center", color: "var(--mute)", padding: 24 }}>No records found for the selected filters.</td></tr>
              )}
              {data.rows.map(row => {
                const sb = STATUS_BADGE[row.rowStatus];
                const tb = row.report ? TYPE_BADGE[row.report.reportType] : null;
                const isRestricted = row.flagStatus === "ACTIVE";
                return (
                  <tr key={row.driverUserId} style={row.rowStatus === "MISSING" ? { background: "#fef2f2" } : row.rowStatus === "PENDING" ? { background: "#fffbeb" } : {}}>
                    <td><b style={{ fontSize: 13 }}>{row.driverName}</b></td>
                    <td style={{ color: "var(--mute)", fontSize: 12 }}>{row.odooEmployeeId}</td>
                    <td>
                      {row.vehiclePlate ? <><b style={{ fontSize: 13 }}>{row.vehiclePlate}</b><br /><small style={{ color: "var(--mute)" }}>{row.vehicleModel ?? ""}</small></> : <span style={{ color: "var(--mute)" }}>—</span>}
                    </td>
                    <td style={{ fontSize: 13 }}>{row.vendorName ?? "—"}</td>
                    <td style={{ fontSize: 13 }}>{row.reportingDate}</td>
                    <td>{tb ? <span className={`badge ${tb.cls}`}>{tb.label}</span> : <span style={{ color: "var(--mute)" }}>—</span>}</td>
                    <td>
                      <span className={`badge ${sb.cls}`}>{sb.label}</span>
                      {row.report?.submittedLate && <span className="badge" style={{ background: "#fffbeb", color: "#92400e", marginLeft: 4 }}>Late</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>{row.report?.violationCategory?.replace(/_/g, " ") ?? "—"}</td>
                    <td style={{ fontSize: 12 }}>{row.report ? fmtDateTime(row.report.submittedAt) : "—"}</td>
                    <td style={{ textAlign: "center" }}>
                      {row.attachmentCount > 0
                        ? <span className="tag g" style={{ cursor: "pointer" }}>{row.attachmentCount} file{row.attachmentCount > 1 ? "s" : ""}</span>
                        : <span style={{ color: "var(--mute)" }}>—</span>
                      }
                    </td>
                    <td>
                      {row.rowStatus === "EXEMPTED"
                        ? <span className="badge exempted">Exempted</span>
                        : row.rowStatus === "SUBMITTED"
                          ? <span className="badge submitted"><CheckCircle2 size={10} style={{ verticalAlign: "middle" }} /> Compliant</span>
                          : row.rowStatus === "MISSING"
                            ? <span className="badge missing"><AlertTriangle size={10} style={{ verticalAlign: "middle" }} /> Non-Compliant</span>
                            : <span className="badge pending"><Clock size={10} style={{ verticalAlign: "middle" }} /> Pending</span>
                      }
                    </td>
                    <td>
                      {isRestricted
                        ? <span className="badge restricted">Restricted</span>
                        : <span className="badge allowed">Allowed</span>
                      }
                    </td>
                    <td>
                      <a href={`/admin/compliance/drivers/${row.driverUserId}`}
                        style={{ fontSize: 12, color: "var(--navy)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Eye size={12} /> View
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="foot" style={{ marginTop: 16 }}>All report data is sourced from the Al Tabeer compliance database. Times shown in Asia/Dubai timezone.</p>
    </AdminShell>
  );
}

