import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";

export interface Storage { put(data: Buffer, ext: string): Promise<string>; get(key: string): Promise<Buffer> }

// Process-level in-memory cache to guarantee instant retrieval across requests
const memCache = new Map<string, Buffer>();

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

/** Robust storage adapter with multi-directory discovery and process memory cache. */
export const localStorage_ = (root = (process.env.STORAGE_PATH || "./.storage")): Storage => ({
  async put(data, ext) {
    const key = `${randomUUID()}.${ext}`;
    memCache.set(key, data);
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
  async get(key) {
    if (!/^[\w-]+\.\w+$/.test(key)) throw new Error("bad key");
    if (memCache.has(key)) return memCache.get(key)!;
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
    throw new Error(`File ${key} not found in any storage directory`);
  },
});
