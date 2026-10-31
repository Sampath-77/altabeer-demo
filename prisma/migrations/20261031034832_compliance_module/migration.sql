-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('VIOLATION', 'NO_VIOLATION');

-- CreateEnum
CREATE TYPE "ViolationCategory" AS ENUM ('SPEEDING', 'PARKING_VIOLATION', 'RED_LIGHT_VIOLATION', 'WRONG_PARKING', 'LANE_VIOLATION', 'VEHICLE_ACCIDENT', 'VEHICLE_DAMAGE', 'VEHICLE_INCIDENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'REVIEWED', 'CORRECTION_REQUESTED', 'AMENDED');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'OVERRIDDEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FlagResolutionReason" AS ENUM ('REPORT_SUBMITTED', 'SUBMITTED_EXTERNAL_CHANNEL', 'INCORRECT_REQUIREMENT', 'APPROVED_EXCEPTION', 'ADMIN_TEMPORARY_OVERRIDE', 'OTHER');

-- CreateTable
CREATE TABLE "DailyDriverReport" (
    "id" TEXT NOT NULL,
    "reportReference" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "odooEmployeeId" INTEGER NOT NULL,
    "reportingDate" TEXT NOT NULL,
    "shiftAttendanceId" INTEGER,
    "vehicleOdooId" INTEGER,
    "vehiclePlateSnapshot" TEXT,
    "vehicleModelSnapshot" TEXT,
    "reportType" "ReportType" NOT NULL,
    "violationCategory" "ViolationCategory",
    "violationDescription" TEXT,
    "violationLocation" TEXT,
    "violationDatetime" TIMESTAMP(3),
    "fineReference" TEXT,
    "reportedFineAmount" DECIMAL(12,2),
    "driverExplanation" TEXT,
    "declarationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "submissionStatus" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedLate" BOOLEAN NOT NULL DEFAULT false,
    "adminRemarks" TEXT,
    "correctionNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyDriverReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverReportAttachment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverReportAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverComplianceFlag" (
    "id" TEXT NOT NULL,
    "flagReference" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "odooEmployeeId" INTEGER NOT NULL,
    "reportingDate" TEXT NOT NULL,
    "flagType" TEXT NOT NULL DEFAULT 'MISSING_DAILY_REPORT',
    "reason" TEXT NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'ACTIVE',
    "adminEscalated" BOOLEAN NOT NULL DEFAULT false,
    "sourceReportId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionReason" "FlagResolutionReason",
    "resolutionRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverComplianceFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverComplianceExemption" (
    "id" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "odooEmployeeId" INTEGER NOT NULL,
    "reportingDate" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverComplianceExemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverComplianceAuditLog" (
    "id" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "odooEmployeeId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "relatedReportId" TEXT,
    "relatedFlagId" TEXT,
    "performedBy" TEXT NOT NULL,
    "performedByRole" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverComplianceAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyComplianceSummary" (
    "id" TEXT NOT NULL,
    "reportingDate" TEXT NOT NULL,
    "totalExpected" INTEGER NOT NULL,
    "totalSubmitted" INTEGER NOT NULL,
    "violationCount" INTEGER NOT NULL,
    "noViolationCount" INTEGER NOT NULL,
    "missingCount" INTEGER NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "exemptedCount" INTEGER NOT NULL,
    "awaitingReviewCount" INTEGER NOT NULL,
    "activeRestrictionsCount" INTEGER NOT NULL,
    "lateSubmissionsCount" INTEGER NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emailSentAt" TIMESTAMP(3),
    "emailStatus" TEXT,
    "summaryJson" JSONB,

    CONSTRAINT "DailyComplianceSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyDriverReport_reportReference_key" ON "DailyDriverReport"("reportReference");

-- CreateIndex
CREATE INDEX "DailyDriverReport_odooEmployeeId_reportingDate_idx" ON "DailyDriverReport"("odooEmployeeId", "reportingDate");

-- CreateIndex
CREATE INDEX "DailyDriverReport_reportingDate_idx" ON "DailyDriverReport"("reportingDate");

-- CreateIndex
CREATE INDEX "DailyDriverReport_submissionStatus_idx" ON "DailyDriverReport"("submissionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDriverReport_driverUserId_reportingDate_key" ON "DailyDriverReport"("driverUserId", "reportingDate");

-- CreateIndex
CREATE INDEX "DriverReportAttachment_reportId_idx" ON "DriverReportAttachment"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverComplianceFlag_flagReference_key" ON "DriverComplianceFlag"("flagReference");

-- CreateIndex
CREATE INDEX "DriverComplianceFlag_driverUserId_status_idx" ON "DriverComplianceFlag"("driverUserId", "status");

-- CreateIndex
CREATE INDEX "DriverComplianceFlag_odooEmployeeId_reportingDate_idx" ON "DriverComplianceFlag"("odooEmployeeId", "reportingDate");

-- CreateIndex
CREATE INDEX "DriverComplianceFlag_status_idx" ON "DriverComplianceFlag"("status");

-- CreateIndex
CREATE INDEX "DriverComplianceFlag_reportingDate_idx" ON "DriverComplianceFlag"("reportingDate");

-- CreateIndex
CREATE INDEX "DriverComplianceExemption_odooEmployeeId_reportingDate_idx" ON "DriverComplianceExemption"("odooEmployeeId", "reportingDate");

-- CreateIndex
CREATE UNIQUE INDEX "DriverComplianceExemption_driverUserId_reportingDate_key" ON "DriverComplianceExemption"("driverUserId", "reportingDate");

-- CreateIndex
CREATE INDEX "DriverComplianceAuditLog_driverUserId_createdAt_idx" ON "DriverComplianceAuditLog"("driverUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverComplianceAuditLog_action_idx" ON "DriverComplianceAuditLog"("action");

-- CreateIndex
CREATE INDEX "DriverComplianceAuditLog_relatedFlagId_idx" ON "DriverComplianceAuditLog"("relatedFlagId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyComplianceSummary_reportingDate_key" ON "DailyComplianceSummary"("reportingDate");

-- CreateIndex
CREATE INDEX "DailyComplianceSummary_reportingDate_idx" ON "DailyComplianceSummary"("reportingDate");

-- AddForeignKey
ALTER TABLE "DailyDriverReport" ADD CONSTRAINT "DailyDriverReport_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverReportAttachment" ADD CONSTRAINT "DriverReportAttachment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyDriverReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverComplianceFlag" ADD CONSTRAINT "DriverComplianceFlag_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverComplianceFlag" ADD CONSTRAINT "DriverComplianceFlag_sourceReportId_fkey" FOREIGN KEY ("sourceReportId") REFERENCES "DailyDriverReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverComplianceExemption" ADD CONSTRAINT "DriverComplianceExemption_driverUserId_fkey" FOREIGN KEY ("driverUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
