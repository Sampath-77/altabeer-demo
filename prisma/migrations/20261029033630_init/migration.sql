-- CreateEnum
CREATE TYPE "Role" AS ENUM ('DRIVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "FineWorkflow" AS ENUM ('NEW', 'REVIEW_REQUIRED', 'APPROVED', 'ACK_PENDING', 'ACKNOWLEDGED', 'PAYMENT_PENDING', 'PAID_AWAITING_VERIFICATION', 'UNDER_REVIEW', 'DISPUTED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OcrStatus" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'AMBIGUOUS', 'NO_ASSIGNMENT', 'OVERLAPPING_ASSIGNMENT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "odooEmployeeId" INTEGER,
    "odooUserId" INTEGER,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fine" (
    "id" TEXT NOT NULL,
    "odooRecordId" INTEGER,
    "fineReference" TEXT,
    "issuingAuthority" TEXT,
    "violationAt" TIMESTAMP(3),
    "noticeReceivedAt" TIMESTAMP(3),
    "plateRaw" TEXT,
    "plateNormalized" TEXT,
    "plateEmirate" TEXT,
    "plateCode" TEXT,
    "vehicleOdooId" INTEGER,
    "driverOdooId" INTEGER,
    "vendorOdooId" INTEGER,
    "assignmentEvidence" JSONB,
    "amount" DECIMAL(12,2),
    "additionalPenalty" DECIMAL(12,2),
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "deadline" TIMESTAMP(3),
    "deadlineSource" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "workflow" "FineWorkflow" NOT NULL DEFAULT 'REVIEW_REQUIRED',
    "reviewReasons" TEXT[],
    "evidenceKeys" TEXT[],
    "description" TEXT,
    "vehicleMakeModel" TEXT,
    "duplicateOfId" TEXT,
    "manualOverride" BOOLEAN NOT NULL DEFAULT false,
    "rejectedReason" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "paymentEvidenceKeys" TEXT[],
    "paymentClaimedAmount" DECIMAL(12,2),
    "paymentReference" TEXT,
    "paymentVerifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedReason" TEXT,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "lastEscalatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OcrJob" (
    "id" TEXT NOT NULL,
    "fineId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "provider" TEXT,
    "status" "OcrStatus" NOT NULL DEFAULT 'QUEUED',
    "rawText" TEXT,
    "fields" JSONB,
    "confidence" JSONB,
    "errors" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "OcrJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fineId" TEXT,
    "readAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "fineId" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "templateRef" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "providerResponse" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "odooRecordId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "resource" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("resource")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseSubmission" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "odooExpenseId" INTEGER,
    "attached" BOOLEAN NOT NULL DEFAULT false,
    "lastStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_loginId_key" ON "User"("loginId");

-- CreateIndex
CREATE UNIQUE INDEX "User_odooEmployeeId_key" ON "User"("odooEmployeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Fine_odooRecordId_key" ON "Fine"("odooRecordId");

-- CreateIndex
CREATE INDEX "Fine_plateNormalized_idx" ON "Fine"("plateNormalized");

-- CreateIndex
CREATE INDEX "Fine_vehicleOdooId_violationAt_idx" ON "Fine"("vehicleOdooId", "violationAt");

-- CreateIndex
CREATE INDEX "Fine_workflow_deadline_idx" ON "Fine"("workflow", "deadline");

-- CreateIndex
CREATE INDEX "Fine_fineReference_issuingAuthority_idx" ON "Fine"("fineReference", "issuingAuthority");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_dedupeKey_key" ON "NotificationLog"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "SyncOutbox_idempotencyKey_key" ON "SyncOutbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncOutbox_status_nextAttemptAt_idx" ON "SyncOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseSubmission_idempotencyKey_key" ON "ExpenseSubmission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExpenseSubmission_userId_idx" ON "ExpenseSubmission"("userId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OcrJob" ADD CONSTRAINT "OcrJob_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "Fine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
