// Core compliance service — business logic only, no HTTP/Prisma specifics here.
import { AuthError } from "../auth/service";
import { deadlinePassed, dubaiDate, shiftReportingDate } from "./schedule";
import {
  complianceReportRepo, attachmentRepo, complianceFlagRepo,
  exemptionRepo, complianceAuditRepo, complianceNotify,
  getActiveDriverUsers, dailySummaryRepo,
} from "./repo-prisma";
import type { CreateReportInput, ComplianceFlag, DailyReport, DailyReportRow, DailyReportRowStatus } from "./types";
import type { FlagResolutionReason } from "@prisma/client";
import type { OdooClient } from "../odoo/types";
import { sniff } from "../expenses";
import type { Storage } from "../storage";
import { randomBytes } from "crypto";

// ─── Check-In Eligibility ─────────────────────────────────────────────────

/** Called by the check-in route BEFORE hitting Odoo. Throws 403 if restricted. */
export async function assertCheckInEligible(driverUserId: string): Promise<void> {
  const flag = await complianceFlagRepo.findActiveForDriver(driverUserId);
  if (!flag) return; // eligible
  throw new AuthError("DAILY_REPORT_REQUIRED", 403,
    "Your previous working day's violation report has not been submitted. " +
    "Please submit the pending report or contact the Al Tabeer administration team.",
    { flagId: flag.id, reportingDate: flag.reportingDate, canSubmitPendingReport: true, canContactAdmin: true } as never,
  );
}

/** Returns current compliance status for a driver (used by dashboard + compliance-status endpoint). */
export async function getDriverComplianceStatus(driverUserId: string, odooEmployeeId: number, nowMs = Date.now()) {
  const [activeFlag, pendingDates, recentReports] = await Promise.all([
    complianceFlagRepo.findActiveForDriver(driverUserId),
    getPendingReportDates(driverUserId, nowMs),
    complianceReportRepo.listForDriver(driverUserId, 10),
  ]);
  return { activeFlag, pendingDates, recentReports, restricted: !!activeFlag };
}

/** Returns dates that require a report but don't have one yet. */
export async function getPendingReportDates(driverUserId: string, nowMs = Date.now()): Promise<string[]> {
  const flags = await complianceFlagRepo.listForDriver(driverUserId);
  return flags.filter(f => f.status === "ACTIVE").map(f => f.reportingDate);
}

