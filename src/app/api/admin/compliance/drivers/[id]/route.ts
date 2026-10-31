import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const driverId = params.id;

    // Find driver user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: driverId },
          { loginId: driverId },
          ...(Number.isInteger(Number(driverId)) ? [{ odooEmployeeId: Number(driverId) }] : []),
        ],
      },
      select: {
        id: true,
        loginId: true,
        role: true,
        status: true,
        odooEmployeeId: true,
        createdAt: true,
      },
    });

    if (!user || user.role !== "DRIVER") {
      throw new AuthError("NOT_FOUND", 404, "Driver not found.");
    }

    const employeeId = user.odooEmployeeId;
    let employeeData = null;
    let assignment = null;
    let shifts: unknown[] = [];

    if (employeeId) {
      try {
        const [emp, asg, sh] = await Promise.all([
          a.odoo.getEmployee(employeeId),
          a.odoo.getAssignmentFor(employeeId),
          a.odoo.listAttendance(employeeId, { limit: 20 }),
        ]);
        employeeData = emp;
        assignment = asg;
        shifts = sh;
      } catch {
        /* ERP data graceful degradation */
      }
    }

    const [reports, flags, exemptions, auditLogs] = await Promise.all([
      prisma.dailyDriverReport.findMany({
        where: { driverUserId: user.id },
        orderBy: { reportingDate: "desc" },
        include: {
          attachments: {
            select: { id: true, originalFilename: true, mimeType: true, fileSizeBytes: true, uploadedAt: true },
          },
        },
        take: 50,
      }),
      prisma.driverComplianceFlag.findMany({
        where: { driverUserId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
          sourceReport: { select: { id: true, reportReference: true, reportType: true } },
        },
        take: 50,
      }),
      prisma.driverComplianceExemption.findMany({
        where: { driverUserId: user.id },
        orderBy: { reportingDate: "desc" },
      }),
      prisma.driverComplianceAuditLog.findMany({
        where: { driverUserId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const activeFlag = flags.find(f => f.status === "ACTIVE") ?? null;

    return Response.json({
      user,
      employee: employeeData,
      assignment,
      shifts,
      checkInStatus: {
        eligible: !activeFlag,
        activeFlag,
      },
      reports,
      flags,
      exemptions,
      auditLogs,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
