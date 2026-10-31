import type { OdooClient } from "../odoo/types";
import type { Storage } from "../storage";
import type { FineRec, FineRepo } from "./pipeline";
import { approve } from "./pipeline";
import { composeVendorEmail, type EmailProvider } from "./notify";
import { AuthError } from "../auth/service";

export const DAY = 86400_000;
export const REMINDER_DAYS = (process.env.REMINDER_DAYS ?? "7,3,1").split(",").map(Number).filter(n => n > 0).sort((a, b) => a - b);
export const ESCALATE_L2_DAYS = Number(process.env.ESCALATE_L2_DAYS ?? 3);
export const UNRESOLVED = ["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "DISPUTED", "UNDER_REVIEW"];

export interface WfRepo extends FineRepo {
  driverUserId(employeeId: number): Promise<string | null>;
  adminUserIds(): Promise<string[]>;
  addNotification(userId: string, n: { type: string; title: string; body: string; fineId: string; dedupeKey: string }): Promise<void>;
  claimLog(l: { dedupeKey: string; fineId: string; channel: string; recipient: string; templateRef: string }): Promise<{ id: string } | null>;
  finishLog(id: string, r: { status: string; providerRef?: string; response?: unknown }): Promise<void>;
  dueFines(): Promise<FineRec[]>;
}
export interface WfDeps { odoo: OdooClient; repo: WfRepo; storage: Storage; email?: () => EmailProvider; now?: () => number }
const nowOf = (d: { now?: () => number }) => d.now?.() ?? Date.now();

const ALLOWED: Record<string, string[]> = {
  REVIEW_REQUIRED: ["APPROVED", "REJECTED"], APPROVED: ["ACK_PENDING", "PAYMENT_PENDING"],
  ACK_PENDING: ["ACKNOWLEDGED", "DISPUTED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "CLOSED"],
  ACKNOWLEDGED: ["PAYMENT_PENDING", "DISPUTED", "CLOSED"], PAYMENT_PENDING: ["PAID_AWAITING_VERIFICATION", "DISPUTED", "CLOSED"],
  PAID_AWAITING_VERIFICATION: ["PAYMENT_PENDING", "CLOSED"], DISPUTED: ["PAYMENT_PENDING", "CLOSED"], CLOSED: ["PAYMENT_PENDING"],
};
export const total = (f: FineRec) => (f.amount ?? 0) + (f.additionalPenalty ?? 0);
export const outstanding = (f: FineRec) => Math.max(0, Math.round((total(f) - (f.amountPaid ?? 0)) * 100) / 100);

async function get(d: WfDeps, id: string) { const f = await d.repo.getFine(id); if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found."); return f; }
async function move(d: WfDeps, f: FineRec, to: string, actor: string | null, patch: Partial<FineRec> = {}, extra: Record<string, unknown> = {}) {
  if (!ALLOWED[f.workflow]?.includes(to)) throw new AuthError("CONFLICT", 409, `This fine cannot move from ${f.workflow.toLowerCase().replace(/_/g, " ")} to ${to.toLowerCase().replace(/_/g, " ")}.`);
  await d.repo.updateFine(f.id, { ...patch, workflow: to });
  await d.repo.audit({ actorId: actor, action: `fine.${to.toLowerCase()}`, entityId: f.id, before: { workflow: f.workflow }, after: { workflow: to, ...extra } });
  await d.repo.outbox({ idempotencyKey: `fine:${f.id}:status:${to}:${nowOf(d)}`, operation: "fine.status", payload: { fineId: f.id, workflow: to } });
  return { ...f, ...patch, workflow: to };
}
async function tellAdmins(d: WfDeps, f: FineRec, type: string, title: string, body: string, key: string) {
  for (const u of await d.repo.adminUserIds()) await d.repo.addNotification(u, { type, title, body, fineId: f.id, dedupeKey: `${key}:${u}` });
}
async function tellDriver(d: WfDeps, f: FineRec, type: string, title: string, body: string, key: string) {
  const u = f.driverOdooId ? await d.repo.driverUserId(f.driverOdooId) : null;
  if (u) await d.repo.addNotification(u, { type, title, body, fineId: f.id, dedupeKey: `${key}:${u}` });
}
const label = (f: FineRec) => `${f.fineReference ?? "fine"} (${f.plateRaw ?? "vehicle"})`;

/** Approve, then activate: notify the driver, alert admins, and move into the acknowledgement or payment stage. */
export async function approveAndActivate(d: WfDeps, id: string, actor: string, opts: { confirmNotDuplicate?: boolean } = {}) {
  await approve(d, id, actor, opts);
  const f = await get(d, id);
  const hasDriver = !!(f.driverOdooId && await d.repo.driverUserId(f.driverOdooId));
  const next = await move(d, f, hasDriver ? "ACK_PENDING" : "PAYMENT_PENDING", actor, {}, { reason: hasDriver ? "driver notified" : "no app account for the assigned driver" });
  await tellDriver(d, next, "fine_new", "A traffic fine was recorded", `A fine of AED ${total(f).toFixed(2)} for ${f.plateRaw} (violation ${f.violationAt?.toISOString().slice(0, 10)}) was recorded. Please open Fines to review it. Acknowledging only confirms you have seen it.`, `fine:${id}:new`);
  await tellAdmins(d, next, "fine_approved", "Fine approved", `${label(f)} approved${hasDriver ? "; driver notified" : "; no driver account to notify. Check assignment."}.`, `fine:${id}:approved`);
}
export async function ownFine(d: WfDeps, id: string, employeeId: number) {
  const f = await get(d, id);
  if (f.driverOdooId !== employeeId || f.workflow === "REVIEW_REQUIRED" || f.workflow === "REJECTED") throw new AuthError("NOT_FOUND", 404, "Fine not found.");
  return f;
}
export async function acknowledge(d: WfDeps, id: string, employeeId: number) {
  const f = await ownFine(d, id, employeeId);
  if (f.acknowledgedAt) return; // idempotent
  const a = await move(d, f, "ACKNOWLEDGED", `driver:${employeeId}`, { acknowledgedAt: new Date(nowOf(d)) });
  await move(d, a as FineRec, "PAYMENT_PENDING", null, {}, { reason: "acknowledged" });
  await tellAdmins(d, f, "fine_ack", "Fine acknowledged", `${label(f)} was acknowledged by the driver.`, `fine:${id}:ack`);
}
export async function dispute(d: WfDeps, id: string, employeeId: number, reason: string) {
  const f = await ownFine(d, id, employeeId);
  if (!reason.trim() || reason.length > 500) throw new AuthError("VALIDATION", 422, "Describe why you dispute this fine (up to 500 characters).");
  await move(d, f, "DISPUTED", `driver:${employeeId}`, { disputeReason: reason.trim() });
  await tellAdmins(d, f, "fine_disputed", "Fine disputed", `${label(f)} was disputed by the driver: ${reason.trim()}`, `fine:${id}:dispute:${nowOf(d)}`);
}
export async function submitPayment(d: WfDeps, id: string, by: { employeeId?: number; adminId?: string }, p: { amount: number; reference: string; evidenceKey?: string }) {
  const f = by.employeeId != null ? await ownFine(d, id, by.employeeId) : await get(d, id);
  if (!(p.amount > 0) || !Number.isFinite(p.amount)) throw new AuthError("VALIDATION", 422, "Enter the amount paid.");
  if (by.employeeId != null && f.workflow === "ACK_PENDING") throw new AuthError("CONFLICT", 409, "Acknowledge the fine before submitting payment.");
  if (by.employeeId != null && !p.evidenceKey) throw new AuthError("VALIDATION", 422, "Attach the payment receipt.");
  await move(d, f, "PAID_AWAITING_VERIFICATION", by.employeeId != null ? `driver:${by.employeeId}` : by.adminId!, { paymentClaimedAmount: p.amount, paymentReference: p.reference.trim() || null, paymentEvidenceKeys: [...(f.paymentEvidenceKeys ?? []), ...(p.evidenceKey ? [p.evidenceKey] : [])] }, { claimed: p.amount });
  await tellAdmins(d, f, "payment_submitted", "Payment awaiting verification", `${label(f)}: payment of AED ${p.amount.toFixed(2)} was reported. Verify it against the receipt.`, `fine:${id}:pay:${nowOf(d)}`);
}
export async function verifyPayment(d: WfDeps, id: string, admin: string, ok: boolean, reason = "") {
  const f = await get(d, id);
  if (f.workflow !== "PAID_AWAITING_VERIFICATION" || !f.paymentClaimedAmount) throw new AuthError("CONFLICT", 409, "There is no payment awaiting verification.");
  if (!ok) {
    if (!reason.trim()) throw new AuthError("VALIDATION", 422, "Give a reason for not accepting the payment.");
    await move(d, f, "PAYMENT_PENDING", admin, { paymentClaimedAmount: null }, { rejected: reason.trim() });
    return tellDriver(d, f, "payment_rejected", "Payment not accepted", `Your payment for ${label(f)} could not be verified: ${reason.trim()}`, `fine:${id}:payrej:${nowOf(d)}`);
  }
  const paid = Math.round(((f.amountPaid ?? 0) + f.paymentClaimedAmount) * 100) / 100;
  const full = paid >= total(f);
  await move(d, f, full ? "CLOSED" : "PAYMENT_PENDING", admin, { amountPaid: paid, paymentClaimedAmount: null, paymentVerifiedAt: new Date(nowOf(d)), ...(full ? { closedAt: new Date(nowOf(d)), closedReason: "paid in full, verified" } : {}) }, { verifiedAmount: f.paymentClaimedAmount, totalPaid: paid });
  await tellDriver(d, f, "payment_verified", full ? "Fine closed" : "Payment verified", full ? `${label(f)} is paid and closed.` : `A payment was verified for ${label(f)}. AED ${(total(f) - paid).toFixed(2)} is still outstanding.`, `fine:${id}:payok:${nowOf(d)}`);
}
export async function closeFine(d: WfDeps, id: string, admin: string, reason: string) {
  const f = await get(d, id);
  if (!reason.trim()) throw new AuthError("VALIDATION", 422, "Give a reason for closing this fine.");
  await move(d, f, "CLOSED", admin, { closedAt: new Date(nowOf(d)), closedReason: reason.trim() }, { reason: reason.trim(), outstanding: outstanding(f) });
}
export async function reopenFine(d: WfDeps, id: string, admin: string, reason: string) {
  const f = await get(d, id);
  if (!["CLOSED", "DISPUTED"].includes(f.workflow)) throw new AuthError("CONFLICT", 409, "Only closed or disputed fines can be reopened.");
  if (!reason.trim()) throw new AuthError("VALIDATION", 422, "Give a reason.");
  await move(d, f, "PAYMENT_PENDING", admin, { closedAt: null, closedReason: null, paymentVerifiedAt: null }, { reason: reason.trim() });
}

export async function vendorNotification(d: WfDeps, id: string, admin: string, o: { key: string; preview?: boolean }) {
  const f = await get(d, id);
  if (!f.vehicleOdooId || !UNRESOLVED.concat(["APPROVED"]).includes(f.workflow)) throw new AuthError("CONFLICT", 409, "Only approved, open fines with a matched vehicle can be sent to a vendor.");
  const [veh] = await d.odoo.getVehicles([f.vehicleOdooId]).catch(() => { throw new AuthError("ODOO_UNAVAILABLE", 502, "The ERP is unreachable."); });
  const [vendor] = veh?.vendorId ? await d.odoo.getVendors([veh.vendorId]) : [];
  if (!vendor) throw new AuthError("NO_RECIPIENT", 422, "No vendor is linked to this vehicle in the ERP.");
  if (!vendor.email) throw new AuthError("NO_RECIPIENT", 422, `${vendor.name} has no email address in the ERP.`);
  const msg = composeVendorEmail(f, { plate: veh.plate, vendorName: vendor.name });
  if (o.preview) return { preview: { to: vendor.email, ...msg } };
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(o.key)) throw new AuthError("BAD_REQUEST", 400, "Missing idempotency key.");
  const log = await d.repo.claimLog({ dedupeKey: `fine:${id}:vendor:${o.key}`, fineId: id, channel: "email", recipient: vendor.email, templateRef: "vendor_fine_notice_v1" });
  if (!log) return { duplicate: true as const }; // same action already processed
  let r; try { r = d.email ? await d.email().send({ to: vendor.email, ...msg }) : { status: "FAILED" as const, response: { error: "email not configured" } }; } catch (e) { r = { status: "FAILED" as const, response: { error: e instanceof Error ? e.message : "failed" } }; }
  await d.repo.finishLog(log.id, r);
  await d.repo.audit({ actorId: admin, action: "fine.vendor_notified", entityId: id, after: { to: vendor.email, status: r.status } });
  if (r.status === "FAILED") throw new AuthError("SEND_FAILED", 502, "The email provider did not accept the message. It was logged as failed; you can try again.");
  return { sent: { to: vendor.email, status: r.status } };
}

export interface DriverFineDto { id: string; reference: string | null; plate: string | null; vehicle: string | null; violationAt: string | null; amount: number | null; additionalPenalty: number | null; paid: number; outstanding: number; description: string | null; deadline: string | null; workflow: string; awaitingReview: boolean; canAcknowledge: boolean; canDispute: boolean; canSubmitPayment: boolean; hasNotice: boolean; escalated: boolean }
export function driverDto(f: FineRec, vehicle?: string | null): DriverFineDto {
  const reported = f.workflow === "REVIEW_REQUIRED" || f.workflow === "REJECTED";
  return { id: f.id, reference: f.fineReference, plate: f.plateRaw, vehicle: vehicle ?? f.vehicleMakeModel, violationAt: f.violationAt?.toISOString() ?? null, amount: f.amount, additionalPenalty: f.additionalPenalty, paid: f.amountPaid ?? 0,
    outstanding: reported ? 0 : outstanding(f), description: f.description, deadline: f.deadline && f.deadlineSource ? f.deadline.toISOString() : null, workflow: f.workflow, awaitingReview: f.workflow === "REVIEW_REQUIRED",
    canAcknowledge: f.workflow === "ACK_PENDING", canDispute: ["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING"].includes(f.workflow), canSubmitPayment: f.workflow === "PAYMENT_PENDING", hasNotice: f.evidenceKeys.length > 0, escalated: (f.escalationLevel ?? 0) > 0 };
}
/** A driver can report a fine; it goes to review and counts for nothing until an admin verifies it against a notice. */
export async function reportFine(d: WfDeps, employeeId: number, i: { amount: number; date: string; note?: string }) {
  if (!(i.amount > 0) || i.amount > 100_000) throw new AuthError("VALIDATION", 422, "Enter the fine amount.");
  const dt = new Date(`${i.date}T00:00:00+04:00`); if (isNaN(dt.getTime()) || dt.getTime() > nowOf(d) + DAY) throw new AuthError("VALIDATION", 422, "Enter a valid date that is not in the future.");
  const f = await d.repo.createFine({ noticeReceivedAt: new Date(nowOf(d)), evidenceKeys: [] });
  await d.repo.updateFine(f.id, { amount: i.amount, violationAt: dt, driverOdooId: employeeId, description: (i.note ?? "").slice(0, 200) || null, reviewReasons: ["DRIVER_REPORTED", "MISSING_PLATE", "MISSING_REFERENCE"], workflow: "REVIEW_REQUIRED" });
  await tellAdmins(d, f, "fine_reported", "Driver reported a fine", `A driver reported a fine of AED ${i.amount.toFixed(2)}. Match it to an official notice.`, `fine:${f.id}:reported`);
  return f.id;
}

export function computeFineStats(rows: FineRec[], now: number) {
  const dubaiDay = (t: number) => new Date(t + 4 * 3600_000).toISOString().slice(0, 10);
  const open = rows.filter(f => UNRESOLVED.includes(f.workflow));
  const today = rows.filter(f => f.workflow !== "REJECTED" && f.noticeReceivedAt && dubaiDay(f.noticeReceivedAt.getTime()) === dubaiDay(now));
  const verified = (f: FineRec) => f.deadline && f.deadlineSource ? f.deadline.getTime() : null;
  return {
    detectedToday: { count: today.length, amount: round(today.reduce((s, f) => s + (f.amount ?? 0), 0)) },
    awaitingReview: rows.filter(f => f.workflow === "REVIEW_REQUIRED").length, awaitingVerification: rows.filter(f => f.workflow === "PAID_AWAITING_VERIFICATION").length,
    unresolved: { count: open.length, fineAmount: round(open.reduce((s, f) => s + (f.amount ?? 0), 0)), additionalPenalty: round(open.reduce((s, f) => s + (f.additionalPenalty ?? 0), 0)), paid: round(open.reduce((s, f) => s + (f.amountPaid ?? 0), 0)), outstanding: round(open.reduce((s, f) => s + outstanding(f), 0)) },
    overdue: open.filter(f => { const t = verified(f); return t !== null && t < now; }).length,
    approaching: open.filter(f => { const t = verified(f); return t !== null && t >= now && t - now <= Math.max(...REMINDER_DAYS, 7) * DAY; }).length,
  };
}
const round = (n: number) => Math.round(n * 100) / 100;

/** Idempotent: safe to run every hour. Reminders and escalations are deduplicated by key. */
export async function runDeadlineJob(d: WfDeps) {
  const now = nowOf(d); let reminders = 0, escalations = 0;
  for (const f of await d.repo.dueFines()) {
    if (!f.deadline) continue;
    const ms = f.deadline.getTime() - now;
    if (ms >= 0) {
      const days = Math.ceil(ms / DAY); const slot = REMINDER_DAYS.find(o => days <= o);
      if (slot !== undefined) { await tellDriver(d, f, "fine_deadline", "Fine deadline approaching", `${label(f)} is due in ${days} day${days === 1 ? "" : "s"}. Outstanding: AED ${outstanding(f).toFixed(2)}.`, `fine:${f.id}:remind:${slot}`); await tellAdmins(d, f, "fine_deadline", "Fine deadline approaching", `${label(f)} is due in ${days} day${days === 1 ? "" : "s"}.`, `fine:${f.id}:remind:${slot}`); reminders++; }
    } else {
      const level = Math.floor(-ms / DAY) >= ESCALATE_L2_DAYS ? 2 : 1;
      if (level > (f.escalationLevel ?? 0)) {
        await d.repo.updateFine(f.id, { escalationLevel: level, lastEscalatedAt: new Date(now) });
        await d.repo.audit({ actorId: null, action: "fine.escalated", entityId: f.id, before: { escalationLevel: f.escalationLevel ?? 0 }, after: { escalationLevel: level } });
        await tellAdmins(d, f, "fine_overdue", level === 2 ? "Fine seriously overdue" : "Fine overdue", `${label(f)} is past its deadline. Outstanding: AED ${outstanding(f).toFixed(2)}.`, `fine:${f.id}:escalate:${level}`);
        await tellDriver(d, f, "fine_overdue", "Fine overdue", `${label(f)} is past its deadline.`, `fine:${f.id}:escalate:${level}`); escalations++;
      }
    }
  }
  return { reminders, escalations };
}
