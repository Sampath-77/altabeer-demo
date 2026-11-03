import ExcelJS from "exceljs";
import type { Workbook } from "exceljs";

export type DailyReportRow = {
  driverName: string;
  driverUserId: string;
  odooEmployeeId: number;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  vendorName: string | null;
  reportingDate: string;
  rowStatus: string;
  attachmentCount: number;
  flagStatus: string | null;
  report: {
    reportType: string;
    violationCategory: string | null;
    violationDescription: string | null;
    violationLocation: string | null;
    violationDatetime: Date | null;
    fineReference: string | null;
    reportedFineAmount: number | null;
    driverExplanation: string | null;
    submissionStatus: string;
    submittedAt: Date | null;
    submittedLate: boolean;
    reportReference: string;
    adminRemarks: string | null;
  } | null;
  exemption: { reason: string } | null;
};

const DUBAI = "Asia/Dubai";
const fmtDubai = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-AE", { timeZone: DUBAI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d) : "";

const sanitize = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  // Formula injection defense
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
};

function applyHeaderStyle(ws: ExcelJS.Worksheet, row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
  });
  row.height = 30;
}

function setColWidths(ws: ExcelJS.Worksheet, widths: number[]) {
  ws.columns = widths.map(width => ({ width }));
}

export async function buildDailyReportXlsx(rows: DailyReportRow[], date: string): Promise<Buffer> {
  const wb: Workbook = new ExcelJS.Workbook();
  wb.creator = "Al Tabeer Admin";
  wb.created = new Date();

  // ── Sheet 1: Summary ──
  const ws1 = wb.addWorksheet("Summary");
  setColWidths(ws1, [30, 20]);
  ws1.addRow(["Al Tabeer — Daily Driver Reports", ""]).font = { bold: true, size: 14 };
  ws1.addRow(["Reporting date", date]);
  ws1.addRow(["Generated at (Dubai)", fmtDubai(new Date())]);
  ws1.addRow([]);
  const submitted = rows.filter(r => r.rowStatus === "SUBMITTED").length;
  const violations = rows.filter(r => r.report?.reportType === "VIOLATION").length;
  const missing = rows.filter(r => r.rowStatus === "MISSING").length;
  const pending = rows.filter(r => r.rowStatus === "PENDING").length;
  const exempted = rows.filter(r => r.rowStatus === "EXEMPTED").length;
  const summaryData = [
    ["Total drivers expected", rows.length],
    ["Reports submitted", submitted],
    ["Submission rate", rows.length > 0 ? `${Math.round(100 * submitted / rows.length)}%` : "0%"],
    ["Violation reports", violations],
    ["No-violation declarations", submitted - violations],
    ["Pending", pending],
    ["Missing (deadline passed)", missing],
    ["Exempted", exempted],
  ];
  summaryData.forEach(([label, val]) => ws1.addRow([label, val]));

  // ── Sheet 2: All Reports ──
  const ws2 = wb.addWorksheet("All Reports");
  setColWidths(ws2, [25, 15, 12, 14, 20, 20, 14, 12, 15, 18, 30, 25, 20, 18, 14, 30, 15, 20, 12, 10, 12, 20, 30]);
  const hdr2 = ws2.addRow([
    "Driver Name", "Driver User ID", "Employee ID", "Vehicle Plate", "Vehicle Model", "Vendor",
    "Reporting Date", "Row Status", "Report Type", "Violation Category", "Violation Description",
    "Violation Location", "Violation Datetime (Dubai)", "Fine Reference", "Fine Amount (AED)",
    "Driver Explanation", "Report Status", "Submitted At (Dubai)", "Submitted Late",
    "Attachments", "Flag Status", "Report Reference", "Admin Remarks",
  ]);
  applyHeaderStyle(ws2, hdr2);
  ws2.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach(r => {
    ws2.addRow([
      sanitize(r.driverName), sanitize(r.driverUserId), r.odooEmployeeId,
      sanitize(r.vehiclePlate), sanitize(r.vehicleModel), sanitize(r.vendorName),
      r.reportingDate, r.rowStatus,
      sanitize(r.report?.reportType ?? ""), sanitize(r.report?.violationCategory ?? ""),
      sanitize(r.report?.violationDescription ?? ""), sanitize(r.report?.violationLocation ?? ""),
      r.report?.violationDatetime ? fmtDubai(r.report.violationDatetime) : "",
      sanitize(r.report?.fineReference ?? ""), r.report?.reportedFineAmount ?? null,
      sanitize(r.report?.driverExplanation ?? ""), sanitize(r.report?.submissionStatus ?? ""),
      r.report?.submittedAt ? fmtDubai(r.report.submittedAt) : "",
      r.report?.submittedLate ? "Yes" : (r.report ? "No" : ""),
      r.attachmentCount, sanitize(r.flagStatus ?? ""),
      sanitize(r.report?.reportReference ?? ""), sanitize(r.report?.adminRemarks ?? ""),
    ]);
  });

  // ── Sheet 3: Violations only ──
  const ws3 = wb.addWorksheet("Violations");
  setColWidths(ws3, [25, 14, 20, 18, 30, 25, 20, 14, 30, 30]);
  const hdr3 = ws3.addRow(["Driver Name", "Vehicle Plate", "Vendor", "Violation Datetime (Dubai)", "Violation Category", "Violation Location", "Fine Reference", "Fine Amount (AED)", "Driver Explanation", "Admin Remarks"]);
  applyHeaderStyle(ws3, hdr3);
  ws3.views = [{ state: "frozen", ySplit: 1 }];
  rows.filter(r => r.report?.reportType === "VIOLATION").forEach(r => {
    ws3.addRow([
      sanitize(r.driverName), sanitize(r.vehiclePlate), sanitize(r.vendorName),
      r.report?.violationDatetime ? fmtDubai(r.report.violationDatetime) : "",
      sanitize(r.report?.violationCategory ?? ""), sanitize(r.report?.violationLocation ?? ""),
      sanitize(r.report?.fineReference ?? ""), r.report?.reportedFineAmount ?? null,
      sanitize(r.report?.driverExplanation ?? ""), sanitize(r.report?.adminRemarks ?? ""),
    ]);
  });

  // ── Sheet 4: Missing Reports ──
  const ws4 = wb.addWorksheet("Missing");
  setColWidths(ws4, [25, 15, 12, 14, 20, 14, 12]);
  const hdr4 = ws4.addRow(["Driver Name", "Driver User ID", "Employee ID", "Vehicle Plate", "Vendor", "Reporting Date", "Status"]);
  applyHeaderStyle(ws4, hdr4);
  ws4.views = [{ state: "frozen", ySplit: 1 }];
  rows.filter(r => r.rowStatus === "MISSING").forEach(r => {
    ws4.addRow([sanitize(r.driverName), sanitize(r.driverUserId), r.odooEmployeeId, sanitize(r.vehiclePlate), sanitize(r.vendorName), r.reportingDate, r.rowStatus]);
  });

  // ── Sheet 5: Exemptions ──
  const ws5 = wb.addWorksheet("Exemptions");
  setColWidths(ws5, [25, 15, 12, 14, 20, 14, 40]);
  const hdr5 = ws5.addRow(["Driver Name", "Driver User ID", "Employee ID", "Vehicle Plate", "Vendor", "Reporting Date", "Exemption Reason"]);
  applyHeaderStyle(ws5, hdr5);
  ws5.views = [{ state: "frozen", ySplit: 1 }];
  rows.filter(r => r.rowStatus === "EXEMPTED").forEach(r => {
    ws5.addRow([sanitize(r.driverName), sanitize(r.driverUserId), r.odooEmployeeId, sanitize(r.vehiclePlate), sanitize(r.vendorName), r.reportingDate, sanitize(r.exemption?.reason ?? "")]);
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
