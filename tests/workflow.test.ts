import { describe, it, expect } from "vitest";
import { approveAndActivate, acknowledge, dispute, submitPayment, verifyPayment, closeFine, reopenFine, vendorNotification, runDeadlineJob, computeFineStats, driverDto, ownFine, reportFine, outstanding, DAY, type WfRepo, type WfDeps } from "@/lib/fines/workflow";
import { composeVendorEmail, mockProvider, sentMock, type EmailProvider } from "@/lib/fines/notify";
import type { FineRec } from "@/lib/fines/pipeline";
import { MockOdoo } from "@/lib/odoo/mock";
import type { AuthError } from "@/lib/auth/service";

const NOW = Date.UTC(2026, 9, 28, 8, 0, 0);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);
const base = (o: Partial<FineRec> = {}): FineRec => ({ id: "f1", fineReference: "DP-1", issuingAuthority: "Dubai Police", violationAt: new Date(NOW - 5 * DAY), noticeReceivedAt: new Date(NOW), plateRaw: "Dubai A 4827", plateNormalized: "A4827", plateEmirate: "DUBAI", plateCode: "A", vehicleOdooId: 1, driverOdooId: 22, vendorOdooId: 100, assignmentEvidence: null, amount: 600, additionalPenalty: null, deadline: new Date(NOW + 20 * DAY), deadlineSource: "notice", matchStatus: "MATCHED", workflow: "REVIEW_REQUIRED", reviewReasons: [], evidenceKeys: ["k.jpg"], description: "Speeding", vehicleMakeModel: null, duplicateOfId: null, manualOverride: false, rejectedReason: null, amountPaid: 0, escalationLevel: 0, ...o });
function env(fines: FineRec[] = [base()], email: EmailProvider | null = mockProvider) {
  const m = new Map(fines.map(f => [f.id, f])); const notes: { userId: string; type: string; dedupeKey: string }[] = []; const logs = new Map<string, { id: string; status?: string }>(); const audits: { action: string }[] = []; const outbox: string[] = [];
  const repo = {
    getFine: async (id: string) => (m.has(id) ? { ...m.get(id)! } : null), updateFine: async (id: string, p: Partial<FineRec>) => { Object.assign(m.get(id)!, p); },
    audit: async (e: { action: string }) => { audits.push(e); }, outbox: async (e: { idempotencyKey: string }) => { outbox.push(e.idempotencyKey); },
    createFine: async (d: { noticeReceivedAt: Date; evidenceKeys: string[] }) => { const f = base({ id: `n${m.size + 1}`, noticeReceivedAt: d.noticeReceivedAt, evidenceKeys: d.evidenceKeys, workflow: "REVIEW_REQUIRED" }); m.set(f.id, f); return f; },
    driverUserId: async (e: number) => (e === 22 ? "udrv" : null), adminUserIds: async () => ["adm1", "adm2"],
    addNotification: async (userId: string, n: { type: string; dedupeKey: string }) => { if (!notes.some(x => x.dedupeKey === n.dedupeKey)) notes.push({ userId, type: n.type, dedupeKey: n.dedupeKey }); },
    claimLog: async (l: { dedupeKey: string }) => { if (logs.has(l.dedupeKey)) return null; const r = { id: `l${logs.size + 1}` }; logs.set(l.dedupeKey, r); return r; },
    finishLog: async (id: string, r: { status: string }) => { for (const l of logs.values()) if (l.id === id) l.status = r.status; },
    dueFines: async () => [...m.values()].filter(f => ["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING"].includes(f.workflow) && f.deadline && f.deadlineSource),
  } as unknown as WfRepo;
  const odoo = new MockOdoo(); odoo.vehicles.push({ id: 1, plate: "A 4827", vendorId: 100, active: true }); odoo.vendors.push({ id: 100, name: "Vendor A", email: "ops@vendor.example" });
  let t = NOW; const deps: WfDeps = { odoo, repo, storage: { put: async () => "p1.jpg", get: async () => Buffer.alloc(1) }, email: email ? () => email : undefined, now: () => t };
  return { deps, m, notes, logs, audits, outbox, odoo, at: (n: number) => (t = n) };
}
const KEY = "key-aaaaaaaa";

