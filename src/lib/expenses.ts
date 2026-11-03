import { z } from "zod";
import type { OdooClient, OdooExpense, ReceiptFile } from "./odoo/types";
import type { Storage } from "./storage";
import { AuthError } from "./auth/service";

export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const ExpenseInput = z.object({
  category: z.enum(["fuel", "parking"]),
  amount: z.coerce.number().positive("Enter an amount greater than 0").max(50_000, "Amount is too large").refine(n => Math.round(n * 100) === n * 100 || Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimal places"),
  vendor: z.string().trim().min(1, "Enter the station or location").max(120),
});
export const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Detect type from file content, never from the client-supplied name or MIME. */
export function sniff(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (b.length > 12 && b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (b.length > 5 && b.subarray(0, 5).toString() === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  return null;
}
export interface SubRec { id: string; idempotencyKey: string; userId: string; receiptKey: string; odooExpenseId: number | null; attached: boolean }
export interface SubRepo {
  find(key: string): Promise<SubRec | null>;
  create(r: { idempotencyKey: string; userId: string; receiptKey: string }): Promise<SubRec>;
  setExpense(id: string, odooExpenseId: number): Promise<void>;
  markAttached(id: string): Promise<void>;
}
const odooErr = () => new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP could not complete this. Your receipt is saved. Tap Submit again to finish.");

export async function submitExpense(d: { odoo: OdooClient; repo: SubRepo; storage: Storage; userId: string; employeeId: number; now?: () => number },
  key: string, raw: unknown, file: Buffer | null): Promise<{ id: number; status: OdooExpense["status"] }> {
  if (!KEY_RE.test(key)) throw new AuthError("BAD_REQUEST", 400, "Missing idempotency key.");
  const parsed = ExpenseInput.safeParse(raw);
  if (!parsed.success) throw new AuthError("VALIDATION", 422, parsed.error.issues[0].message);
  let rec = await d.repo.find(key);
  if (rec && rec.userId !== d.userId) throw new AuthError("KEY_CONFLICT", 409, "This submission key is already used.");
  let kind: { mime: string; ext: string } | null = null;
  if (!rec) {
    if (!file || file.length === 0) throw new AuthError("VALIDATION", 422, "Attach a photo or PDF of the receipt.");
    if (file.length > MAX_RECEIPT_BYTES) throw new AuthError("VALIDATION", 422, "The receipt file is larger than 8 MB.");
    kind = sniff(file);
    if (!kind) throw new AuthError("VALIDATION", 422, "Unsupported file. Use a JPEG, PNG, WebP or PDF.");
    rec = await d.repo.create({ idempotencyKey: key, userId: d.userId, receiptKey: await d.storage.put(file, kind.ext) });
  }
  const dubaiDate = new Date((d.now?.() ?? Date.now()) + 4 * 3600_000).toISOString().slice(0, 10);
  let id = rec.odooExpenseId; let status: OdooExpense["status"] = "submitted";
  try {
    if (id == null) {
      const e = await d.odoo.createExpense({ employeeId: d.employeeId, ...parsed.data, date: dubaiDate });
      id = e.id; status = e.status; await d.repo.setExpense(rec.id, id);
    }
    if (!rec.attached) {
      const data = await d.storage.get(rec.receiptKey);
      const k = sniff(data)!;
      const f: ReceiptFile = { name: `receipt-${id}.${k.ext}`, mime: k.mime, data };
      await d.odoo.attachReceipt(id, f); await d.repo.markAttached(rec.id);
    }
  } catch (e) {
    console.error("submitExpense error:", e);
    if (e instanceof AuthError) throw e;
    throw odooErr();
  }
  return { id, status };
}
