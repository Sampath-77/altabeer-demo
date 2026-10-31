import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export interface Storage { put(data: Buffer, ext: string): Promise<string>; get(key: string): Promise<Buffer> }
/** Private local storage (dev / single server). Swap for a private bucket + signed URLs in production. Files are never served statically. */
export const localStorage_ = (root = process.env.STORAGE_PATH ?? "./.storage"): Storage => ({
  async put(data, ext) {
    const key = `${randomUUID()}.${ext}`; await fs.mkdir(root, { recursive: true }); await fs.writeFile(path.join(root, key), data); return key;
  },
  async get(key) { if (!/^[\w-]+\.\w+$/.test(key)) throw new Error("bad key"); return fs.readFile(path.join(root, key)); },
});
