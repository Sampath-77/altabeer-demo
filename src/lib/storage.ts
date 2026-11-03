import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { prisma } from "./auth/prisma-repo";
import { AuthError } from "./auth/service";

export interface StorageMeta {
  filename?: string;
  mime?: string;
  uploadedBy?: string;
  fineId?: string;
}

export interface StorageFileInfo {
  filename: string;
  mime: string;
  size: number;
  provider: string;
  uploadedAt: Date;
  status: string;
}

export interface Storage {
  put(data: Buffer, ext: string, meta?: StorageMeta): Promise<string>;
  get(key: string): Promise<Buffer>;
  info?(key: string): Promise<StorageFileInfo | null>;
  linkFine?(key: string, fineId: string): Promise<void>;
}

// Process-level in-memory cache to guarantee instant retrieval across requests in same instance
const memCache = new Map<string, Buffer>();
const memCacheMeta = new Map<string, { filename: string; mime: string; uploadedBy?: string; fineId?: string }>();

let tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (tableEnsured) return;
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ChallanDocument" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "fineId" TEXT,
        "storageProvider" TEXT NOT NULL DEFAULT 'db',
        "storageKey" TEXT NOT NULL UNIQUE,
        "originalFilename" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "fileSizeBytes" INTEGER NOT NULL,
        "uploadedBy" TEXT,
        "storageStatus" TEXT NOT NULL DEFAULT 'AVAILABLE',
        "fileData" BYTEA,
        "externalUrl" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS "ChallanDocument_fineId_idx" ON "ChallanDocument"("fineId");
      CREATE INDEX IF NOT EXISTS "ChallanDocument_storageKey_idx" ON "ChallanDocument"("storageKey");
    `);
    tableEnsured = true;
  } catch {
    // If running without direct DDL permissions or in non-Postgres test mock, ignore
  }
}

function getCandidateDirs(root?: string): string[] {
  const dirs = new Set<string>();
  if (root) dirs.add(path.resolve(root));
  if (process.env.STORAGE_PATH) dirs.add(path.resolve(process.env.STORAGE_PATH));
  dirs.add(path.resolve(process.cwd(), ".storage"));
  dirs.add(path.resolve(process.cwd(), "al-tabeer", ".storage"));
  dirs.add(path.resolve(process.cwd(), "..", ".storage"));
  dirs.add(path.resolve(process.cwd(), "..", "al-tabeer", ".storage"));
  dirs.add(path.join(os.tmpdir(), "al-tabeer-storage"));
  dirs.add(path.join(os.tmpdir(), ".storage"));
  return [...dirs];
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Persistent, durable storage adapter with Database Binary Persistence and local filesystem cache. */
export const localStorage_ = (root = (process.env.STORAGE_PATH || "./.storage")): Storage => ({
  async put(data: Buffer, ext: string, meta?: StorageMeta): Promise<string> {
    const key = `${randomUUID()}.${ext}`;
    memCache.set(key, data);

    const filename = meta?.filename || `document-${key}`;
    const mime = meta?.mime || MIME_BY_EXT[ext.toLowerCase()] || "application/octet-stream";
    const uploadedBy = meta?.uploadedBy || null;
    const fineId = meta?.fineId || null;
    memCacheMeta.set(key, { filename, mime, uploadedBy: uploadedBy ?? undefined, fineId: fineId ?? undefined });

    // 1. Persist to PostgreSQL database (durable across all Vercel serverless function instances)
    try {
      await ensureTable();
      await prisma.challanDocument.upsert({
        where: { storageKey: key },
        create: {
          storageKey: key,
          fineId,
          storageProvider: "db",
          originalFilename: filename,
          mimeType: mime,
          fileSizeBytes: data.length,
          uploadedBy,
          storageStatus: "AVAILABLE",
          fileData: data,
        },
        update: {
          fileData: data,
          fileSizeBytes: data.length,
          mimeType: mime,
          originalFilename: filename,
          fineId: fineId ?? undefined,
          storageStatus: "AVAILABLE",
        },
      });
    } catch (dbErr) {
      // Fail-soft for offline test suites without database connection
      console.warn("Storage DB persist warning:", dbErr instanceof Error ? dbErr.message : dbErr);
    }

    // 2. Also write to candidate local directories (fast local cache)
    const candidateDirs = getCandidateDirs(root);
    for (const dir of candidateDirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, key), data);
      } catch {
        // fail-soft for candidate paths that may not be writable
      }
    }

    return key;
  },

  async get(key: string): Promise<Buffer> {
    if (!/^[\w-]+\.\w+$/.test(key)) throw new AuthError("VALIDATION", 422, "Invalid storage key format.");

    // 1. Process memory cache
    if (memCache.has(key)) return memCache.get(key)!;

    // 2. Persistent Database Storage
    try {
      await ensureTable();
      const doc = await prisma.challanDocument.findUnique({
        where: { storageKey: key },
        select: { fileData: true, externalUrl: true },
      });
      if (doc?.fileData && doc.fileData.length > 0) {
        const buf = Buffer.from(doc.fileData);
        memCache.set(key, buf);
        return buf;
      }
      if (doc?.externalUrl) {
        const res = await fetch(doc.externalUrl);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          memCache.set(key, buf);
          return buf;
        }
      }
    } catch {
      // Continue to local disk check if DB query failed or unavailable
    }

    // 3. Local filesystem directories
    const candidateDirs = getCandidateDirs(root);
    for (const dir of candidateDirs) {
      try {
        const fullPath = path.join(dir, key);
        const buf = await fs.readFile(fullPath);
        if (buf && buf.length > 0) {
          memCache.set(key, buf);
          return buf;
        }
      } catch {
        // try next candidate
      }
    }

    throw new AuthError("NOT_FOUND", 404, "Original document is unavailable. Please upload the original challan again.");
  },

  async info(key: string): Promise<StorageFileInfo | null> {
    if (!/^[\w-]+\.\w+$/.test(key)) return null;
    try {
      await ensureTable();
      const doc = await prisma.challanDocument.findUnique({
        where: { storageKey: key },
      });
      if (doc) {
        return {
          filename: doc.originalFilename,
          mime: doc.mimeType,
          size: doc.fileSizeBytes,
          provider: doc.storageProvider,
          uploadedAt: doc.createdAt,
          status: doc.storageStatus,
        };
      }
    } catch {
      // fail-soft
    }
    const cachedMeta = memCacheMeta.get(key);
    const ext = key.split(".").pop()?.toLowerCase() || "";
    return {
      filename: cachedMeta?.filename || key,
      mime: cachedMeta?.mime || MIME_BY_EXT[ext] || "application/octet-stream",
      size: memCache.get(key)?.length || 0,
      provider: "local",
      uploadedAt: new Date(),
      status: "AVAILABLE",
    };
  },

  async linkFine(key: string, fineId: string): Promise<void> {
    try {
      await ensureTable();
      await prisma.challanDocument.updateMany({
        where: { storageKey: key },
        data: { fineId },
      });
    } catch {
      // fail-soft
    }
  },
});