describe("approval and acknowledgement", () => {
  it("approve notifies the driver and admins and waits for acknowledgement", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "adm1");
    expect(e.m.get("f1")!.workflow).toBe("ACK_PENDING");
    expect(e.notes.filter(n => n.userId === "udrv").map(n => n.type)).toEqual(["fine_new"]); expect(e.notes.filter(n => n.type === "fine_approved")).toHaveLength(2);
  });
  it("skips acknowledgement when the assigned driver has no app account", async () => {
    const e = env([base({ driverOdooId: 99 })]); await approveAndActivate(e.deps, "f1", "adm1"); expect(e.m.get("f1")!.workflow).toBe("PAYMENT_PENDING");
  });
  it("acknowledge is idempotent and only for the owner", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a");
    expect(await code(acknowledge(e.deps, "f1", 33))).toBe("NOT_FOUND"); // someone else's fine looks nonexistent
    await acknowledge(e.deps, "f1", 22); await acknowledge(e.deps, "f1", 22);
    expect(e.m.get("f1")).toMatchObject({ workflow: "PAYMENT_PENDING" }); expect(e.m.get("f1")!.acknowledgedAt).toBeTruthy();
    expect(e.audits.filter(a => a.action === "fine.acknowledged")).toHaveLength(1);
  });
  it("drivers cannot see fines still in review or rejected, or other drivers' fines", async () => {
    const e = env(); expect(await code(ownFine(e.deps, "f1", 22))).toBe("NOT_FOUND");
    await approveAndActivate(e.deps, "f1", "a"); expect(await code(ownFine(e.deps, "f1", 22))).toBe("ok"); expect(await code(ownFine(e.deps, "f1", 5))).toBe("NOT_FOUND");
  });
  it("dispute needs a reason and alerts admins", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a");
    expect(await code(dispute(e.deps, "f1", 22, " "))).toBe("VALIDATION");
    await dispute(e.deps, "f1", 22, "I was not driving"); expect(e.m.get("f1")!.workflow).toBe("DISPUTED"); expect(e.notes.some(n => n.type === "fine_disputed")).toBe(true);
  });
});
describe("payment and closure", () => {
  it("driver payment waits for verification; verification closes only when paid in full", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a"); 
    expect(await code(submitPayment(e.deps, "f1", { employeeId: 22 }, { amount: 100, reference: "r", evidenceKey: "k" }))).toBe("CONFLICT"); // must acknowledge first
    await acknowledge(e.deps, "f1", 22);
    expect(await code(submitPayment(e.deps, "f1", { employeeId: 22 }, { amount: 100, reference: "r" }))).toBe("VALIDATION"); // receipt required
    await submitPayment(e.deps, "f1", { employeeId: 22 }, { amount: 100, reference: "r", evidenceKey: "k" });
    expect(e.m.get("f1")!.workflow).toBe("PAID_AWAITING_VERIFICATION"); expect(e.m.get("f1")!.amountPaid).toBe(0); // nothing counted as paid yet
    await verifyPayment(e.deps, "f1", "adm1", true); expect(e.m.get("f1")).toMatchObject({ workflow: "PAYMENT_PENDING", amountPaid: 100 }); expect(outstanding(e.m.get("f1")!)).toBe(500);
    await submitPayment(e.deps, "f1", { employeeId: 22 }, { amount: 500, reference: "r2", evidenceKey: "k2" }); await verifyPayment(e.deps, "f1", "adm1", true);
    expect(e.m.get("f1")).toMatchObject({ workflow: "CLOSED", amountPaid: 600 });
  });
  it("rejecting payment evidence needs a reason and returns to payment pending", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a"); await acknowledge(e.deps, "f1", 22);
    await submitPayment(e.deps, "f1", { employeeId: 22 }, { amount: 600, reference: "r", evidenceKey: "k" });
    expect(await code(verifyPayment(e.deps, "f1", "adm1", false))).toBe("VALIDATION");
    await verifyPayment(e.deps, "f1", "adm1", false, "receipt unreadable"); expect(e.m.get("f1")).toMatchObject({ workflow: "PAYMENT_PENDING", amountPaid: 0 });
    expect(e.notes.some(n => n.type === "payment_rejected")).toBe(true);
  });
  it("verify without a pending payment is refused", async () => { const e = env([base({ workflow: "PAYMENT_PENDING" })]); expect(await code(verifyPayment(e.deps, "f1", "a", true))).toBe("CONFLICT"); });
  it("close and reopen need reasons and are audited; invalid transitions are refused", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a");
    expect(await code(closeFine(e.deps, "f1", "adm1", ""))).toBe("VALIDATION");
    await closeFine(e.deps, "f1", "adm1", "waived by authority"); expect(e.m.get("f1")!.workflow).toBe("CLOSED");
    expect(await code(closeFine(e.deps, "f1", "adm1", "again"))).toBe("CONFLICT");
    await reopenFine(e.deps, "f1", "adm1", "waiver revoked"); expect(e.m.get("f1")).toMatchObject({ workflow: "PAYMENT_PENDING", closedAt: null });
    expect(await code(reopenFine(e.deps, "f1", "adm1", "x"))).toBe("CONFLICT");
  });
  it("every transition is audited and queued for ERP sync", async () => {
    const e = env(); await approveAndActivate(e.deps, "f1", "a"); await acknowledge(e.deps, "f1", 22);
    expect(e.audits.map(a => a.action)).toEqual(expect.arrayContaining(["fine.approved", "fine.ack_pending", "fine.acknowledged", "fine.payment_pending"])); expect(e.outbox.length).toBeGreaterThanOrEqual(4);
  });
});
describe("vendor notification", () => {
  it("previews, sends once per idempotency key, and reports SUBMITTED not delivered", async () => {
    sentMock.length = 0; const e = env([base({ workflow: "PAYMENT_PENDING" })]);
    const p = await vendorNotification(e.deps, "f1", "adm", { key: "", preview: true }); expect(p).toMatchObject({ preview: { to: "ops@vendor.example" } }); expect(sentMock).toHaveLength(0);
    expect(await vendorNotification(e.deps, "f1", "adm", { key: KEY })).toMatchObject({ sent: { status: "SUBMITTED" } });
    expect(await vendorNotification(e.deps, "f1", "adm", { key: KEY })).toEqual({ duplicate: true }); expect(sentMock).toHaveLength(1);
    await vendorNotification(e.deps, "f1", "adm", { key: "key-bbbbbbbb" }); expect(sentMock).toHaveLength(2); // deliberate resend
  });
  it("fails clearly with no vendor email, no provider, or provider failure", async () => {
    const a = env([base({ workflow: "PAYMENT_PENDING" })]); a.odoo.vendors[0].email = undefined; expect(await code(vendorNotification(a.deps, "f1", "adm", { key: KEY }))).toBe("NO_RECIPIENT");
    const b = env([base({ workflow: "PAYMENT_PENDING" })], null); expect(await code(vendorNotification(b.deps, "f1", "adm", { key: KEY }))).toBe("SEND_FAILED"); expect([...b.logs.values()][0].status).toBe("FAILED");
    const c = env([base({ workflow: "PAYMENT_PENDING" })], { name: "x", send: async () => ({ status: "FAILED" }) }); expect(await code(vendorNotification(c.deps, "f1", "adm", { key: KEY }))).toBe("SEND_FAILED");
    const d = env([base({ workflow: "REVIEW_REQUIRED" })]); expect(await code(vendorNotification(d.deps, "f1", "adm", { key: KEY }))).toBe("CONFLICT");
  });
  it("email states only facts and an unverified deadline plainly", () => {
    const m = composeVendorEmail(base({ deadline: null, deadlineSource: null }), { plate: "A 4827", vendorName: "Vendor A" });
    expect(m.body).toContain("not verified on the notice"); expect(m.body).toContain("AED 600.00"); expect(m.body).not.toMatch(/liable|legally|recover/i);
  });
});
describe("deadlines and escalation", () => {
  const live = (o: Partial<FineRec>) => base({ workflow: "PAYMENT_PENDING", ...o });
  it("sends the right reminder once, even if the job runs repeatedly", async () => {
    const e = env([live({ deadline: new Date(NOW + 3 * DAY - 1000) })]);
    expect(await runDeadlineJob(e.deps)).toEqual({ reminders: 1, escalations: 0 }); await runDeadlineJob(e.deps); await runDeadlineJob(e.deps);
    expect(e.notes.filter(n => n.type === "fine_deadline")).toHaveLength(3); // driver + 2 admins, once
    e.at(NOW + 2 * DAY + 3600_000); await runDeadlineJob(e.deps); expect(e.notes.filter(n => n.type === "fine_deadline" && n.userId === "udrv")).toHaveLength(2); // next slot (1 day) fires once later
  });
  it("sends nothing far from the deadline, and ignores unverified deadlines", async () => {
    expect(await runDeadlineJob(env([live({ deadline: new Date(NOW + 30 * DAY) })]).deps)).toEqual({ reminders: 0, escalations: 0 });
    expect(await runDeadlineJob(env([live({ deadlineSource: null })]).deps)).toEqual({ reminders: 0, escalations: 0 });
  });
  it("escalates overdue fines in two levels, each once", async () => {
    const e = env([live({ deadline: new Date(NOW - DAY / 2) })]);
    await runDeadlineJob(e.deps); await runDeadlineJob(e.deps); expect(e.m.get("f1")!.escalationLevel).toBe(1);
    e.at(NOW + 4 * DAY); expect(await runDeadlineJob(e.deps)).toEqual({ reminders: 0, escalations: 1 }); expect(e.m.get("f1")!.escalationLevel).toBe(2);
    expect(e.audits.filter(a => a.action === "fine.escalated")).toHaveLength(2);
  });
  it("does not remind about fines that are paid-awaiting-verification or closed", async () => {
    expect(await runDeadlineJob(env([base({ workflow: "PAID_AWAITING_VERIFICATION", deadline: new Date(NOW - DAY) }), base({ id: "f2", workflow: "CLOSED", deadline: new Date(NOW - DAY) })]).deps)).toEqual({ reminders: 0, escalations: 0 });
  });
});
describe("stats and driver reports", () => {
  it("counts each fine once and separates amounts", () => {
    const rows = [base({ id: "a", workflow: "PAYMENT_PENDING", additionalPenalty: 100, amountPaid: 200, deadline: new Date(NOW - DAY) }), base({ id: "b", workflow: "ACK_PENDING", deadline: new Date(NOW + 2 * DAY) }), base({ id: "c", workflow: "REVIEW_REQUIRED" }), base({ id: "d", workflow: "REJECTED" }), base({ id: "e", workflow: "CLOSED", noticeReceivedAt: new Date(NOW - 3 * DAY) })];
    const s = computeFineStats(rows, NOW);
    expect(s.unresolved).toEqual({ count: 2, fineAmount: 1200, additionalPenalty: 100, paid: 200, outstanding: 1100 }); expect(s.overdue).toBe(1); expect(s.approaching).toBe(1); expect(s.awaitingReview).toBe(1);
    expect(s.detectedToday).toEqual({ count: 3, amount: 1800 }); // a,b,c today; rejected excluded; e received earlier
  });
  it("old fines uploaded today count as detected today but keep their violation date", () => { expect(computeFineStats([base({ violationAt: new Date(NOW - 200 * DAY) })], NOW).detectedToday.count).toBe(1); });
  it("driver-reported fines go to review and show no outstanding amount", async () => {
    const e = env([]); const id = await reportFine(e.deps, 22, { amount: 250, date: "2026-10-20", note: "Salik gate" });
    const f = e.m.get(id)!; expect(f).toMatchObject({ workflow: "REVIEW_REQUIRED", driverOdooId: 22 }); expect(f.reviewReasons).toContain("DRIVER_REPORTED");
    expect(driverDto(f).outstanding).toBe(0); expect(driverDto(f).awaitingReview).toBe(true);
    expect(await code(reportFine(e.deps, 22, { amount: 0, date: "2026-10-20" }))).toBe("VALIDATION"); expect(await code(reportFine(e.deps, 22, { amount: 5, date: "2027-01-01" }))).toBe("VALIDATION");
  });
  it("driver DTO hides unverified deadlines and exposes only permitted actions", () => {
    const d = driverDto(base({ workflow: "ACK_PENDING", deadlineSource: null })); expect(d.deadline).toBeNull(); expect(d).toMatchObject({ canAcknowledge: true, canSubmitPayment: false });
    expect(driverDto(base({ workflow: "CLOSED" }))).toMatchObject({ canAcknowledge: false, canDispute: false, canSubmitPayment: false });
  });
});
