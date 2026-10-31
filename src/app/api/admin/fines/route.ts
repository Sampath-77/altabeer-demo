import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { paging } from "@/lib/admin";
import { prisma } from "@/lib/auth/prisma-repo";

const STATES = ["REVIEW_REQUIRED", "APPROVED", "REJECTED", "ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "UNDER_REVIEW", "DISPUTED", "CLOSED"];
export async function GET(req: Request) {
  try {
    adminContext(req); const u = new URL(req.url); const pg = paging(u); const g = (k: string) => u.searchParams.get(k);
    const where: Record<string, unknown> = {};
    if (g("status") && STATES.includes(g("status")!)) where.workflow = g("status");
    if (g("plate")) where.plateNormalized = { contains: g("plate")!.toUpperCase().replace(/[^A-Z0-9]/g, "") };
    if (g("q")) where.fineReference = { contains: g("q")!, mode: "insensitive" };
    const [rows, total] = await Promise.all([
      prisma.fine.findMany({ where, orderBy: { noticeReceivedAt: "desc" }, skip: (pg.page - 1) * pg.pageSize, take: pg.pageSize, select: { id: true, fineReference: true, violationAt: true, noticeReceivedAt: true, plateRaw: true, vehicleOdooId: true, driverOdooId: true, vendorOdooId: true, amount: true, additionalPenalty: true, amountPaid: true, deadline: true, workflow: true, matchStatus: true, reviewReasons: true, updatedAt: true } }),
      prisma.fine.count({ where }),
    ]);
    return Response.json({ rows, total, page: pg.page, pageSize: pg.pageSize });
  } catch (e) { return errorResponse(e); }
}
