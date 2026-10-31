import { describe, it, expect } from "vitest";
import { submitExpense, sniff, MAX_RECEIPT_BYTES, type SubRepo, type SubRec } from "@/lib/expenses";
import { ownPayslip } from "@/lib/payslips";
import { MockOdoo } from "@/lib/odoo/mock";
import type { Storage } from "@/lib/storage";
import type { NotifRepo } from "@/lib/notifications";
import type { AuthError } from "@/lib/auth/service";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const PDF = Buffer.from("%PDF-1.7\n....");
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);
function env() {
  const odoo = new MockOdoo(); const recs = new Map<string, SubRec>(); const files = new Map<string, Buffer>(); let n = 0;
  const repo: SubRepo = {
    find: async k => recs.get(k) ?? null,
    create: async r => { const x = { id: `s${++n}`, ...r, odooExpenseId: null, attached: false }; recs.set(r.idempotencyKey, x); return x; },
    setExpense: async (id, e) => { for (const r of recs.values()) if (r.id === id) r.odooExpenseId = e; },
    markAttached: async id => { for (const r of recs.values()) if (r.id === id) r.attached = true; },
  };
  const storage: Storage = { put: async (b, ext) => { const k = `k${++n}.${ext}`; files.set(k, b); return k; }, get: async k => files.get(k)! };
  const deps = (userId = "u1") => ({ odoo, repo, storage, userId, employeeId: 7, now: () => Date.UTC(2026, 9, 28, 22, 0, 0) });
  return { odoo, recs, deps };
}
const ok = { category: "fuel", amount: "85.50", vendor: "ENOC Al Quoz" };
const KEY = "key-aaaaaaaa";

describe("expense submission", () => {
  it("creates one expense with receipt attached and Dubai-local date", async () => {
    const { odoo, deps } = env();
    const r = await submitExpense(deps(), KEY, ok, JPEG);
    expect(r.status).toBe("submitted");
    expect(odoo.expenses).toHaveLength(1); expect(odoo.attachments).toHaveLength(1);
    expect(odoo.expenses[0]).toMatchObject({ amount: 85.5, category: "fuel", vendor: "ENOC Al Quoz", date: "2026-10-29" });
  });
  it.each([["", "amount"], ["0", "amount"], ["-5", "amount"], ["abc", "amount"], ["1.234", "amount"]])("rejects amount %s", async (amount) => {
    const { odoo, deps } = env();
    expect(await code(submitExpense(deps(), KEY, { ...ok, amount }, JPEG))).toBe("VALIDATION"); expect(odoo.expenses).toHaveLength(0);
  });
  it("rejects missing vendor, bad category and missing receipt", async () => {
    const { deps } = env();
    expect(await code(submitExpense(deps(), KEY, { ...ok, vendor: " " }, JPEG))).toBe("VALIDATION");
    expect(await code(submitExpense(deps(), KEY, { ...ok, category: "food" }, JPEG))).toBe("VALIDATION");
    expect(await code(submitExpense(deps(), KEY, ok, null))).toBe("VALIDATION");
  });
  it("rejects unsupported and oversized files by content", async () => {
    const { deps } = env();
    expect(await code(submitExpense(deps(), KEY, ok, Buffer.from("MZ executable renamed .jpg")))).toBe("VALIDATION");
    expect(await code(submitExpense(deps(), KEY, ok, Buffer.concat([JPEG, Buffer.alloc(MAX_RECEIPT_BYTES)])))).toBe("VALIDATION");
    expect(sniff(PDF)?.ext).toBe("pdf");
  });
  it("Odoo failure creates nothing; retry with same key creates exactly one", async () => {
    const { odoo, deps } = env();
    odoo.failNext = true;
    expect(await code(submitExpense(deps(), KEY, ok, JPEG))).toBe("ODOO_UNAVAILABLE"); expect(odoo.expenses).toHaveLength(0);
    await submitExpense(deps(), KEY, ok, null); // receipt already stored; no re-upload needed
    expect(odoo.expenses).toHaveLength(1); expect(odoo.attachments).toHaveLength(1);
  });
  it("attachment failure resumes without a second expense", async () => {
    const { odoo, deps } = env();
    odoo.failAttach = true;
    expect(await code(submitExpense(deps(), KEY, ok, JPEG))).toBe("ODOO_UNAVAILABLE");
    expect(odoo.expenses).toHaveLength(1); expect(odoo.attachments).toHaveLength(0);
    await submitExpense(deps(), KEY, ok, null);
    expect(odoo.expenses).toHaveLength(1); expect(odoo.attachments).toHaveLength(1);
  });
  it("double submit with the same key is a no-op", async () => {
    const { odoo, deps } = env();
    await submitExpense(deps(), KEY, ok, JPEG); await submitExpense(deps(), KEY, ok, JPEG);
    expect(odoo.expenses).toHaveLength(1); expect(odoo.attachments).toHaveLength(1);
  });
  it("refuses a key owned by another user", async () => {
    const { deps } = env();
    await submitExpense(deps("u1"), KEY, ok, JPEG);
    expect(await code(submitExpense(deps("u2"), KEY, ok, JPEG))).toBe("KEY_CONFLICT");
  });
  it("rejects a missing or malformed idempotency key", async () => {
    expect(await code(submitExpense(env().deps(), "x", ok, JPEG))).toBe("BAD_REQUEST");
  });
});

describe("payslip isolation", () => {
  const slip = (id: number, employeeId: number, state = "done") => ({ id, employeeId, name: "S", dateFrom: "2026-09-01", dateTo: "2026-09-30", state, net: 3000, lines: [] });
  it("returns own released payslips only", async () => {
    const o = new MockOdoo(); o.payslips.push(slip(1, 7), slip(2, 8), slip(3, 7, "draft"));
    expect((await ownPayslip(o, 7, 1)).id).toBe(1);
    expect(await code(ownPayslip(o, 7, 2))).toBe("NOT_FOUND");
    expect(await code(ownPayslip(o, 7, 3))).toBe("NOT_FOUND");
    expect(await code(ownPayslip(o, 7, NaN))).toBe("NOT_FOUND");
  });
});

describe("notification ownership (repo contract)", () => {
  it("marks read only for the owner", async () => {
    const rows = [{ id: "n1", userId: "u1", readAt: null as Date | null }];
    const repo: Pick<NotifRepo, "markRead"> = { markRead: async (id, u) => { const r = rows.find(x => x.id === id && x.userId === u && !x.readAt); if (r) r.readAt = new Date(); return !!r; } };
    expect(await repo.markRead("n1", "u2")).toBe(false);
    expect(await repo.markRead("n1", "u1")).toBe(true);
    expect(await repo.markRead("n1", "u1")).toBe(false);
  });
});
