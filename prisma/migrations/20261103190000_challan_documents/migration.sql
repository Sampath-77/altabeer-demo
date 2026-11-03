-- CreateTable
CREATE TABLE IF NOT EXISTS "ChallanDocument" (
    "id" TEXT NOT NULL,
    "fineId" TEXT,
    "storageProvider" TEXT NOT NULL DEFAULT 'db',
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "storageStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "fileData" BYTEA,
    "externalUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallanDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChallanDocument_storageKey_key" ON "ChallanDocument"("storageKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChallanDocument_fineId_idx" ON "ChallanDocument"("fineId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChallanDocument_storageKey_idx" ON "ChallanDocument"("storageKey");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ChallanDocument_fineId_fkey'
    ) THEN
        ALTER TABLE "ChallanDocument" ADD CONSTRAINT "ChallanDocument_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "Fine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

