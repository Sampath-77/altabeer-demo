import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";
import { complianceNotify, complianceAuditRepo } from "@/lib/compliance/repo-prisma";
import { allow } from "@/lib/ratelimit";

export async function POST(req: Request) {
  try {
    const d = await driverContext(req);
    if (!allow(`support:${d.userId}`, 5, 15 * 60_000)) {
      throw new AuthError("RATE_LIMITED", 429, "Too many support requests. Please wait a few minutes.");
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const flagId = typeof body.flagId === "string" ? body.flagId : undefined;
    const reportingDate = typeof body.reportingDate === "string" ? body.reportingDate : undefined;
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      throw new AuthError("VALIDATION", 422, "Please provide an explanation or description of your request.");
    }
    if (message.length > 1000) {
      throw new AuthError("VALIDATION", 422, "Message cannot exceed 1000 characters.");
    }

    // Resolve driver name from Odoo if possible
    let driverName = `Driver ${d.userId}`;
    try {
      const emp = await d.odoo.getEmployee(d.employeeId);
      if (emp?.name) driverName = emp.name;
    } catch { /* Odoo fallback */ }

    // Notify admins
    const dedupeKey = `support:${d.userId}:${Date.now()}`;
    await complianceNotify.notifyAdmins({
      type: "driver_support_request",
      title: `Assistance request from ${driverName}`,
      body: `${driverName} (${d.employeeId}) requested assistance${reportingDate ? ` regarding reporting date ${reportingDate}` : ""}: "${message}"`,
      dedupeKey,
    });

    // Write audit log
    await complianceAuditRepo.create({
      driverUserId: d.userId,
      odooEmployeeId: d.employeeId,
      action: "SUPPORT_REQUEST_SUBMITTED",
      relatedFlagId: flagId,
      performedBy: d.userId,
      performedByRole: "DRIVER",
      reason: message,
      metadata: { reportingDate, flagId },
    });

    return Response.json({
      ok: true,
      message: "Your request has been received by Al Tabeer operations. An administrator will review it shortly.",
    });
  } catch (e) {
    return errorResponse(e);
  }
}

