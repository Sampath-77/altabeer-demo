import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { adminGrantExemption } from "@/lib/compliance/service";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";

// POST /api/admin/compliance/exemptions — grant a rest-day / leave exemption
export async function POST(req: Request) {
  try {
    const a = adminContext(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const driverUserId = String(body.driverUserId ?? "");
    const reportingDate = String(body.reportingDate ?? "");
    const reason = String(body.reason ?? "").trim();

    if (!driverUserId) throw new AuthError("VALIDATION", 422, "driverUserId is required.");
    if (!reason) throw new AuthError("VALIDATION", 422, "reason is required.");

    // Resolve the driver's odooEmployeeId from their user record
    const user = await prisma.user.findUnique({ where: { id: driverUserId }, select: { odooEmployeeId: true, role: true } });
    if (!user || user.role !== "DRIVER") throw new AuthError("NOT_FOUND", 404, "Driver not found.");
    if (!user.odooEmployeeId) throw new AuthError("CONFLICT", 409, "This driver is not linked to an Odoo employee.");

    await adminGrantExemption(a.adminId, driverUserId, user.odooEmployeeId, reportingDate, reason);
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

