// Prisma repository implementations for the compliance module.
import { prisma } from "../auth/prisma-repo";
import { randomBytes } from "crypto";
import type { CreateReportInput, ComplianceFlag, DailyReport, ComplianceExemption, ReportAttachment } from "./types";
import type { ReportStatus, FlagResolutionReason } from "@prisma/client";
import { makeReportRef, makeFlagRef, deadlinePassed } from "./schedule";

const p2002 = (e: unknown) => (e as { code?: string })?.code === "P2002";

// ─── Helpers ───────────────────────────────────────────────────────────────

function toReport(r: Record<string, unknown>): DailyReport {
  return {
    ...r,
    reportedFineAmount: r.reportedFineAmount != null ? Number(r.reportedFineAmount) : null,
  } as unknown as DailyReport;
}

function toFlag(r: Record<string, unknown>): ComplianceFlag {
  return r as unknown as ComplianceFlag;
}

// ─── Report Repo ───────────────────────────────────────────────────────────

export const complianceReportRepo = {
  /** Find the report for a specific driver + date. */
  async findByDriverDate(driverUserId: string, reportingDate: string): Promise<DailyReport | null> {
    const r = await prisma.dailyDriverReport.findUnique({
      where: { driverUserId_reportingDate: { driverUserId, reportingDate } },
    });
    return r ? toReport(r as Record<string, unknown>) : null;
  },

  /** Create a new daily report atomically. Returns null if a duplicate exists (idempotent). */
  async create(driverUserId: string, odooEmployeeId: number, input: CreateReportInput, isLate: boolean): Promise<DailyReport> {
    const suffix = randomBytes(3).toString("hex");
    const ref = makeReportRef(input.reportingDate, suffix);
    const r = await prisma.dailyDriverReport.create({
      data: {
        reportReference: ref,
        driverUserId,
        odooEmployeeId,
        reportingDate: input.reportingDate,
        shiftAttendanceId: input.shiftAttendanceId ?? null,
        vehicleOdooId: input.vehicleOdooId ?? null,
        vehiclePlateSnapshot: input.vehiclePlateSnapshot ?? null,
        vehicleModelSnapshot: input.vehicleModelSnapshot ?? null,
        reportType: input.reportType,
        violationCategory: input.violationCategory ?? null,
        violationDescription: input.violationDescription?.trim() || null,
        violationLocation: input.violationLocation?.trim() || null,
        violationDatetime: input.violationDatetime ? new Date(input.violationDatetime) : null,
        fineReference: input.fineReference?.trim() || null,
        reportedFineAmount: input.reportedFineAmount ?? null,
        driverExplanation: input.driverExplanation?.trim() || null,
        declarationConfirmed: input.declarationConfirmed ?? false,
        submittedLate: isLate,
        submissionStatus: "SUBMITTED",
      },
    });
    return toReport(r as Record<string, unknown>);
  },

  async updateStatus(id: string, status: ReportStatus, by?: string, note?: string): Promise<void> {
    await prisma.dailyDriverReport.update({
      where: { id },
      data: { submissionStatus: status, reviewedAt: by ? new Date() : undefined, reviewedBy: by ?? undefined, correctionNote: note ?? undefined },
    });
  },

  async addAdminRemarks(id: string, remarks: string, reviewedBy: string): Promise<void> {
    await prisma.dailyDriverReport.update({
      where: { id },
      data: { adminRemarks: remarks, reviewedAt: new Date(), reviewedBy, submissionStatus: "REVIEWED" },
    });
  },

  async listForDriver(driverUserId: string, limit = 30): Promise<DailyReport[]> {
    const rows = await prisma.dailyDriverReport.findMany({
      where: { driverUserId },
      orderBy: { reportingDate: "desc" },
      take: limit,
    });
    return rows.map(r => toReport(r as Record<string, unknown>));
  },

  /** Used by the admin daily reports table — gets all reports for a given date. */
  async listForDate(reportingDate: string): Promise<DailyReport[]> {
    const rows = await prisma.dailyDriverReport.findMany({
      where: { reportingDate },
      orderBy: { submittedAt: "asc" },
    });
    return rows.map(r => toReport(r as Record<string, unknown>));
  },

  async listForDateRange(from: string, to: string): Promise<DailyReport[]> {
    const rows = await prisma.dailyDriverReport.findMany({
      where: { reportingDate: { gte: from, lte: to } },
      orderBy: { reportingDate: "asc" },
    });
    return rows.map(r => toReport(r as Record<string, unknown>));
  },

  async getById(id: string): Promise<DailyReport | null> {
    const r = await prisma.dailyDriverReport.findUnique({ where: { id } });
    return r ? toReport(r as Record<string, unknown>) : null;
  },
};

