import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { submitDailyReport } from "@/lib/compliance/service";
import { complianceFlagRepo } from "@/lib/compliance/repo-prisma";
import { dubaiDate } from "@/lib/compliance/schedule";
import { localStorage_ } from "@/lib/storage";
import { AuthError } from "@/lib/auth/service";
import { allow } from "@/lib/ratelimit";
import { clientIp } from "@/lib/auth/http";
import type { ReportType, ViolationCategory } from "@prisma/client";

const VIOLATION_CATEGORIES: ViolationCategory[] = [
  "SPEEDING", "PARKING_VIOLATION", "RED_LIGHT_VIOLATION", "WRONG_PARKING",
  "LANE_VIOLATION", "VEHICLE_ACCIDENT", "VEHICLE_DAMAGE", "VEHICLE_INCIDENT", "OTHER",
];

// POST /api/driver/daily-reports/submit — submit a daily violation report
export async function POST(req: Request) {
  try {
    const d = await driverContext(req);
    if (!allow(`daily-report:${d.userId}`, 5, 60_000)) {
      throw new AuthError("RATE_LIMITED", 429, "Too many submission attempts. Please wait a moment.");
    }

    const contentType = req.headers.get("content-type") ?? "";
    let fields: Record<string, string> = {};
    let files: { buffer: Buffer; originalFilename: string }[] = [];

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => { throw new AuthError("BAD_REQUEST", 400, "Invalid form data."); });
      for (const [key, val] of form.entries()) {
        if (typeof val === "string") fields[key] = val;
        else if (val instanceof File) {
          const buffer = Buffer.from(await val.arrayBuffer());
          files.push({ buffer, originalFilename: val.name || "upload" });
        }
      }
    } else {
      // JSON-only submission (no files)
      fields = (await req.json().catch(() => ({}))) as Record<string, string>;
    }

    const reportType = fields.reportType as ReportType;
    if (reportType !== "VIOLATION" && reportType !== "NO_VIOLATION") {
      throw new AuthError("VALIDATION", 422, "reportType must be VIOLATION or NO_VIOLATION.");
    }
    if (reportType === "VIOLATION" && fields.violationCategory && !VIOLATION_CATEGORIES.includes(fields.violationCategory as ViolationCategory)) {
      throw new AuthError("VALIDATION", 422, "Invalid violation category.");
    }

    // Snapshot the driver's current vehicle assignment from Odoo
    let vehicleOdooId: number | undefined;
    let vehiclePlateSnapshot: string | undefined;
    let vehicleModelSnapshot: string | undefined;
    try {
      const asg = await d.odoo.getAssignmentFor(d.employeeId);
      if (asg) {
        vehicleOdooId = asg.vehicle.id;
        vehiclePlateSnapshot = asg.vehicle.plate;
        vehicleModelSnapshot = asg.vehicle.model ?? undefined;
      }
    } catch { /* Odoo unavailable — proceed without vehicle snapshot */ }

    // Trusted server-side reporting date determination
    const serverToday = dubaiDate(Date.now());
    let trustedDate = serverToday;
    if (fields.reportingDate && fields.reportingDate !== serverToday) {
      const activeFlag = await complianceFlagRepo.findActiveForDriver(d.userId);
      if (activeFlag && activeFlag.reportingDate === fields.reportingDate) {
        trustedDate = activeFlag.reportingDate;
      } else {
        throw new AuthError("VALIDATION", 422, "You can only submit for today's reporting date or your active pending report date.");
      }
    }

    const report = await submitDailyReport(
      d.userId,
      d.employeeId,
      {
        reportingDate: trustedDate,
        reportType,
        violationCategory: fields.violationCategory as ViolationCategory | undefined,
        violationDescription: fields.violationDescription || undefined,
        violationLocation: fields.violationLocation || undefined,
        violationDatetime: fields.violationDatetime || undefined,
        fineReference: fields.fineReference || undefined,
        reportedFineAmount: fields.reportedFineAmount ? Number(fields.reportedFineAmount) : undefined,
        driverExplanation: fields.driverExplanation || undefined,
        declarationConfirmed: fields.declarationConfirmed === "true" || fields.declarationConfirmed === "1",
        vehicleOdooId,
        vehiclePlateSnapshot,
        vehicleModelSnapshot,
      },
      files,
      localStorage_(),
    );

    return Response.json({
      ok: true,
      reportReference: report.reportReference,
      reportId: report.id,
      reportingDate: report.reportingDate,
      reportType: report.reportType,
      submittedAt: report.submittedAt,
      submissionStatus: report.submissionStatus,
      submittedLate: report.submittedLate,
    }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}

