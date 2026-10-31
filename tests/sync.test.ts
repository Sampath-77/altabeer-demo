import { describe, it, expect } from "vitest";
import { processOutbox, reconcileAll, reconcileFine, pollExpenses, pollPayslips, verifyWebhook, backoffMs, isTransient, snapshot, MAX_ATTEMPTS, type SyncRepo, type SyncDeps, type OutboxRec } from "@/lib/sync/engine";
import type { FineRec } from "@/lib/fines/pipeline";
import { MockOdoo } from "@/lib/odoo/mock";
import { OdooError } from "@/lib/odoo/json2";
import { createHmac } from "crypto";

const NOW = Date.UTC(2026, 10, 1, 10, 0, 0);
const fine = (o: Partial<FineRec> = {}): FineRec => ({ id: "f1", fineReference: "DP-1", issuingAuthority: "Dubai Police", violationAt: new Date(NOW - 86400_000), noticeReceivedAt: new Date(NOW), plateRaw: "A 4827", plateNormalized: "A4827", plateEmirate: null, plateCode: "A", vehicleOdooId: 1, driverOdooId: 22, vendorOdooId: 100, assignmentEvidence: null, amount: 600, additionalPenalty: null, deadline: null, deadlineSource: null, matchStatus: "MATCHED", workflow: "PAYMENT_PENDING", reviewReasons: [], evidenceKeys: [], description: null, vehicleMakeModel: null, duplicateOfId: null, manualOverride: false, rejectedReason: null, amountPaid: 0, odooRecordId: null, lastSyncedAt: null, ...o });
function env(fines: FineRec[] = [fine()]) {
  const F = new Map(fines.map(f => [f.id, f])); const ops: (OutboxRec & { nextAttemptAt: Date; lastError?: string | null })[] = []; const audits: { action: string }[] = []; const notes = new Map<string, string>(); const runs: Record<string, string> = {};
  const subs = [{ id: "s1", userId: "u1", odooExpenseId: 5, lastStatus: null as string | null }]; let n = 0;
  const enq = (o: { idempotencyKey: string; operation: string; payload: unknown }) => { if (!ops.some(x => x.idempotencyKey === o.idempotencyKey)) ops.push({ id: `o${++n}`, status: "PENDING", attempts: 0, createdAt: new Date(NOW + n), nextAttemptAt: new Date(0), ...o, payload: o.payload as never }); };
  const repo: SyncRepo = {
    dueOps: async (now, limit) => ops.filter(o => ["PENDING", "FAILED"].includes(o.status) && o.nextAttemptAt <= now).slice(0, limit),
    markOps: async (ids, p) => { for (const o of ops) if (ids.includes(o.id)) Object.assign(o, p); }, enqueue: async e => enq(e),
    getFine: async id => (F.has(id) ? { ...F.get(id)! } : null), fineByOdooId: async id => [...F.values()].find(f => f.odooRecordId === id) ?? null,
    syncedFines: async () => [...F.values()].filter(f => f.odooRecordId).map(f => ({ ...f })), setSynced: async (id, rid, at) => { Object.assign(F.get(id)!, { odooRecordId: rid, lastSyncedAt: at }); },
    audit: async e => { audits.push(e); }, adminNotify: async x => { notes.set(x.dedupeKey, x.type); }, userNotify: async (u, x) => { notes.set(`${x.dedupeKey}:${u}`, x.type); },
    submissionsToPoll: async () => subs.filter(s => !["paid", "refused"].includes(s.lastStatus ?? "")), setSubmissionStatus: async (id, st) => { subs.find(s => s.id === id)!.lastStatus = st; },
    driverUsers: async () => [{ userId: "u1", employeeId: 7 }, { userId: "u2", employeeId: 8 }], runResult: async (r, ok, e) => { runs[r] = ok ? "ok" : e ?? "failed"; },
  };
  const odoo = new MockOdoo(); let t = NOW; const deps: SyncDeps = { odoo, repo, now: () => t };
  return { deps, odoo, F, ops, audits, notes, runs, enq, at: (x: number) => (t = x), subs };
}
const q = (e: ReturnType<typeof env>, id = "f1", k = "k1") => e.enq({ idempotencyKey: k, operation: "fine.status", payload: { fineId: id } });

