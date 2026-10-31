import { adminRoute } from "@/lib/route";
import { prisma } from "@/lib/auth/prisma-repo";
export const GET = adminRoute(async (_a, id) => {
  const [audit, notifications] = await Promise.all([
    prisma.auditLog.findMany({ where: { entity: "Fine", entityId: id }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, action: true, actorId: true, before: true, after: true, createdAt: true } }),
    prisma.notificationLog.findMany({ where: { fineId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, channel: true, recipient: true, status: true, providerRef: true, attempts: true, createdAt: true } }),
  ]);
  return { audit, notifications };
});
