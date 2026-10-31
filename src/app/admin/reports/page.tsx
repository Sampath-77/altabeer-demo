"use client";
import { useState } from "react";
import AdminShell from "@/components/AdminShell";
import { useApi } from "@/lib/client";

interface T { title: string; columns: { key: string; label: string }[]; rows: Record<string, string | number | null>[]; summary?: Record<string, string | number | null>; note?: string; generatedAt: string }
const TYPES: [string, string][] = [["daily", "Daily fine report"], ["vendor", "Vendor-wise totals"], ["vehicle", "Vehicle-wise totals"], ["driver", "Driver-wise history"], ["overdue", "Overdue fines"], ["resolution", "Resolution time"], ["unmatched", "Unmatched vehicles"], ["duplicates", "Possible duplicates"], ["ocr", "OCR review statistics"], ["notifications", "Notification failures"], ["sync", "ERP sync failures"]];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
const LABEL: Record<string, string> = { recordedCount: "Fines recorded", recordedAmount: "Amount recorded (AED)", vehiclesAffected: "Vehicles affected", distinctDrivers: "Drivers", distinctVendors: "Vendors", newUnresolved: "New unresolved", overdueNow: "Overdue now", needingManualReview: "Needing manual review", closedFines: "Closed fines", averageDays: "Average days", medianDays: "Median days" };

export default function Reports() {
  const [type, setType] = useState("daily"); const [date, setDate] = useState(today()); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const q = new URLSearchParams({ type, ...(type === "daily" && { date }), ...(from && !["daily", "ocr", "notifications", "sync"].includes(type) && { from }), ...(to && !["daily", "ocr", "notifications", "sync"].includes(type) && { to }) });
  const { data, error, loading } = useApi<T>(`/api/admin/reports/fines?${q}`);
  const ranged = !["daily", "ocr", "notifications", "sync", "overdue"].includes(type);
  return (
    <AdminShell title="Reports" sub="Dates and day boundaries are in Dubai time. Amounts are in AED.">
      <div className="filters">
        <select aria-label="Report" value={type} onChange={e => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {type === "daily" && <input type="date" aria-label="Day" value={date} max={today()} onChange={e => setDate(e.target.value)} />}
        {ranged && <><input type="date" aria-label="From (date received)" value={from} onChange={e => setFrom(e.target.value)} /><input type="date" aria-label="To (date received)" value={to} onChange={e => setTo(e.target.value)} /></>}
        <a className="btn sm" style={{ display: "inline-block", textAlign: "center" }} href={`/api/admin/reports/fines?${q}&format=csv`}>Download CSV</a>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {loading && !data && <div className="card empty">Loading…</div>}
      {data && <>
        <h2 style={{ marginTop: 0 }}>{data.title}</h2>
        {data.note && <div className="warn">{data.note}</div>}
        {data.summary && <div className="cards">{Object.entries(data.summary).map(([k, v]) => <div className="stat" key={k}><small>{LABEL[k] ?? k}</small><b>{v ?? "—"}</b></div>)}</div>}
        <div className="tbl"><table><thead><tr>{data.columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>
          {data.rows.length === 0 && <tr><td colSpan={data.columns.length}>Nothing to report for this selection.</td></tr>}
          {data.rows.map((r, i) => <tr key={i}>{data.columns.map(c => <td key={c.key}>{r[c.key] ?? "—"}</td>)}</tr>)}
        </tbody></table></div>
      </>}
    </AdminShell>
  );
}