// ─── Report Submission ────────────────────────────────────────────────────

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function submitDailyReport(
  driverUserId: string,
  odooEmployeeId: number,
  input: CreateReportInput,
  files: { buffer: Buffer; originalFilename: string }[],
  storage: Storage,
  nowMs = Date.now(),
): Promise<DailyReport> {
  // Validate reportingDate format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reportingDate)) {
    throw new AuthError("VALIDATION", 422, "Invalid reporting date format. Use YYYY-MM-DD.");
  }
  const today = dubaiDate(nowMs);
  // Cannot submit for future dates
  if (input.reportingDate > today) {
    throw new AuthError("VALIDATION", 422, "You cannot submit a report for a future date.");
  }
  // Cannot submit for dates more than 30 days ago
  const thirtyDaysAgo = dubaiDate(nowMs - 30 * 86400_000);
  if (input.reportingDate < thirtyDaysAgo) {
    throw new AuthError("VALIDATION", 422, "Reports cannot be submitted for dates more than 30 days ago.");
  }
  // Check for existing report
  const existing = await complianceReportRepo.findByDriverDate(driverUserId, input.reportingDate);
  if (existing) {
    throw new AuthError("DUPLICATE_REPORT", 409, `A report for ${input.reportingDate} has already been submitted (${existing.reportReference}).`);
  }
  // Validate report type specific fields
  if (input.reportType === "VIOLATION") {
    if (!input.violationCategory) throw new AuthError("VALIDATION", 422, "Violation category is required.");
    if (!input.violationDescription?.trim()) throw new AuthError("VALIDATION", 422, "Violation description is required.");
    if (!input.driverExplanation?.trim()) throw new AuthError("VALIDATION", 422, "Driver explanation is required.");
  }
  if (input.reportType === "NO_VIOLATION" && !input.declarationConfirmed) {
    throw new AuthError("VALIDATION", 422, "You must confirm the no-violation declaration before submitting.");
  }
  // Validate fine amount if provided
  if (input.reportedFineAmount !== undefined && (!(input.reportedFineAmount > 0) || input.reportedFineAmount > 100_000)) {
    throw new AuthError("VALIDATION", 422, "Enter a valid fine amount (0.01 – 100,000 AED).");
  }
  // Validate file attachments
  if (files.length > MAX_ATTACHMENTS) {
    throw new AuthError("VALIDATION", 422, `Maximum ${MAX_ATTACHMENTS} attachments allowed.`);
  }
  const validatedFiles: { buffer: Buffer; originalFilename: string; mimeType: string; ext: string }[] = [];
  for (const f of files) {
    if (f.buffer.length > MAX_FILE_BYTES) throw new AuthError("VALIDATION", 422, `File "${f.originalFilename}" exceeds 8 MB.`);
    const kind = sniff(f.buffer);
    if (!kind) throw new AuthError("VALIDATION", 422, `"${f.originalFilename}": unsupported type. Use JPEG, PNG, WebP, or PDF.`);
    validatedFiles.push({ ...f, mimeType: kind.mime, ext: kind.ext });
  }

  const isLate = deadlinePassed(input.reportingDate, nowMs);
  const report = await complianceReportRepo.create(driverUserId, odooEmployeeId, input, isLate);

  // Store attachments
  for (const f of validatedFiles) {
    const storageKey = await storage.put(f.buffer, f.ext);
    await attachmentRepo.create(report.id, {
      storageKey,
      originalFilename: f.originalFilename,
      mimeType: f.mimeType,
      fileSizeBytes: f.buffer.length,
    });
  }

  // Resolve active compliance flag for this date if eligible
  const flag = await complianceFlagRepo.findActiveForDriver(driverUserId);
  if (flag && flag.reportingDate === input.reportingDate) {
    const autoResolve = process.env.AUTO_RESOLVE_ON_SUBMISSION !== "false";
    if (autoResolve && !flag.adminEscalated) {
      await complianceFlagRepo.resolve(flag.id, "SYSTEM", "REPORT_SUBMITTED", "Report submitted by driver; restriction automatically lifted.");
      await complianceAuditRepo.create({
        driverUserId, odooEmployeeId, action: "FLAG_RESOLVED",
        relatedReportId: report.id, relatedFlagId: flag.id,
        performedBy: "SYSTEM", performedByRole: "SYSTEM",
        reason: "Driver submitted pending report; auto-resolved per policy.",
      });
      // Notify driver that restriction is lifted
      await complianceNotify.notifyDriver(driverUserId, {
        type: "checkin_restriction_lifted",
        title: "Check-in access restored",
        body: "Your report has been submitted. Your shift check-in access has been restored.",
        dedupeKey: `compliance:resolved:${flag.id}`,
      });
    }
  }

  // Audit log
  await complianceAuditRepo.create({
    driverUserId, odooEmployeeId, action: "REPORT_SUBMITTED",
    relatedReportId: report.id,
    performedBy: driverUserId, performedByRole: "DRIVER",
    reason: `${input.reportType} report submitted for ${input.reportingDate}`,
    metadata: { ref: report.reportReference, late: isLate, reportType: input.reportType },
  });

  // Notify admins
  if (input.reportType === "VIOLATION") {
    await complianceNotify.notifyAdmins({
      type: "compliance_violation_report",
      title: "Driver submitted a violation report",
      body: `A violation report (${report.reportReference}) has been submitted for ${input.reportingDate}. Category: ${input.violationCategory}. Review is required.`,
      dedupeKey: `compliance:violation:${report.id}`,
    });
  } else {
    await complianceNotify.notifyAdmins({
      type: "compliance_no_violation",
      title: "No-violation declaration submitted",
      body: `A no-violation declaration (${report.reportReference}) was submitted for ${input.reportingDate}.`,
      dedupeKey: `compliance:noviolation:${report.id}`,
    });
  }

  return report;
}

// ─── Admin: Flag Resolution ────────────────────────────────────────────────

export async function adminResolveFlag(
  flagId: string,
  adminUserId: string,
  reason: FlagResolutionReason,
  remarks: string,
  override = false,
): Promise<void> {
  if (!remarks.trim()) throw new AuthError("VALIDATION", 422, "A reason/explanation is required to remove a compliance restriction.");
  const flag = await complianceFlagRepo.findById(flagId);
  if (!flag) throw new AuthError("NOT_FOUND", 404, "Compliance flag not found.");
  if (flag.status !== "ACTIVE") throw new AuthError("CONFLICT", 409, `This flag is already ${flag.status.toLowerCase()}.`);

  await complianceFlagRepo.resolve(flagId, adminUserId, reason, remarks, override);

  await complianceAuditRepo.create({
    driverUserId: flag.driverUserId, odooEmployeeId: flag.odooEmployeeId,
    action: override ? "FLAG_OVERRIDDEN" : "FLAG_RESOLVED",
    relatedFlagId: flag.id, performedBy: adminUserId, performedByRole: "ADMIN",
    reason: remarks.trim(),
    metadata: { resolutionReason: reason, override },
  });

  // Notify driver
  await complianceNotify.notifyDriver(flag.driverUserId, {
    type: "checkin_restriction_lifted",
    title: "Check-in access restored",
    body: `Your check-in access has been restored by the Al Tabeer administration team. Reason: ${remarks.trim()}`,
    dedupeKey: `compliance:admin-resolved:${flag.id}`,
  });
}

