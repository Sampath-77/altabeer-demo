import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { prisma } from "@/lib/auth/prisma-repo";
import { probeOdoo } from "@/lib/sync/engine";
export async function GET(req: Request) {
  try {
    const a = adminContext(req);
    const [odoo, counts, state, dead, oldest] = await Promise.all([
      probeOdoo(a.odoo),
      prisma.syncOutbox.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.syncState.findMany(),
      prisma.syncOutbox.findMany({ where: { status: { in: ["DEAD", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, operation: true, status: true, attempts: true, nextAttemptAt: true, lastError: true, payload: true, updatedAt: true } }),
      prisma.syncOutbox.findFirst({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ]);
    const c = Object.fromEntries(counts.map((x: { status: string; _count: { _all: number } }) => [x.status, x._count._all]));
    return Response.json({ checkedAt: new Date().toISOString(), odoo, outbox: { pending: c.PENDING ?? 0, retrying: c.FAILED ?? 0, dead: c.DEAD ?? 0, sent: c.SENT ?? 0, oldestUnsentAt: oldest?.createdAt ?? null }, resources: state, problems: dead });
  } catch (e) { return errorResponse(e); }
}
