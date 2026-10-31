import { prisma } from "../auth/prisma-repo";
import { toRec } from "../fines/repo-prisma";
import { getOdooClient } from "../odoo/client";
import type { SyncRepo, SyncDeps } from "./engine";

const p2002 = (e: unknown) => (e as { code?: string })?.code === "P2002";
const rec = (r: unknown) => (r ? toRec(r as never) : null);
export const prismaSyncRepo: SyncRepo = {
  dueOps: async (now, limit) => (await prisma.syncOutbox.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } }, orderBy: { createdAt: "asc" }, take: limit })) as never,
  markOps: async (ids, p) => { await prisma.syncOutbox.updateMany({ where: { id: { in: ids } }, data: p as never }); },
  enqueue: async e => { try { await prisma.syncOutbox.create({ data: { idempotencyKey: e.idempotencyKey, operation: e.operation, payload: e.payload as never } }); } catch (x) { if (!p2002(x)) throw x; } },
  getFine: async id => rec(await prisma.fine.findUnique({ where: { id } })),
  fineByOdooId: async id => rec(await prisma.fine.findUnique({ where: { odooRecordId: id } })),
  syncedFines: async limit => (await prisma.fine.findMany({ where: { odooRecordId: { not: null } }, orderBy: { updatedAt: "desc" }, take: limit })).map((r: unknown) => toRec(r as never)),
  setSynced: async (id, odooRecordId, at) => { await prisma.fine.update({ where: { id }, data: { odooRecordId, lastSyncedAt: at } }); },
  audit: async e => { await prisma.auditLog.create({ data: { actorId: e.actorId, action: e.action, entity: "Fine", entityId: e.entityId, before: (e.before ?? undefined) as never, after: (e.after ?? undefined) as never } }); },
  adminNotify: async n => { for (const u of await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } })) { try { await prisma.notification.create({ data: { userId: u.id, type: n.type, title: n.title, body: n.body, fineId: n.fineId, dedupeKey: `${n.dedupeKey}:${u.id}` } }); } catch (x) { if (!p2002(x)) throw x; } } },
  userNotify: async (userId, n) => { try { await prisma.notification.create({ data: { userId, ...n } }); } catch (x) { if (!p2002(x)) throw x; } },
  submissionsToPoll: async limit => (await prisma.expenseSubmission.findMany({ where: { odooExpenseId: { not: null }, OR: [{ lastStatus: null }, { lastStatus: { notIn: ["paid", "refused"] } }] }, take: limit })) as never,
  setSubmissionStatus: async (id, lastStatus) => { await prisma.expenseSubmission.update({ where: { id }, data: { lastStatus } }); },
  driverUsers: async () => (await prisma.user.findMany({ where: { role: "DRIVER", status: "ACTIVE", odooEmployeeId: { not: null } }, select: { id: true, odooEmployeeId: true } })).map(u => ({ userId: u.id, employeeId: u.odooEmployeeId! })),
  runResult: async (resource, ok, error) => { const now = new Date(); await prisma.syncState.upsert({ where: { resource }, create: { resource, lastSyncAt: ok ? now : null, lastError: ok ? null : error ?? "failed" }, update: ok ? { lastSyncAt: now, lastError: error ?? null } : { lastError: error ?? "failed" } }); },
};
export const syncDeps = (): SyncDeps => ({ odoo: getOdooClient(), repo: prismaSyncRepo });