// ─── Admin: Exemption ─────────────────────────────────────────────────────

export async function adminGrantExemption(
  adminUserId: string,
  driverUserId: string,
  odooEmployeeId: number,
  reportingDate: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new AuthError("VALIDATION", 422, "Exemption reason is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportingDate)) throw new AuthError("VALIDATION", 422, "Invalid date.");
  await exemptionRepo.create({ driverUserId, odooEmployeeId, reportingDate, reason: reason.trim(), approvedBy: adminUserId });
  await complianceAuditRepo.create({
    driverUserId, odooEmployeeId, action: "EXEMPTION_GRANTED",
    performedBy: adminUserId, performedByRole: "ADMIN",
    reason: reason.trim(), metadata: { reportingDate },
  });
  // If an active flag exists for this date, cancel it
  const flag = await complianceFlagRepo.findActiveForDriver(driverUserId);
  if (flag && flag.reportingDate === reportingDate) {
    await complianceFlagRepo.resolve(flag.id, adminUserId, "APPROVED_EXCEPTION", `Exemption granted: ${reason.trim()}`);
  }
}

// ─── Admin: Report Review ─────────────────────────────────────────────────

export async function adminReviewReport(
  reportId: string,
  adminUserId: string,
  action: "REVIEWED" | "CORRECTION_REQUESTED",
  remarks: string,
): Promise<void> {
  if (!remarks.trim()) throw new AuthError("VALIDATION", 422, "Remarks are required.");
  const report = await complianceReportRepo.getById(reportId);
  if (!report) throw new AuthError("NOT_FOUND", 404, "Report not found.");

  if (action === "REVIEWED") {
    await complianceReportRepo.addAdminRemarks(reportId, remarks, adminUserId);
  } else {
    await complianceReportRepo.updateStatus(reportId, "CORRECTION_REQUESTED", adminUserId, remarks);
    // Notify driver
    await complianceNotify.notifyDriver(report.driverUserId, {
      type: "compliance_correction_requested",
      title: "Your report requires correction",
      body: `Your daily report (${report.reportReference}) for ${report.reportingDate} requires a correction. Note: ${remarks.trim()}`,
      dedupeKey: `compliance:correction:${reportId}:${adminUserId}`,
    });
  }

  await complianceAuditRepo.create({
    driverUserId: report.driverUserId, odooEmployeeId: report.odooEmployeeId,
    action: action === "REVIEWED" ? "REPORT_REVIEWED" : "CORRECTION_REQUESTED",
    relatedReportId: reportId, performedBy: adminUserId, performedByRole: "ADMIN",
    reason: remarks.trim(),
  });
}

// ─── Worker: Automated Compliance Check ─────────────────────────────────

/**
 * Idempotent job: for each active driver, checks if they had attendance yesterday,
 * and if so, whether a report or exemption exists. If not, and the deadline has
 * passed, creates a compliance flag.
 *
 * Called every 15 minutes by the worker.
 */
export async function runComplianceCheckJob(odoo: OdooClient, nowMs = Date.now()): Promise<{
  checked: number; flagsCreated: number; errors: number;
}> {
  const drivers = await getActiveDriverUsers();
  let checked = 0, flagsCreated = 0, errors = 0;

  // Only check dates up to yesterday (today's reports can still be submitted until the deadline)
  const yesterday = dubaiDate(nowMs - 86400_000);

  for (const { userId, odooEmployeeId } of drivers) {
    try {
      // Look at the past 3 days to catch any missed obligations
      for (let daysAgo = 1; daysAgo <= 3; daysAgo++) {
        const checkDate = dubaiDate(nowMs - daysAgo * 86400_000);
        if (!deadlinePassed(checkDate, nowMs)) continue; // Deadline not yet passed

        // Check exemption first (fastest check, avoids Odoo call)
        const exemption = await exemptionRepo.find(userId, checkDate);
        if (exemption) continue;

        // Check if report already submitted
        const report = await complianceReportRepo.findByDriverDate(userId, checkDate);
        if (report) continue;

        // Check if driver had attendance on this date (requires Odoo call)
        let hadAttendance = false;
        try {
          const since = new Date(Date.parse(`${checkDate}T00:00:00+04:00`));
          const until = new Date(Date.parse(`${checkDate}T23:59:59+04:00`));
          const attendances = await odoo.listAttendance(odooEmployeeId, { since, limit: 10 });
          hadAttendance = attendances.some(a => shiftReportingDate(a.checkIn) === checkDate);
        } catch {
          // If Odoo is unavailable, skip silently — we'll retry next cycle
          continue;
        }

        if (!hadAttendance) continue;

        // Create compliance flag (idempotent)
        const { flag, created } = await complianceFlagRepo.upsert(
          userId, odooEmployeeId, checkDate,
          `No daily violation report was submitted for ${checkDate} (deadline passed).`,
        );

        if (created) {
          flagsCreated++;
          await complianceAuditRepo.create({
            driverUserId: userId, odooEmployeeId, action: "FLAG_CREATED",
            relatedFlagId: flag.id, performedBy: "SYSTEM", performedByRole: "SYSTEM",
            reason: `Missing daily report for ${checkDate}. Deadline passed.`,
          });
          await complianceNotify.notifyDriver(userId, {
            type: "compliance_restriction_applied",
            title: "Check-in restricted — report missing",
            body: `Your daily violation report for ${checkDate} was not submitted. Your shift check-in is temporarily restricted. Please submit the pending report.`,
            dedupeKey: `compliance:flag:${flag.id}:driver`,
          });
          await complianceNotify.notifyAdmins({
            type: "compliance_flag_created",
            title: "Driver check-in restricted",
            body: `A driver's check-in has been automatically restricted due to a missing daily report for ${checkDate}. Flag: ${flag.flagReference}.`,
            dedupeKey: `compliance:flag:${flag.id}:admin`,
          });
        }
        checked++;
      }
    } catch (e) {
      errors++;
      console.error(`compliance: error checking driver ${odooEmployeeId}:`, e instanceof Error ? e.message : e);
    }
  }

  return { checked, flagsCreated, errors };
}

// ─── Worker: Daily Summary Generation ───────────────────────────────────

export async function runDailySummaryJob(odoo: OdooClient, nowMs = Date.now()): Promise<{ generated: boolean; date: string }> {
  const summaryHour = Number(process.env.DAILY_SUMMARY_HOUR ?? 8);
  const currentDubaiHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", hour12: false }).format(new Date(nowMs))
  );
  if (currentDubaiHour < summaryHour) return { generated: false, date: "" };

  const targetDate = dubaiDate(nowMs - 86400_000); // Yesterday's summary
  const existing = await dailySummaryRepo.findByDate(targetDate);
  if (existing) return { generated: false, date: targetDate }; // Already generated

  // Build summary
  const drivers = await getActiveDriverUsers();
  const reports = await complianceReportRepo.listForDate(targetDate);
  const exemptions = await exemptionRepo.listForDate(targetDate);
  const activeFlags = await complianceFlagRepo.listActive();

  const reportMap = new Map(reports.map(r => [r.driverUserId, r]));
  const exemptSet = new Set(exemptions.map(e => e.driverUserId));
  const flaggedSet = new Set(activeFlags.map(f => f.driverUserId));

  let violationCount = 0, noViolationCount = 0, missingCount = 0, pendingCount = 0,
    exemptedCount = 0, awaitingReviewCount = 0, lateCount = 0;

  for (const { userId } of drivers) {
    if (exemptSet.has(userId)) { exemptedCount++; continue; }
    const r = reportMap.get(userId);
    if (r) {
      if (r.reportType === "VIOLATION") violationCount++;
      else noViolationCount++;
      if (r.submittedLate) lateCount++;
      if (r.submissionStatus === "UNDER_REVIEW" || r.submissionStatus === "SUBMITTED") awaitingReviewCount++;
    } else {
      if (deadlinePassed(targetDate, nowMs)) missingCount++;
      else pendingCount++;
    }
  }

  const summary = await dailySummaryRepo.upsert(targetDate, {
    totalExpected: drivers.length - exemptedCount,
    totalSubmitted: violationCount + noViolationCount,
    violationCount, noViolationCount, missingCount, pendingCount,
    exemptedCount, awaitingReviewCount,
    activeRestrictionsCount: activeFlags.length,
    lateSubmissionsCount: lateCount,
    summaryJson: { generatedAt: new Date(nowMs).toISOString(), drivers: drivers.length },
  });

  await complianceNotify.notifyAdmins({
    type: "daily_compliance_summary",
    title: `Daily report summary — ${targetDate}`,
    body: `${violationCount + noViolationCount}/${drivers.length - exemptedCount} reports submitted. ${missingCount} missing. ${activeFlags.length} drivers restricted.`,
    dedupeKey: `compliance:summary:${targetDate}`,
  });

  return { generated: true, date: targetDate };
}

