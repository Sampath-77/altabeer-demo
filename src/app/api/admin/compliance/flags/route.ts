import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { prisma } from "@/lib/auth/prisma-repo";
import type { FlagStatus } from "@prisma/client";

export async function GET(req: Request) {
  try {
    const a = adminContext(req);
    const u = new URL(req.url);
    const status = u.searchParams.get("status") as FlagStatus | null;
    const search = u.searchParams.get("search")?.trim().toLowerCase();

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const flags = await prisma.driverComplianceFlag.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, loginId: true, odooEmployeeId: true } },
        sourceReport: { select: { id: true, reportReference: true, reportType: true, submittedAt: true } },
      },
      take: 200,
    });

    // Resolve driver names from Odoo
    const employeeIds = [...new Set(flags.map(f => f.odooEmployeeId))];
    const employees = employeeIds.length
      ? new Map((await a.odoo.listEmployees({ offset: 0, limit: 500, idIn: employeeIds }).catch(() => ({ rows: [] }))).rows.map(e => [e.id, e]))
      : new Map();

    const rows = flags.map(f => {
      const emp = employees.get(f.odooEmployeeId);
      return {
        id: f.id,
        flagReference: f.flagReference,
        driverUserId: f.driverUserId,
        odooEmployeeId: f.odooEmployeeId,
        driverName: emp?.name ?? `Driver #${f.odooEmployeeId}`,
        driverLogin: f.user.loginId,
        reportingDate: f.reportingDate,
        flagType: f.flagType,
        reason: f.reason,
        status: f.status,
        adminEscalated: f.adminEscalated,
        sourceReport: f.sourceReport,
        resolvedAt: f.resolvedAt,
        resolvedBy: f.resolvedBy,
        resolutionReason: f.resolutionReason,
        resolutionRemarks: f.resolutionRemarks,
        createdAt: f.createdAt,
      };
    });

    const filtered = search
      ? rows.filter(r => r.driverName.toLowerCase().includes(search) || r.driverLogin.toLowerCase().includes(search) || r.flagReference.toLowerCase().includes(search))
      : rows;

    return Response.json({ flags: filtered });
  } catch (e) {
    return errorResponse(e);
  }
}

