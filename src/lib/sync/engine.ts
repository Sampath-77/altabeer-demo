import { createHmac, timingSafeEqual } from "crypto";
import type { OdooClient, OdooFineSnapshot } from "../odoo/types";
import type { FineRec } from "../fines/pipeline";

export const MAX_ATTEMPTS = Number(process.env.SYNC_MAX_ATTEMPTS ?? 8);
export const backoffMs = (attempt: number) => Math.min(30_000 * 2 ** (attempt - 1), 3600_000); // 30s, 1m, 2m ... capped at 1h
/** Transient: network, timeouts, 408/429/5xx. Everything else from Odoo (validation, access, missing model) will not fix itself. */
export function isTransient(e: unknown): boolean { const s = (e as { status?: number })?.status; return s === undefined || s === 408 || s === 429 || s >= 500; }

export interface OutboxRec { id: string; idempotencyKey: string; operation: string; payload: { fineId?: string; odooRecordId?: number }; status: string; attempts: number; createdAt: Date }
export interface SyncRepo {
  dueOps(now: Date, limit: number): Promise<OutboxRec[]>;
  markOps(ids: string[], patch: { status: "SENT" | "FAILED" | "DEAD"; attempts?: number; nextAttemptAt?: Date; lastError?: string | null; odooRecordId?: number | null }): Promise<void>;
  enqueue(e: { idempotencyKey: string; operation: string; payload: unknown }): Promise<void>;
  getFine(id: string): Promise<FineRec | null>;
  fineByOdooId(odooId: number): Promise<FineRec | null>;
  syncedFines(limit: number): Promise<FineRec[]>;
  setSynced(fineId: string, odooRecordId: number, at: Date): Promise<void>;
  audit(e: { actorId: string | null; action: string; entityId: string; before?: unknown; after?: unknown }): Promise<void>;
  adminNotify(n: { type: string; title: string; body: string; fineId?: string; dedupeKey: string }): Promise<void>;
  userNotify(userId: string, n: { type: string; title: string; body: string; dedupeKey: string }): Promise<void>;
  submissionsToPoll(limit: number): Promise<{ id: string; userId: string; odooExpenseId: number; lastStatus: string | null }[]>;
  setSubmissionStatus(id: string, status: string): Promise<void>;
  driverUsers(): Promise<{ userId: string; employeeId: number }[]>;
  runResult(resource: string, ok: boolean, error?: string): Promise<void>;
}
export interface SyncDeps { odoo: OdooClient; repo: SyncRepo; now?: () => number }
const nowOf = (d: SyncDeps) => d.now?.() ?? Date.now();

export function snapshot(f: FineRec): OdooFineSnapshot {
  const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
  return { appId: f.id, reference: f.fineReference, authority: f.issuingAuthority, plate: f.plateRaw, violationAt: iso(f.violationAt), noticeReceivedAt: iso(f.noticeReceivedAt), vehicleId: f.vehicleOdooId, driverId: f.driverOdooId, vendorId: f.vendorOdooId,
    amount: f.amount, penalty: f.additionalPenalty, amountPaid: f.amountPaid ?? 0, deadline: f.deadline && f.deadlineSource ? iso(f.deadline) : null, deadlineSource: f.deadlineSource, state: f.workflow.toLowerCase(), escalationLevel: f.escalationLevel ?? 0, closedReason: f.closedReason ?? null, description: f.description };
}
const NOT_SYNCED = ["REVIEW_REQUIRED", "REJECTED"];

/** Pushes the CURRENT state of each fine (not a replay of old deltas), so several queued changes collapse into one idempotent upsert. */
export async function processOutbox(d: SyncDeps, limit = 100) {
  const ops = await d.repo.dueOps(new Date(nowOf(d)), limit); let sent = 0, failed = 0, dead = 0;
  const groups = new Map<string, typeof ops>();
  for (const o of ops) { const k = o.payload.fineId ? `fine:${o.payload.fineId}` : `op:${o.id}`; groups.set(k, [...(groups.get(k) ?? []), o]); }
  for (const [, g] of groups) {
    const ids = g.map(o => o.id); const attempts = Math.max(...g.map(o => o.attempts)) + 1; const first = g[0];
    try {
      if (first.operation === "reconcile.fine") { const f = first.payload.odooRecordId ? await d.repo.fineByOdooId(first.payload.odooRecordId) : null; if (f) await reconcileFine(d, f, (await d.odoo.getFineRecords([f.odooRecordId!]))[0]); await d.repo.markOps(ids, { status: "SENT" }); sent += ids.length; continue; }
      const f = await d.repo.getFine(first.payload.fineId!);
      if (!f || NOT_SYNCED.includes(f.workflow)) { await d.repo.markOps(ids, { status: "SENT", lastError: "skipped: fine not approved" }); sent += ids.length; continue; }
      const r = await d.odoo.upsertFine(snapshot(f));
      await d.repo.setSynced(f.id, r.id, new Date(Math.max(Date.parse(r.writeDate), 0)));
      await d.repo.markOps(ids, { status: "SENT", odooRecordId: r.id, lastError: null }); sent += ids.length;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : "sync failed").slice(0, 300);
      if (!isTransient(e) || attempts >= MAX_ATTEMPTS) {
        await d.repo.markOps(ids, { status: "DEAD", attempts, lastError: msg }); dead += ids.length;
        await d.repo.audit({ actorId: null, action: "sync.dead", entityId: first.payload.fineId ?? first.id, after: { operation: first.operation, attempts, error: msg } });
        await d.repo.adminNotify({ type: "sync_failed", title: "ERP sync failed", body: `A change could not be written to the ERP after ${attempts} attempt(s): ${msg}. Open Sync status to retry.`, fineId: first.payload.fineId, dedupeKey: `sync:dead:${first.id}` });
      } else { await d.repo.markOps(ids, { status: "FAILED", attempts, nextAttemptAt: new Date(nowOf(d) + backoffMs(attempts)), lastError: msg }); failed += ids.length; }
    }
  }
  await d.repo.runResult("outbox", dead === 0, dead ? `${dead} operation(s) dead-lettered` : undefined);
  return { sent, failed, dead };
}

