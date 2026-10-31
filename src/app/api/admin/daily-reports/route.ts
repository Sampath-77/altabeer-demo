import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { buildDailyReportTable } from "@/lib/compliance/service";
import { dubaiDate } from "@/lib/compliance/schedule";
import { dailySummaryRepo } from "@/lib/compliance/repo-prisma";

// GET /api/admin/daily-reports
// ?date=YYYY-MM-DD (default: today)
// &search=<name>
// &status=SUBMITTED|PENDING|MISSING|EXEMPTED
// &reportType=VIOLATION|NO_VIOLATION
export async function GET(req: Request) {
  try {
    const a = adminContext(req);
    const u = new URL(req.url);
    const nowMs = Date.now();
    const targetDate = u.searchParams.get("date") || dubaiDate(nowMs);

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return Response.json({ error: { code: "VALIDATION", message: "date must be YYYY-MM-DD." } }, { status: 422 });
    }

    const search = u.searchParams.get("search")?.trim().toLowerCase();
    const statusFilter = u.searchParams.get("status") as "SUBMITTED" | "PENDING" | "MISSING" | "EXEMPTED" | null;
    const typeFilter = u.searchParams.get("reportType") as "VIOLATION" | "NO_VIOLATION" | null;

    let rows = await buildDailyReportTable(targetDate, a.odoo, nowMs);

    // Apply filters
    if (search) rows = rows.filter(r => r.driverName.toLowerCase().includes(search) || String(r.odooEmployeeId).includes(search) || r.vehiclePlate?.toLowerCase().includes(search) || false);
    if (statusFilter) rows = rows.filter(r => r.rowStatus === statusFilter);
    if (typeFilter) rows = rows.filter(r => r.report?.reportType === typeFilter);

    const summary = {
      totalExpected: rows.filter(r => r.rowStatus !== "EXEMPTED").length,
      totalSubmitted: rows.filter(r => r.rowStatus === "SUBMITTED").length,
      violationCount: rows.filter(r => r.report?.reportType === "VIOLATION").length,
      noViolationCount: rows.filter(r => r.report?.reportType === "NO_VIOLATION").length,
      pendingCount: rows.filter(r => r.rowStatus === "PENDING").length,
      missingCount: rows.filter(r => r.rowStatus === "MISSING").length,
      exemptedCount: rows.filter(r => r.rowStatus === "EXEMPTED").length,
      awaitingReviewCount: rows.filter(r => r.report?.submissionStatus === "SUBMITTED" || r.report?.submissionStatus === "UNDER_REVIEW").length,
      restrictedCount: rows.filter(r => r.flagStatus === "ACTIVE").length,
    };

    return Response.json({ reportingDate: targetDate, summary, rows, generatedAt: new Date(nowMs).toISOString() });
  } catch (e) { return errorResponse(e); }
}