// ─── Attachment Repo ───────────────────────────────────────────────────────

export const attachmentRepo = {
  async create(reportId: string, data: { storageKey: string; originalFilename: string; mimeType: string; fileSizeBytes: number }): Promise<ReportAttachment> {
    return prisma.driverReportAttachment.create({ data: { reportId, ...data } }) as unknown as ReportAttachment;
  },

  async listForReport(reportId: string): Promise<ReportAttachment[]> {
    return prisma.driverReportAttachment.findMany({ where: { reportId } }) as unknown as ReportAttachment[];
  },

  async countForReports(reportIds: string[]): Promise<Map<string, number>> {
    const rows = await prisma.driverReportAttachment.groupBy({
      by: ["reportId"],
      where: { reportId: { in: reportIds } },
      _count: { id: true },
    });
    return new Map(rows.map(r => [r.reportId, r._count.id]));
  },
};

// ─── Flag Repo ─────────────────────────────────────────────────────────────

export const complianceFlagRepo = {
  /** Upsert: creates flag if not exists, skips if already exists (idempotent). Returns flag + whether it was newly created. */
  async upsert(driverUserId: string, odooEmployeeId: number, reportingDate: string, reason: string): Promise<{ flag: ComplianceFlag; created: boolean }> {
    const suffix = randomBytes(3).toString("hex");
    const ref = makeFlagRef(reportingDate, suffix);
    try {
      const flag = await prisma.driverComplianceFlag.create({
        data: { flagReference: ref, driverUserId, odooEmployeeId, reportingDate, reason },
      });
      return { flag: toFlag(flag as Record<string, unknown>), created: true };
    } catch (e) {
      if (p2002(e)) {
        // Already exists — find it
        const flag = await prisma.driverComplianceFlag.findFirst({
          where: { driverUserId, reportingDate, status: "ACTIVE" },
        });
        return { flag: toFlag((flag ?? {}) as Record<string, unknown>), created: false };
      }
      throw e;
    }
  },

  async findActiveForDriver(driverUserId: string): Promise<ComplianceFlag | null> {
    const r = await prisma.driverComplianceFlag.findFirst({
      where: { driverUserId, status: "ACTIVE" },
      orderBy: { reportingDate: "asc" },
    });
    return r ? toFlag(r as Record<string, unknown>) : null;
  },

  async findById(id: string): Promise<ComplianceFlag | null> {
    const r = await prisma.driverComplianceFlag.findUnique({ where: { id } });
    return r ? toFlag(r as Record<string, unknown>) : null;
  },

  async resolve(id: string, resolvedBy: string, reason: FlagResolutionReason, remarks: string, override = false): Promise<void> {
    await prisma.driverComplianceFlag.update({
      where: { id },
      data: {
        status: override ? "OVERRIDDEN" : "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy,
        resolutionReason: reason,
        resolutionRemarks: remarks.trim() || null,
      },
    });
  },

  async listActive(): Promise<ComplianceFlag[]> {
    const rows = await prisma.driverComplianceFlag.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(r => toFlag(r as Record<string, unknown>));
  },

  async listForDriver(driverUserId: string): Promise<ComplianceFlag[]> {
    const rows = await prisma.driverComplianceFlag.findMany({
      where: { driverUserId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(r => toFlag(r as Record<string, unknown>));
  },

  async countActive(): Promise<number> {
    return prisma.driverComplianceFlag.count({ where: { status: "ACTIVE" } });
  },

  async markEscalated(id: string): Promise<void> {
    await prisma.driverComplianceFlag.update({ where: { id }, data: { adminEscalated: true } });
  },
};

// ─── Exemption Repo ────────────────────────────────────────────────────────

export const exemptionRepo = {
  async find(driverUserId: string, reportingDate: string): Promise<ComplianceExemption | null> {
    const r = await prisma.driverComplianceExemption.findUnique({
      where: { driverUserId_reportingDate: { driverUserId, reportingDate } },
    });
    return r as unknown as ComplianceExemption | null;
  },

  async create(data: { driverUserId: string; odooEmployeeId: number; reportingDate: string; reason: string; approvedBy: string }): Promise<ComplianceExemption> {
    const r = await prisma.driverComplianceExemption.create({ data });
    return r as unknown as ComplianceExemption;
  },

  async listForDate(reportingDate: string): Promise<ComplianceExemption[]> {
    const rows = await prisma.driverComplianceExemption.findMany({ where: { reportingDate } });
    return rows as unknown as ComplianceExemption[];
  },

  async listForDriver(driverUserId: string): Promise<ComplianceExemption[]> {
    const rows = await prisma.driverComplianceExemption.findMany({
      where: { driverUserId },
      orderBy: { reportingDate: "desc" },
    });
    return rows as unknown as ComplianceExemption[];
  },
};

// ─── Audit Log Repo ────────────────────────────────────────────────────────

export const complianceAuditRepo = {
  async create(entry: {
    driverUserId: string;
    odooEmployeeId: number;
    action: string;
    relatedReportId?: string;
    relatedFlagId?: string;
    performedBy: string;
    performedByRole: string;
    reason?: string;
    metadata?: unknown;
  }): Promise<void> {
    await prisma.driverComplianceAuditLog.create({
      data: {
        driverUserId: entry.driverUserId,
        odooEmployeeId: entry.odooEmployeeId,
        action: entry.action,
        relatedReportId: entry.relatedReportId ?? null,
        relatedFlagId: entry.relatedFlagId ?? null,
        performedBy: entry.performedBy,
        performedByRole: entry.performedByRole,
        reason: entry.reason ?? null,
        metadata: (entry.metadata ?? null) as never,
      },
    });
  },

  async listForDriver(driverUserId: string, limit = 50) {
    return prisma.driverComplianceAuditLog.findMany({
      where: { driverUserId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },

  async listAll(limit = 200) {
    return prisma.driverComplianceAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};

// ─── Daily Summary Repo ────────────────────────────────────────────────────

export const dailySummaryRepo = {
  async findByDate(reportingDate: string) {
    return prisma.dailyComplianceSummary.findUnique({ where: { reportingDate } });
  },

  async upsert(reportingDate: string, data: {
    totalExpected: number; totalSubmitted: number; violationCount: number;
    noViolationCount: number; missingCount: number; pendingCount: number;
    exemptedCount: number; awaitingReviewCount: number; activeRestrictionsCount: number;
    lateSubmissionsCount: number; summaryJson: unknown;
  }) {
    return prisma.dailyComplianceSummary.upsert({
      where: { reportingDate },
      create: { reportingDate, ...data, summaryJson: data.summaryJson as never },
      update: { ...data, generatedAt: new Date(), summaryJson: data.summaryJson as never },
    });
  },

  async markEmailSent(reportingDate: string, status: string) {
    await prisma.dailyComplianceSummary.update({
      where: { reportingDate },
      data: { emailSentAt: new Date(), emailStatus: status },
    });
  },

  async listRecent(limit = 30) {
    return prisma.dailyComplianceSummary.findMany({
      orderBy: { reportingDate: "desc" },
      take: limit,
    });
  },
};

// ─── Notification Helpers ─────────────────────────────────────────────────

export const complianceNotify = {
  async notifyDriver(driverUserId: string, n: { type: string; title: string; body: string; dedupeKey: string }): Promise<void> {
    try {
      await prisma.notification.create({ data: { userId: driverUserId, ...n } });
    } catch (e) {
      if (!p2002(e)) throw e; // silently skip duplicate
    }
  },

  async notifyAdmins(n: { type: string; title: string; body: string; dedupeKey: string }): Promise<void> {
    const suppressNoViolation = process.env.COMPLIANCE_NOTIFY_NO_VIOLATION === "false";
    if (suppressNoViolation && n.type === "compliance_no_violation") return;
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    for (const a of admins) {
      try {
        await prisma.notification.create({ data: { userId: a.id, ...n, dedupeKey: `${n.dedupeKey}:${a.id}` } });
      } catch (e) {
        if (!p2002(e)) throw e;
      }
    }
  },
};

// ─── Driver Users Repo ─────────────────────────────────────────────────────

export async function getActiveDriverUsers(): Promise<{ userId: string; odooEmployeeId: number }[]> {
  const rows = await prisma.user.findMany({
    where: { role: "DRIVER", status: "ACTIVE", odooEmployeeId: { not: null } },
    select: { id: true, odooEmployeeId: true },
  });
  return rows.map(u => ({ userId: u.id, odooEmployeeId: u.odooEmployeeId as number }));
}

