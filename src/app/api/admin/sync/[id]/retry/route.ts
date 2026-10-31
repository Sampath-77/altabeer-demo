import { adminRoute } from "@/lib/route";
import { prisma } from "@/lib/auth/prisma-repo";
import { AuthError } from "@/lib/auth/service";
/** Re-queues a dead or failing operation. Safe: the Odoo write is an idempotent upsert keyed by the fine's ID. */
export const POST = adminRoute(async (a, id) => {
  const r = await prisma.syncOutbox.updateMany({ where: { id, status: { in: ["DEAD", "FAILED"] } }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  if (!r.count) throw new AuthError("NOT_FOUND", 404, "Nothing to retry.");
  await prisma.auditLog.create({ data: { actorId: a.adminId, action: "sync.retry", entity: "SyncOutbox", entityId: id } });
});
