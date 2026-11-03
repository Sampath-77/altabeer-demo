import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { buildDailyReportTable } from "@/lib/compliance/service";
import { dubaiDate } from "@/lib/compliance/schedule";
import { AuthError } from "@/lib/auth/service";

// GET /api/admin/daily-reports/export?date=YYYY-MM-DD&format=csv
export async function GET(req: Request) {
  try {
    adminContext(req);
    const u = new URL(req.url);
    const nowMs = Date.now();
    const targetDate = u.searchParams.get("date") || dubaiDate(nowMs);
    const format = u.searchParams.get("format") ?? "csv";

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new AuthError("VALIDATION", 422, "date must be YYYY-MM-DD.");
    if (format !== "csv" && format !== "xlsx") throw new AuthError("VALIDATION", 422, "format must be csv or xlsx.");

    const rows = await buildDailyReportTable(targetDate, adminContext(req).odoo, nowMs);

    if (format === "xlsx") {
      const { buildDailyReportXlsx } = await import("@/lib/compliance/excel");
      const buf = await buildDailyReportXlsx(rows as Parameters<typeof buildDailyReportXlsx>[0], targetDate);
      return new Response(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="AlTabeer_Daily_Driver_Reports_${targetDate}.xlsx"`,
        },
      });
    }

    const header = [
      "Driver Name", "Driver User ID", "Employee ID", "Vehicle Plate", "Vehicle Model", "Vendor",
      "Reporting Date", "Row Status", "Report Type", "Violation Category", "Violation Description",
      "Violation Location", "Violation Datetime", "Fine Reference", "Reported Fine Amount (AED)",
      "Driver Explanation", "Report Status", "Submitted At", "Submitted Late", "Attachment Count",
      "Flag Status", "Report Reference", "Admin Remarks",
    ].join(",");

    const esc = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const dataRows = rows.map(r => [
      esc(r.driverName), esc(r.driverUserId), esc(r.odooEmployeeId),
      esc(r.vehiclePlate), esc(r.vehicleModel), esc(r.vendorName),
      esc(r.reportingDate), esc(r.rowStatus),
      esc(r.report?.reportType ?? ""),
      esc(r.report?.violationCategory ?? ""),
      esc(r.report?.violationDescription ?? ""),
      esc(r.report?.violationLocation ?? ""),
      esc(r.report?.violationDatetime?.toISOString() ?? ""),
      esc(r.report?.fineReference ?? ""),
      esc(r.report?.reportedFineAmount ?? ""),
      esc(r.report?.driverExplanation ?? ""),
      esc(r.report?.submissionStatus ?? ""),
      esc(r.report?.submittedAt?.toISOString() ?? ""),
      esc(r.report?.submittedLate ? "Yes" : (r.report ? "No" : "")),
      esc(r.attachmentCount),
      esc(r.flagStatus ?? ""),
      esc(r.report?.reportReference ?? ""),
      esc(r.report?.adminRemarks ?? ""),
    ].join(","));

    const csv = [header, ...dataRows].join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="daily-reports-${targetDate}.csv"`,
      },
    });
  } catch (e) { return errorResponse(e); }
}

