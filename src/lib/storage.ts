import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

export interface Storage { put(data: Buffer, ext: string): Promise<string>; get(key: string): Promise<Buffer> }

// Process-level in-memory cache to guarantee instant retrieval in serverless / ephemeral environments
const memCache = new Map<string, Buffer>();

function resolveStorageDir(): string {
  if (process.env.STORAGE_PATH) return process.env.STORAGE_PATH;
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === "production") {
    return path.join(os.tmpdir(), "al-tabeer-storage");
  }
  return "./.storage";
}

/** Private local storage (dev / single server / serverless). */
export const localStorage_ = (root = resolveStorageDir()): Storage => ({
  async put(data, ext) {
    const key = `${randomUUID()}.${ext}`;
    memCache.set(key, data);
    try {
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, key), data);
    } catch {
      // Fallback to os.tmpdir() if root path is read-only (standard on serverless platforms like Vercel)
      try {
        const fallback = path.join(os.tmpdir(), "al-tabeer-storage");
        await fs.mkdir(fallback, { recursive: true });
        await fs.writeFile(path.join(fallback, key), data);
      } catch {
        // In-memory fallback if disk is completely unavailable
      }
    }
    return key;
  },
  async get(key) {
    if (!/^[\w-]+\.\w+$/.test(key)) throw new Error("bad key");
    if (memCache.has(key)) return memCache.get(key)!;
    try {
      return await fs.readFile(path.join(root, key));
    } catch {
      const fallback = path.join(os.tmpdir(), "al-tabeer-storage");
      return await fs.readFile(path.join(fallback, key));
    }
  },
});
