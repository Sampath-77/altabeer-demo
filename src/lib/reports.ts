import type { FineRec } from "./fines/pipeline";
import { outstanding, total, UNRESOLVED, DAY } from "./fines/workflow";

export interface Column { key: string; label: string }
export type Cell = string | number | null;
export interface Table { title: string; columns: Column[]; rows: Record<string, Cell>[]; summary?: Record<string, Cell>; note?: string }
export interface Names { vendor(id: number | null): string; vehicle(id: number | null): string; driver(id: number | null): string }

export const dubaiDay = (t: number | Date) => new Date((typeof t === "number" ? t : t.getTime()) + 4 * 3600_000).toISOString().slice(0, 10);
export const dubaiDayRange = (day: string) => ({ from: new Date(`${day}T00:00:00+04:00`), to: new Date(`${day}T23:59:59.999+04:00`) });
const money = (n: number) => Math.round(n * 100) / 100;
const real = (f: FineRec) => !["REVIEW_REQUIRED", "REJECTED"].includes(f.workflow);       // confirmed fines only for money reports
const verifiedDeadline = (f: FineRec) => (f.deadline && f.deadlineSource ? f.deadline.getTime() : null);
const isOverdue = (f: FineRec, now: number) => UNRESOLVED.includes(f.workflow) && (verifiedDeadline(f) ?? Infinity) < now;
const ts = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const cols = (...c: [string, string][]): Column[] => c.map(([key, label]) => ({ key, label }));
const FINE_COLS = cols(["reference", "Fine reference"], ["violation", "Violation (UTC)"], ["received", "Received (UTC)"], ["plate", "Vehicle"], ["driver", "Driver at violation time"], ["vendor", "Vendor"], ["amount", "Fine amount (AED)"], ["penalty", "Additional penalty (AED)"], ["paid", "Verified paid (AED)"], ["outstanding", "Outstanding (AED)"], ["deadline", "Verified deadline (UTC)"], ["status", "Status"]);
const fineRow = (f: FineRec, n: Names): Record<string, Cell> => ({ reference: f.fineReference, violation: ts(f.violationAt), received: ts(f.noticeReceivedAt), plate: n.vehicle(f.vehicleOdooId) || f.plateRaw, driver: n.driver(f.driverOdooId), vendor: n.vendor(f.vendorOdooId), amount: f.amount, penalty: f.additionalPenalty ?? 0, paid: f.amountPaid ?? 0, outstanding: real(f) ? outstanding(f) : null, deadline: f.deadline && f.deadlineSource ? ts(f.deadline) : null, status: f.workflow.toLowerCase().replace(/_/g, " ") });

/** "Recorded" means entered into the app that day, which is not the violation date. */
export function dailyReport(rows: FineRec[], day: string, now: number, n: Names): Table {
  const today = rows.filter(f => f.workflow !== "REJECTED" && f.noticeReceivedAt && dubaiDay(f.noticeReceivedAt) === day);
  const open = rows.filter(f => UNRESOLVED.includes(f.workflow));
  return { title: `Daily fine report, ${day} (Dubai)`, columns: FINE_COLS, rows: today.map(f => fineRow(f, n)),
    summary: { recordedCount: today.length, recordedAmount: money(today.reduce((s, f) => s + (f.amount ?? 0), 0)), vehiclesAffected: new Set(today.map(f => f.vehicleOdooId).filter(Boolean)).size,
      distinctDrivers: new Set(today.map(f => f.driverOdooId).filter(Boolean)).size, distinctVendors: new Set(today.map(f => f.vendorOdooId).filter(Boolean)).size,
      newUnresolved: today.filter(f => UNRESOLVED.includes(f.workflow)).length, overdueNow: open.filter(f => isOverdue(f, now)).length, needingManualReview: rows.filter(f => f.workflow === "REVIEW_REQUIRED").length } };
}
function grouped(rows: FineRec[], key: (f: FineRec) => number | null, label: (id: number | null) => string, title: string, now: number, head: string): Table {
  const g = new Map<number | null, FineRec[]>(); for (const f of rows.filter(real)) g.set(key(f), [...(g.get(key(f)) ?? []), f]);   // each fine lands in exactly one group
  return { title, columns: cols(["name", head], ["count", "Fines"], ["amount", "Fine amount (AED)"], ["penalty", "Additional penalties (AED)"], ["paid", "Verified paid (AED)"], ["outstanding", "Outstanding (AED)"], ["overdue", "Overdue"]),
    rows: [...g].map(([id, fs]) => ({ name: id == null ? "Not resolved" : label(id), count: fs.length, amount: money(fs.reduce((s, f) => s + (f.amount ?? 0), 0)), penalty: money(fs.reduce((s, f) => s + (f.additionalPenalty ?? 0), 0)), paid: money(fs.reduce((s, f) => s + (f.amountPaid ?? 0), 0)),
      outstanding: money(fs.filter(f => UNRESOLVED.includes(f.workflow)).reduce((s, f) => s + outstanding(f), 0)), overdue: fs.filter(f => isOverdue(f, now)).length })).sort((a, b) => Number(b.outstanding) - Number(a.outstanding)) };
}
export const vendorReport = (rows: FineRec[], now: number, n: Names) => grouped(rows, f => f.vendorOdooId, n.vendor, "Vendor-wise fines", now, "Vendor");
export const vehicleReport = (rows: FineRec[], now: number, n: Names) => grouped(rows, f => f.vehicleOdooId, n.vehicle, "Vehicle-wise fines", now, "Vehicle");
export const driverReport = (rows: FineRec[], n: Names): Table => ({ title: "Driver-wise fine history (driver assigned at violation time)", columns: FINE_COLS, rows: rows.filter(real).sort((a, b) => (n.driver(a.driverOdooId) ?? "").localeCompare(n.driver(b.driverOdooId) ?? "") || (b.violationAt?.getTime() ?? 0) - (a.violationAt?.getTime() ?? 0)).map(f => fineRow(f, n)), note: "Fines are attributed to the historical assignment, not the current driver. This is a record of assignment, not a finding of responsibility." });
export const overdueReport = (rows: FineRec[], now: number, n: Names): Table => ({ title: "Overdue fines (verified deadline passed)", columns: [...cols(["daysOverdue", "Days overdue"], ["escalation", "Escalation level"]), ...FINE_COLS],
  rows: rows.filter(f => isOverdue(f, now)).sort((a, b) => verifiedDeadline(a)! - verifiedDeadline(b)!).map(f => ({ daysOverdue: Math.floor((now - verifiedDeadline(f)!) / DAY), escalation: f.escalationLevel ?? 0, ...fineRow(f, n) })), note: "Fines without a verified deadline cannot be called overdue and are excluded." });