// ─── Admin: Daily Report Table (§21) ──────────────────────────────────────

/**
 * Builds the full driver-by-driver daily report table for the admin.
 * Merges app DB data with Odoo employee & vehicle info.
 */
export async function buildDailyReportTable(
  targetDate: string,
  odoo: OdooClient,
  nowMs = Date.now(),
): Promise<DailyReportRow[]> {
  const drivers = await getActiveDriverUsers();
  if (drivers.length === 0) return [];

  const [reports, exemptions, allFlags, assignments] = await Promise.all([
    complianceReportRepo.listForDate(targetDate),
    exemptionRepo.listForDate(targetDate),
    complianceFlagRepo.listActive(),
    odoo.currentAssignments().catch(() => []),
  ]);

  const vehicleIds = [...new Set(assignments.map(a => a.vehicleId))];
  const vehicles = vehicleIds.length
    ? new Map((await odoo.getVehicles(vehicleIds).catch(() => [])).map(v => [v.id, v]))
    : new Map();
  const vendorIds = [...new Set([...vehicles.values()].map(v => v.vendorId).filter((x): x is number => !!x))];
  const vendors = vendorIds.length
    ? new Map((await odoo.getVendors(vendorIds).catch(() => [])).map(v => [v.id, v]))
    : new Map();
  const employeeIds = drivers.map(d => d.odooEmployeeId);
  const employees = employeeIds.length
    ? new Map((await odoo.listEmployees({ offset: 0, limit: 500, idIn: employeeIds }).catch(() => ({ rows: [] }))).rows.map(e => [e.id, e]))
    : new Map();

  const reportMap = new Map(reports.map(r => [r.driverUserId, r]));
  const exemptMap = new Map(exemptions.map(e => [e.driverUserId, e]));
  const flagMap = new Map(allFlags.map(f => [f.driverUserId, f]));
  const asgMap = new Map(assignments.map(a => [a.employeeId, a]));

  // Attachment counts
  const reportIds = reports.map(r => r.id);
  const attachCounts = reportIds.length ? await attachmentRepo.countForReports(reportIds) : new Map<string, number>();

  const rows: DailyReportRow[] = [];
  for (const { userId, odooEmployeeId } of drivers) {
    const emp = employees.get(odooEmployeeId);
    const asg = asgMap.get(odooEmployeeId);
    const veh = asg ? vehicles.get(asg.vehicleId) : undefined;
    const vendor = veh?.vendorId ? vendors.get(veh.vendorId) : undefined;
    const report = reportMap.get(userId) ?? null;
    const exemption = exemptMap.get(userId) ?? null;
    const activeFlag = flagMap.get(userId) ?? null;

    let rowStatus: DailyReportRowStatus;
    if (exemption) rowStatus = "EXEMPTED";
    else if (report) rowStatus = "SUBMITTED";
    else if (deadlinePassed(targetDate, nowMs)) rowStatus = "MISSING";
    else rowStatus = "PENDING";

    rows.push({
      driverUserId: userId,
      odooEmployeeId,
      driverName: emp?.name ?? `Employee #${odooEmployeeId}`,
      vehiclePlate: veh?.plate ?? report?.vehiclePlateSnapshot ?? null,
      vehicleModel: veh?.model ?? report?.vehicleModelSnapshot ?? null,
      vendorName: vendor?.name ?? null,
      reportingDate: targetDate,
      rowStatus,
      report,
      attachmentCount: report ? (attachCounts.get(report.id) ?? 0) : 0,
      flagStatus: activeFlag ? activeFlag.status : null,
      exemption,
    });
  }

  return rows.sort((a, b) => {
    // Sort: MISSING first, then PENDING, then SUBMITTED (violations first), then EXEMPTED
    const order = { MISSING: 0, PENDING: 1, SUBMITTED: 2, EXEMPTED: 3 };
    return order[a.rowStatus] - order[b.rowStatus];
  });
}

