import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { paging } from "@/lib/admin";
import { prisma } from "@/lib/auth/prisma-repo";
export async function GET(req: Request) {
  try {
    adminContext(req); const u = new URL(req.url); const pg = paging(u); const g = (k: string) => u.searchParams.get(k);
    const where: Record<string, unknown> = {};
    if (g("action")) where.action = { contains: g("action")!, mode: "insensitive" };
    if (g("entityId")) where.entityId = g("entityId");
    if (g("actorId")) where.actorId = g("actorId");
    const from = g("from") && new Date(g("from")!), to = g("to") && new Date(g("to")!);
    if ((from && !isNaN(+from)) || (to && !isNaN(+to))) where.createdAt = { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: to } : {}) };
    const [rows, total] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize }), prisma.auditLog.count({ where })]);
    return Response.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
  } catch (e) { return errorResponse(e); }
}