export function resolutionReport(rows: FineRec[], n: Names): Table {
  const done = rows.filter(f => f.workflow === "CLOSED" && f.closedAt && f.noticeReceivedAt);
  const days = done.map(f => (f.closedAt!.getTime() - f.noticeReceivedAt!.getTime()) / DAY).sort((a, b) => a - b);
  const med = days.length ? (days.length % 2 ? days[(days.length - 1) / 2] : (days[days.length / 2 - 1] + days[days.length / 2]) / 2) : null;
  return { title: "Fine resolution time (received to closed)", columns: [...cols(["days", "Days to close"], ["closedReason", "Closed reason"]), ...FINE_COLS.slice(0, 7)],
    rows: done.map(f => ({ days: Math.round(((f.closedAt!.getTime() - f.noticeReceivedAt!.getTime()) / DAY) * 10) / 10, closedReason: f.closedReason ?? null, ...fineRow(f, n) })),
    summary: { closedFines: done.length, averageDays: days.length ? Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10 : null, medianDays: med == null ? null : Math.round(med * 10) / 10 } };
}
export const unmatchedReport = (rows: FineRec[], n: Names): Table => ({ title: "Fines without a confirmed vehicle or driver match", columns: [...cols(["match", "Match status"], ["reasons", "Review flags"], ["plateRaw", "Plate as printed"]), ...FINE_COLS.slice(0, 3)],
  rows: rows.filter(f => f.workflow !== "REJECTED" && (f.matchStatus !== "MATCHED" || !f.vehicleOdooId)).map(f => ({ match: f.matchStatus.toLowerCase().replace(/_/g, " "), reasons: f.reviewReasons.join(", "), plateRaw: f.plateRaw, ...fineRow(f, n) })) });
export const duplicatesReport = (rows: FineRec[], n: Names): Table => ({ title: "Possible duplicate fines", columns: [...cols(["duplicateOf", "Possible duplicate of (record ID)"], ["reasons", "Review flags"]), ...FINE_COLS.slice(0, 3)], rows: rows.filter(f => f.duplicateOfId).map(f => ({ duplicateOf: f.duplicateOfId, reasons: f.reviewReasons.join(", "), ...fineRow(f, n) })) });
export const notificationFailures = (logs: { createdAt: Date; channel: string; recipient: string; status: string; attempts: number; fineId: string | null }[]): Table => ({ title: "Failed notifications", columns: cols(["when", "When (UTC)"], ["channel", "Channel"], ["recipient", "Recipient"], ["status", "Status"], ["attempts", "Attempts"], ["fine", "Fine record"]), rows: logs.map(l => ({ when: l.createdAt.toISOString(), channel: l.channel, recipient: l.recipient, status: l.status.toLowerCase(), attempts: l.attempts, fine: l.fineId })) });
export const syncFailures = (ops: { updatedAt: Date; operation: string; status: string; attempts: number; lastError: string | null }[]): Table => ({ title: "ERP synchronisation failures", columns: cols(["when", "Last attempt (UTC)"], ["operation", "Operation"], ["status", "Status"], ["attempts", "Attempts"], ["error", "Error"]), rows: ops.map(o => ({ when: o.updatedAt.toISOString(), operation: o.operation, status: o.status === "DEAD" ? "needs attention" : "retrying", attempts: o.attempts, error: o.lastError })) });
/** Correction rate = fines an admin edited at least once / fines OCR processed. It measures how often OCR needed fixing, not field-level accuracy. */
export const ocrReport = (s: { processed: number; failed: number; corrected: number }): Table => ({ title: "OCR review statistics", columns: cols(["metric", "Metric"], ["value", "Value"]), rows: [{ metric: "Notices processed", value: s.processed }, { metric: "OCR failures", value: s.failed }, { metric: "Fines corrected by an admin", value: s.corrected }, { metric: "Correction rate", value: s.processed ? `${Math.round((s.corrected / s.processed) * 1000) / 10}%` : null }], note: "Field-level accuracy is not measured. Provider confidence is shown on each fine when the provider reports it." });

/** RFC 4180 CSV with a UTF-8 BOM for Excel, and neutralisation of spreadsheet formula injection. */
export function toCsv(t: Table): string {
  const esc = (v: Cell) => { if (v === null || v === undefined) return ""; let s = String(v); if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [t.columns.map(c => esc(c.label)).join(","), ...t.rows.map(r => t.columns.map(c => esc(r[c.key] ?? null)).join(","))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
