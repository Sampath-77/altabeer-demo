import { prisma } from "../auth/prisma-repo";
import type { FineRepo, FineRec, JobRec } from "./pipeline";

type Row = Awaited<ReturnType<typeof prisma.fine.findUniqueOrThrow>>;
export const toRec = (r: Row): FineRec => ({ ...(r as unknown as FineRec), amount: r.amount == null ? null : Number(r.amount), additionalPenalty: r.additionalPenalty == null ? null : Number(r.additionalPenalty), amountPaid: Number(r.amountPaid ?? 0), paymentClaimedAmount: r.paymentClaimedAmount == null ? null : Number(r.paymentClaimedAmount) });
const j = (v: unknown) => (v === null || v === undefined ? undefined : (v as never));

export const prismaFineRepo: FineRepo = {
  createFine: async d => toRec(await prisma.fine.create({ data: { noticeReceivedAt: d.noticeReceivedAt, evidenceKeys: d.evidenceKeys, workflow: "REVIEW_REQUIRED" } })),
  createJob: async d => (await prisma.ocrJob.create({ data: d })) as unknown as JobRec,
  getFine: async id => { const r = await prisma.fine.findUnique({ where: { id } }); return r ? toRec(r) : null; },
  updateFine: async (id, p) => { const { assignmentEvidence, ...rest } = p as Record<string, unknown>; await prisma.fine.update({ where: { id }, data: { ...(rest as object), ...("assignmentEvidence" in p ? { assignmentEvidence: j(assignmentEvidence) ?? ({} as never) } : {}) } }); },
  getJob: async id => (await prisma.ocrJob.findUnique({ where: { id } })) as unknown as JobRec | null,
  updateJob: async (id, p) => { const { fields, ...rest } = p; await prisma.ocrJob.update({ where: { id }, data: { ...(rest as object), ...(fields !== undefined ? { fields: j(fields) } : {}) } }); },
  queuedJobs: async limit => (await prisma.ocrJob.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: limit })) as unknown as JobRec[],
  duplicates: async f => {
    const strong = f.reference ? await prisma.fine.findMany({ where: { id: { not: f.id }, fineReference: f.reference, issuingAuthority: f.authority, workflow: { not: "REJECTED" } }, select: { id: true } }) : [];
    const weak = f.plateNormalized && f.violationAt && f.amount != null ? await prisma.fine.findMany({ where: { id: { not: f.id }, plateNormalized: f.plateNormalized, violationAt: f.violationAt, amount: f.amount, workflow: { not: "REJECTED" } }, select: { id: true } }) : [];
    return { strong: strong.map((x: { id: string }) => x.id), weak: weak.map((x: { id: string }) => x.id) };
  },
  audit: async e => { await prisma.auditLog.create({ data: { actorId: e.actorId, action: e.action, entity: "Fine", entityId: e.entityId, before: j(e.before), after: j(e.after) } }); },
  outbox: async e => { await prisma.syncOutbox.upsert({ where: { idempotencyKey: e.idempotencyKey }, create: { idempotencyKey: e.idempotencyKey, operation: e.operation, payload: e.payload as never }, update: {} }); },
};