describe("outbox", () => {
  it("pushes the fine to Odoo once and records the record id", async () => {
    const e = env(); q(e); expect(await processOutbox(e.deps)).toEqual({ sent: 1, failed: 0, dead: 0 });
    expect(e.F.get("f1")!.odooRecordId).toBe(e.odoo.fineRecords.get("f1")!.id); expect(e.odoo.fineRecords.get("f1")!.snapshot).toMatchObject({ amount: 600, state: "payment_pending" });
  });
  it("collapses several queued changes for one fine into one upsert of the latest state", async () => {
    const e = env(); q(e, "f1", "a"); q(e, "f1", "b"); q(e, "f1", "c"); e.F.get("f1")!.workflow = "CLOSED";
    let calls = 0; const o = e.odoo.upsertFine.bind(e.odoo); e.odoo.upsertFine = async s => { calls++; return o(s); };
    await processOutbox(e.deps); expect(calls).toBe(1); expect(e.odoo.fineRecords.get("f1")!.state).toBe("closed"); expect(e.ops.every(x => x.status === "SENT")).toBe(true);
  });
  it("re-running or retrying never creates a second Odoo record", async () => {
    const e = env(); q(e, "f1", "a"); await processOutbox(e.deps); q(e, "f1", "b"); await processOutbox(e.deps); expect(e.odoo.fineRecords.size).toBe(1);
  });
  it("retries transient failures with exponential backoff, then dead-letters and alerts admins", async () => {
    const e = env(); q(e); e.odoo.failFines = 99;
    let cur = NOW;
    for (let i = 1; i < MAX_ATTEMPTS; i++) { const r = await processOutbox(e.deps); expect(r.failed).toBe(1); expect(e.ops[0].attempts).toBe(i); expect(e.ops[0].nextAttemptAt.getTime()).toBe(cur + backoffMs(i)); expect((await processOutbox(e.deps)).sent).toBe(0); cur += backoffMs(i) + 1; e.at(cur); }
    const last = await processOutbox(e.deps); expect(last.dead).toBe(1); expect(e.ops[0].status).toBe("DEAD"); expect([...e.notes.values()]).toContain("sync_failed"); expect(e.audits.at(-1)!.action).toBe("sync.dead"); expect(e.runs.outbox).toMatch(/dead-lettered/);
  });
  it("dead-letters permanent (4xx) errors immediately", async () => {
    const e = env(); q(e); e.odoo.upsertFine = async () => { throw new OdooError("Odoo returned 403", 403); };
    expect(await processOutbox(e.deps)).toMatchObject({ dead: 1 }); expect(isTransient(new OdooError("x", 403))).toBe(false); expect(isTransient(new OdooError("x", 503))).toBe(true); expect(isTransient(new OdooError("x"))).toBe(true);
  });
  it("a failing fine does not block other fines", async () => {
    const e = env([fine(), fine({ id: "f2" })]); q(e, "f1", "a"); q(e, "f2", "b"); const o = e.odoo.upsertFine.bind(e.odoo); e.odoo.upsertFine = async s => { if (s.appId === "f1") throw new Error("down"); return o(s); };
    expect(await processOutbox(e.deps)).toEqual({ sent: 1, failed: 1, dead: 0 }); expect(e.odoo.fineRecords.has("f2")).toBe(true);
  });
  it("skips fines that were rejected or never approved", async () => {
    const e = env([fine({ workflow: "REJECTED" })]); q(e); await processOutbox(e.deps); expect(e.odoo.fineRecords.size).toBe(0); expect(e.ops[0].status).toBe("SENT");
  });
  it("dead operations can be re-queued and then succeed", async () => {
    const e = env(); q(e); const real = e.odoo.upsertFine.bind(e.odoo); e.odoo.upsertFine = async () => { throw new OdooError("403", 403); };
    await processOutbox(e.deps); expect(e.ops[0].status).toBe("DEAD");
    e.odoo.upsertFine = real; Object.assign(e.ops[0], { status: "PENDING", attempts: 0, nextAttemptAt: new Date(0) }); expect((await processOutbox(e.deps)).sent).toBe(1); expect(e.odoo.fineRecords.size).toBe(1);
  });
  it("snapshot only sends a deadline that was verified", () => {
    expect(snapshot(fine({ deadline: new Date(NOW), deadlineSource: null })).deadline).toBeNull(); expect(snapshot(fine({ deadline: new Date(NOW), deadlineSource: "notice" })).deadline).not.toBeNull();
  });
});

