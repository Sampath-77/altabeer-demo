// Type interfaces for the compliance module — keep framework-agnostic.
import type { ReportType, ViolationCategory, ReportStatus, FlagStatus, FlagResolutionReason } from "@prisma/client";
export type { ReportType, ViolationCategory, ReportStatus, FlagStatus, FlagResolutionReason };

export interface ComplianceFlag {
  id: string;
  flagReference: string;
  driverUserId: string;
  odooEmployeeId: number;
  reportingDate: string;
  flagType: string;
  reason: string;
  status: FlagStatus;
  adminEscalated: boolean;
  sourceReportId: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionReason: FlagResolutionReason | null;
  resolutionRemarks: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyReport {
  id: string;
  reportReference: string;
  driverUserId: string;
  odooEmployeeId: number;
  reportingDate: string;
  vehicleOdooId: number | null;
  vehiclePlateSnapshot: string | null;
  vehicleModelSnapshot: string | null;
  reportType: ReportType;
  violationCategory: ViolationCategory | null;
  violationDescription: string | null;
  violationLocation: string | null;
  violationDatetime: Date | null;
  fineReference: string | null;
  reportedFineAmount: number | null;
  driverExplanation: string | null;
  declarationConfirmed: boolean;
  submissionStatus: ReportStatus;
  submittedLate: boolean;
  adminRemarks: string | null;
  correctionNote: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
}

export interface ReportAttachment {
  id: string;
  reportId: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: Date;
}

export interface ComplianceExemption {
  id: string;
  driverUserId: string;
  odooEmployeeId: number;
  reportingDate: string;
  reason: string;
  approvedBy: string;
  approvedAt: Date;
}

// Input for creating a new daily report
export interface CreateReportInput {
  reportingDate: string;
  reportType: ReportType;
  violationCategory?: ViolationCategory;
  violationDescription?: string;
  violationLocation?: string;
  violationDatetime?: string; // ISO
  fineReference?: string;
  reportedFineAmount?: number;
  driverExplanation?: string;
  declarationConfirmed?: boolean;
  vehicleOdooId?: number;
  vehiclePlateSnapshot?: string;
  vehicleModelSnapshot?: string;
  shiftAttendanceId?: number;
}

// Driver check-in eligibility result
export interface CheckInEligibility {
  eligible: boolean;
  activeFlag: ComplianceFlag | null;
}

// Status string used in admin daily report table
export type DailyReportRowStatus = "SUBMITTED" | "PENDING" | "MISSING" | "EXEMPTED";

// Row in the admin daily reports table (§21)
export interface DailyReportRow {
  driverUserId: string;
  odooEmployeeId: number;
  driverName: string;
  vehiclePlate: string | null;
  vehicleModel: string | null;
  vendorName: string | null;
  reportingDate: string;
  rowStatus: DailyReportRowStatus;
  report: DailyReport | null;
  attachmentCount: number;
  flagStatus: FlagStatus | null;
  exemption: ComplianceExemption | null;
}