const TOL = 2000; const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** Compares Odoo with the app. Never overwrites Odoo edits silently: an edit made in Odoo after our last push is a CONFLICT for an admin to resolve. */
export async function reconcileFine(d: SyncDeps, f: FineRec, rec?: { id: number; state: string; amount: number; amountPaid: number; writeDate: string }) {
  const hour = Math.floor(nowOf(d) / 3600_000);
  if (!rec) { await d.repo.audit({ actorId: null, action: "sync.record_missing", entityId: f.id, after: { odooRecordId: f.odooRecordId } }); await d.repo.enqueue({ idempotencyKey: `reconcile:${f.id}:${hour}`, operation: "fine.status", payload: { fineId: f.id } }); return "repush" as const; }
  const drift = rec.state !== f.workflow.toLowerCase() || !near(rec.amountPaid, f.amountPaid ?? 0) || !near(rec.amount, f.amount ?? 0);
  if (!drift) return "ok" as const;
  if (f.lastSyncedAt && Date.parse(rec.writeDate) > f.lastSyncedAt.getTime() + TOL) {
    await d.repo.audit({ actorId: null, action: "sync.conflict", entityId: f.id, before: { app: { workflow: f.workflow, amountPaid: f.amountPaid, amount: f.amount } }, after: { odoo: { state: rec.state, amountPaid: rec.amountPaid, amount: rec.amount, writeDate: rec.writeDate } } });
    await d.repo.adminNotify({ type: "sync_conflict", title: "Fine changed in the ERP", body: `${f.fineReference ?? f.id} was edited in the ERP and no longer matches the app. Neither side was overwritten. Review it, then choose which version to keep.`, fineId: f.id, dedupeKey: `sync:conflict:${f.id}:${rec.writeDate}` });
    return "conflict" as const;
  }
  await d.repo.enqueue({ idempotencyKey: `reconcile:${f.id}:${hour}`, operation: "fine.status", payload: { fineId: f.id } }); return "repush" as const;
}
export async function reconcileAll(d: SyncDeps, limit = 200) {
  const out = { ok: 0, repush: 0, conflict: 0 };
  try {
    const fines = (await d.repo.syncedFines(limit)).filter(f => f.odooRecordId);
    const recs = new Map((await d.odoo.getFineRecords(fines.map(f => f.odooRecordId!))).map(r => [r.id, r]));
    for (const f of fines) out[await reconcileFine(d, f, recs.get(f.odooRecordId!))]++;
    await d.repo.runResult("fines-reconcile", true);
  } catch (e) { await d.repo.runResult("fines-reconcile", false, e instanceof Error ? e.message : "failed"); throw e; }
  return out;
}

const EXP_LABEL: Record<string, string> = { submitted: "is pending approval", approved: "was approved", paid: "was reimbursed", refused: "was rejected", draft: "is a draft" };
export async function pollExpenses(d: SyncDeps) {
  let changed = 0;
  try {
    const subs = await d.repo.submissionsToPoll(200); const ex = new Map((await d.odoo.getExpenses(subs.map(s => s.odooExpenseId))).map(e => [e.id, e]));
    for (const s of subs) { const e = ex.get(s.odooExpenseId); if (!e || e.status === (s.lastStatus ?? "")) continue;
      if (e.status !== (s.lastStatus ?? "submitted")) { await d.repo.userNotify(s.userId, { type: "expense_status", title: "Receipt update", body: `Your ${e.category === "other" ? "" : e.category + " "}receipt of AED ${e.amount.toFixed(2)} ${EXP_LABEL[e.status] ?? "was updated"}.`, dedupeKey: `expense:${s.odooExpenseId}:${e.status}` }); changed++; }
      await d.repo.setSubmissionStatus(s.id, e.status); }
    await d.repo.runResult("expenses", true);
  } catch (e) { await d.repo.runResult("expenses", false, e instanceof Error ? e.message : "failed"); throw e; }
  return { changed };
}
export async function pollPayslips(d: SyncDeps) {
  let notified = 0; const cutoff = nowOf(d) - 62 * 86400_000; let failures = 0;
  for (const u of await d.repo.driverUsers()) {
    try { for (const p of await d.odoo.listPayslips(u.employeeId)) if (Date.parse(p.dateTo) >= cutoff) { await d.repo.userNotify(u.userId, { type: "payslip", title: "Payslip available", body: `Your payslip for ${p.dateFrom.slice(0, 7)} is ready.`, dedupeKey: `payslip:${p.id}` }); notified++; } }
    catch { failures++; }
  }
  await d.repo.runResult("payslips", failures === 0, failures ? `${failures} driver(s) failed` : undefined);
  return { notified, failures };
}

/** Webhook auth: HMAC-SHA256 over `${timestamp}.${rawBody}`, 5 minute replay window. The payload is never trusted for data, only used to trigger a re-read. */
export function verifyWebhook(secret: string, raw: string, sigHex: string, ts: string, now = Date.now()): boolean {
  if (!secret || !/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) return false;
  const want = createHmac("sha256", secret).update(`${ts}.${raw}`).digest(); const got = Buffer.from(sigHex, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
export async function probeOdoo(odoo: OdooClient) { const t = Date.now(); try { await odoo.ping(); return { ok: true as const, latencyMs: Date.now() - t }; } catch (e) { return { ok: false as const, error: e instanceof Error ? e.message : "unreachable" }; } }