describe("reconciliation and conflicts", () => {
  async function synced() { const e = env(); q(e); await processOutbox(e.deps); return e; }
  it("does nothing when the app and Odoo agree", async () => { const e = await synced(); expect(await reconcileAll(e.deps)).toEqual({ ok: 1, repush: 0, conflict: 0 }); });
  it("an edit made in Odoo is a conflict: neither side is overwritten, and it is reported once", async () => {
    const e = await synced(); const r = e.odoo.fineRecords.get("f1")!; e.at(NOW + 3600_000); r.state = "closed"; r.writeDate = new Date(NOW + 1800_000).toISOString();
    expect(await reconcileAll(e.deps)).toEqual({ ok: 0, repush: 0, conflict: 1 }); await reconcileAll(e.deps);
    expect(e.F.get("f1")!.workflow).toBe("PAYMENT_PENDING"); expect(r.state).toBe("closed"); expect([...e.notes.values()].filter(x => x === "sync_conflict")).toHaveLength(1); expect(e.ops.filter(o => o.status === "PENDING")).toHaveLength(0);
  });
  it("an app change that has not reached Odoo yet is re-pushed, not treated as a conflict", async () => {
    const e = await synced(); e.F.get("f1")!.amountPaid = 100; e.at(NOW + 7200_000);
    expect(await reconcileAll(e.deps)).toEqual({ ok: 0, repush: 1, conflict: 0 }); await processOutbox(e.deps); expect(e.odoo.fineRecords.get("f1")!.amountPaid).toBe(100);
  });
  it("re-creates a record deleted in Odoo", async () => {
    const e = await synced(); e.odoo.fineRecords.clear(); expect(await reconcileAll(e.deps)).toEqual({ ok: 0, repush: 1, conflict: 0 }); await processOutbox(e.deps); expect(e.odoo.fineRecords.has("f1")).toBe(true); expect(e.audits.some(a => a.action === "sync.record_missing")).toBe(true);
  });
  it("our own push does not look like an Odoo edit (no sync loop)", async () => {
    const e = await synced(); e.F.get("f1")!.workflow = "CLOSED"; await reconcileFine(e.deps, e.F.get("f1")!, e.odoo.fineRecords.get("f1")); await processOutbox(e.deps);
    expect(await reconcileAll(e.deps)).toEqual({ ok: 1, repush: 0, conflict: 0 });
  });
  it("webhook events are queued once and are cheap to repeat", async () => {
    const e = await synced(); const id = e.F.get("f1")!.odooRecordId!;
    for (let i = 0; i < 3; i++) await e.deps.repo.enqueue({ idempotencyKey: "webhook:evt-123456", operation: "reconcile.fine", payload: { odooRecordId: id } });
    expect(e.ops.filter(o => o.operation === "reconcile.fine")).toHaveLength(1); expect((await processOutbox(e.deps)).sent).toBe(1);
  });
  it("reconcile failure is recorded and surfaces", async () => { const e = await synced(); e.odoo.failNext = true; await expect(reconcileAll(e.deps)).rejects.toThrow(); expect(e.runs["fines-reconcile"]).toMatch(/unreachable/); });
});

describe("polling Odoo changes", () => {
  it("notifies the driver once when an expense changes status", async () => {
    const e = env(); e.odoo.expenses.push({ id: 5, employeeId: 7, category: "fuel", amount: 85.5, date: "2026-11-01", status: "submitted" });
    expect((await pollExpenses(e.deps)).changed).toBe(0); expect(e.subs[0].lastStatus).toBe("submitted");
    e.odoo.expenses[0].status = "approved"; expect((await pollExpenses(e.deps)).changed).toBe(1); await pollExpenses(e.deps); expect([...e.notes.keys()].filter(k => k.startsWith("expense:5:approved"))).toHaveLength(1);
    e.odoo.expenses[0].status = "paid"; await pollExpenses(e.deps); e.odoo.expenses[0].status = "draft"; expect((await pollExpenses(e.deps)).changed).toBe(0); // terminal states are not polled again
  });
  it("announces recent payslips once, ignores old ones, and isolates per-driver failures", async () => {
    const e = env(); const slip = (id: number, emp: number, to: string) => ({ id, employeeId: emp, name: "S", dateFrom: "2026-10-01", dateTo: to, state: "done", net: 1, lines: [] });
    e.odoo.payslips.push(slip(1, 7, "2026-10-31"), slip(2, 7, "2025-01-31"));
    expect((await pollPayslips(e.deps)).notified).toBe(1); await pollPayslips(e.deps); expect([...e.notes.keys()].filter(k => k.startsWith("payslip:"))).toHaveLength(1);
    const o = e.odoo.listPayslips.bind(e.odoo); e.odoo.listPayslips = async id => { if (id === 8) throw new Error("x"); return o(id); }; expect((await pollPayslips(e.deps)).failures).toBe(1); expect(e.runs.payslips).toMatch(/failed/);
  });
});

describe("webhook authentication", () => {
  const S = "s".repeat(32), body = '{"event_id":"abcdef","record_id":5}'; const sign = (ts: string, b = body, s = S) => createHmac("sha256", s).update(`${ts}.${b}`).digest("hex"); const ts = String(Math.floor(NOW / 1000));
  it("accepts a correct signature within the window", () => { expect(verifyWebhook(S, body, sign(ts), ts, NOW)).toBe(true); });
  it("rejects wrong secret, tampered body, stale timestamp, missing secret and junk", () => {
    expect(verifyWebhook(S, body, sign(ts, body, "x".repeat(32)), ts, NOW)).toBe(false); expect(verifyWebhook(S, body + " ", sign(ts), ts, NOW)).toBe(false);
    expect(verifyWebhook(S, body, sign(ts), ts, NOW + 301_000)).toBe(false); expect(verifyWebhook("", body, sign(ts, body, ""), ts, NOW)).toBe(false);
    expect(verifyWebhook(S, body, "zz", ts, NOW)).toBe(false); expect(verifyWebhook(S, body, sign("abc"), "abc", NOW)).toBe(false);
  });
});
