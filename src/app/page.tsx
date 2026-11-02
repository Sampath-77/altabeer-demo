"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Globe, CheckCircle2, Camera, AlertTriangle, FileText, ClipboardList, AlertCircle, LogOut } from "lucide-react";
import Nav from "@/components/Nav";
import ShiftToggle from "@/components/ShiftToggle";
import { useApi, fmtTime, fmtDuration, api } from "@/lib/client";

type NA = { available: false; reason: string };
interface ComplianceFlag { id: string; flagReference: string; reportingDate: string; reason: string }
interface Dash {
  driver: { name: string; role: string | null } | null;
  shift: { open: boolean; shift?: { checkIn: string; durationMinutes: number }; staleWarning?: string } | null;
  month: { daysWorked: number; hoursLogged: number } | null;
  assignment: { plate: string; model: string | null } | null;
  earnings: NA; fuel: NA | { available: true; total: number }; parking: NA | { available: true; total: number }; fines: NA; unreadNotifications: number; partial: boolean;
  compliance: {
    restricted: boolean;
    activeFlag: ComplianceFlag | null;
    todayReportSubmitted: boolean;
    todayReportReference: string | null;
    todayReportType: "VIOLATION" | "NO_VIOLATION" | null;
  } | null;
}
const initials = (n: string) => n.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase();
const fmtDubaiDate = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", year: "numeric" }).format(new Date(d + "T00:00:00+04:00"));

export default function Home() {
  const { data, error, loading, reload } = useApi<Dash>("/api/driver/dashboard");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);
  const hr = now ? Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(now)) : 12;
  const greet = hr < 12 ? "Good Morning" : hr < 18 ? "Good Afternoon" : "Good Evening";
  const date = now ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", weekday: "long", day: "numeric", month: "short", year: "numeric" }).format(now) : "";
  const open = data?.shift?.open ?? false;
  const first = data?.driver?.name ?? "";
  const compliance = data?.compliance ?? null;
  const restricted = compliance?.restricted ?? false;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.href = "/login";
  }

  return (
    <div className="app">
      <header className="hdr">
        <div className="top">
          <div className="avatar" aria-hidden>{first ? initials(first) : "…"}</div>
          <div className="who"><small>{date}</small><strong>{greet}{first ? `, ${first}` : ""}</strong></div>
          <button className="pill" aria-label="Language: English"><Globe size={14} /> EN</button>
          <Link href="/notifications" className="icon-btn" aria-label={`Notifications${data?.unreadNotifications ? `, ${data.unreadNotifications} unread` : ""}`} style={{ position: "relative" }}><Bell size={20} />{!!data?.unreadNotifications && <span style={{ position: "absolute", top: 6, right: 6, width: 10, height: 10, borderRadius: 5, background: "var(--orange)" }} />}</Link>
          <button onClick={logout} className="icon-btn" aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
        </div>
        <div className="shiftbar">
          <div>
            <b>{!data?.shift ? "Shift status unavailable" : open ? "Shift Active" : "No Active Shift"}</b>
            <small>{open && data?.shift?.shift ? `Since ${fmtTime(data.shift.shift.checkIn)} · ${fmtDuration(data.shift.shift.durationMinutes)}` : restricted ? "Check-in restricted — submit pending report" : "Tap Check In to start your day"}</small>
          </div>
          {data?.shift && (
            restricted
              ? <button className="btn sm red" disabled title="Submit your pending daily report to unlock check-in">Restricted</button>
              : <ShiftToggle compact open={open} onDone={reload} onError={setActionErr} />
          )}
        </div>
      </header>
      <main>
        {(error || actionErr) && <div className="err" role="alert">{actionErr ?? error}</div>}
        {data?.partial && <div className="warn">Some ERP data could not be loaded. Figures shown may be incomplete.</div>}
        {data?.shift?.staleWarning && <div className="warn">{data.shift.staleWarning}</div>}

        {/* ── Compliance Restriction Banner ── */}
        {restricted && compliance?.activeFlag && (
          <div className="alert-restrict" role="alert">
            <h3><AlertCircle size={16} /> Daily Report Pending</h3>
            <p>You have not submitted your daily violation report for <strong>{fmtDubaiDate(compliance.activeFlag.reportingDate)}</strong>. Your shift check-in is temporarily restricted until this is resolved.</p>
            <p style={{ fontSize: 12, marginTop: 6, color: "#991b1b" }}>Ref: {compliance.activeFlag.flagReference}</p>
            <div className="ar-actions">
              <Link href={`/daily-report?date=${compliance.activeFlag.reportingDate}`} className="btn sm" style={{ background: "var(--orange)" }}>
                Submit Pending Report
              </Link>
              <Link href="/notifications" className="btn sm outline-red">Contact Operations</Link>
            </div>
          </div>
        )}

        {/* ── Today's Report Submitted Confirmation ── */}
        {!restricted && compliance?.todayReportSubmitted && (
          <div className="alert-ok">
            <CheckCircle2 size={16} />
            <span>Today&apos;s report submitted ({compliance.todayReportType === "NO_VIOLATION" ? "No violations" : "Violation reported"}) · {compliance.todayReportReference}</span>
          </div>
        )}

        <section className="earn" aria-label="Earnings">
          <div className="muted">This Month&apos;s Earnings (Est.)</div>
          <div className="big">Not available</div>
          <div className="muted">{data?.month ? `${data.month.daysWorked} days worked · ${data.month.hoursLogged} hours logged` : loading ? "Loading…" : "Shift totals unavailable"}</div>
          <div className="tiles">
            {([ ["Fuel", data?.fuel], ["Parking", data?.parking], ["Fines", data?.fines]] as const).map(([l, v]) => (
              <div className="tile" key={l} title={v && !v.available ? v.reason : undefined}><b>{v?.available ? `AED ${(v as { total: number }).total.toFixed(0)}` : "—"}</b><small>{l}</small></div>
            ))}
          </div>
        </section>
        <h2>Quick Actions</h2>
        <div className="qa">
          <Link href="/shifts"><i style={{ background: "#dcfce7", color: "#16a34a" }}><CheckCircle2 size={22} /></i>{open ? "Check Out" : "Check In"}</Link>
          <Link href="/expenses"><i style={{ background: "#ffedd5", color: "#ea580c" }}><Camera size={22} /></i>Upload Receipt</Link>
          <Link href="/fines"><i style={{ background: "#fee2e2", color: "#dc2626" }}><AlertTriangle size={22} /></i>View Fines</Link>
          <Link href="/payslip"><i style={{ background: "#dbeafe", color: "#2563eb" }}><FileText size={22} /></i>My Payslip</Link>
          <Link href="/daily-report" style={{ position: "relative" }}>
            <i style={{ background: restricted ? "#fee2e2" : "#f5f3ff", color: restricted ? "#dc2626" : "#7c3aed" }}>
              <ClipboardList size={22} />
            </i>
            Daily Report
            {restricted && <span style={{ position: "absolute", top: 4, right: 4, width: 10, height: 10, borderRadius: 5, background: "var(--red)" }} />}
          </Link>
        </div>
        <h2>Your Assignment</h2>
        <div className="card row">
          <div><small>Role</small><b>{data?.driver?.role ?? "—"}</b></div>
          <div style={{ textAlign: "right" }}><small>Vehicle</small><b>{data?.assignment ? `${data.assignment.model ? data.assignment.model + " · " : ""}${data.assignment.plate}` : "No vehicle assigned"}</b></div>
        </div>
        <p className="foot">Data from the Al Tabeer ERP</p>
      </main>
      <Nav />
    </div>
  );
}
