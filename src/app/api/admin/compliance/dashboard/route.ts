import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { complianceFlagRepo, complianceReportRepo, exemptionRepo } from "@/lib/compliance/repo-prisma";
import { getActiveDriverUsers } from "@/lib/compliance/repo-prisma";
import { deadlinePassed, dubaiDate } from "@/lib/compliance/schedule";

// GET /api/admin/compliance/dashboard — KPI summary cards
export async function GET(req: Request) {
  try {
    adminContext(req);
    const nowMs = Date.now();
    const today = dubaiDate(nowMs);

    const [drivers, todayReports, activeFlags, todayExemptions] = await Promise.all([
      getActiveDriverUsers(),
      complianceReportRepo.listForDate(today),
      complianceFlagRepo.listActive(),
      exemptionRepo.listForDate(today),
    ]);

    const exemptSet = new Set(todayExemptions.map(e => e.driverUserId));
    const expected = drivers.filter(d => !exemptSet.has(d.userId)).length;
    const submitted = todayReports.length;
    const violationCount = todayReports.filter(r => r.reportType === "VIOLATION").length;
    const noViolationCount = todayReports.filter(r => r.reportType === "NO_VIOLATION").length;
    const awaitingReview = todayReports.filter(r => r.submissionStatus === "SUBMITTED" || r.submissionStatus === "UNDER_REVIEW").length;

    const submittedUserIds = new Set(todayReports.map(r => r.driverUserId));
    const pending = drivers.filter(d => !exemptSet.has(d.userId) && !submittedUserIds.has(d.userId)).length;
    const missing = deadlinePassed(today, nowMs)
      ? drivers.filter(d => !exemptSet.has(d.userId) && !submittedUserIds.has(d.userId)).length
      : 0;

    return Response.json({
      reportingDate: today,
      totalExpected: expected,
      totalSubmitted: submitted,
      violationReports: violationCount,
      noViolationDeclarations: noViolationCount,
      pendingReports: deadlinePassed(today, nowMs) ? 0 : pending,
      missingReports: missing,
      awaitingReview,
      exemptedToday: todayExemptions.length,
      activeRestrictions: activeFlags.length,
      generatedAt: new Date(nowMs).toISOString(),
    });
  } catch (e) { return errorResponse(e); }
}

