import { describe, it, expect } from "vitest";
import { dailyReport, vendorReport, vehicleReport, driverReport, overdueReport, resolutionReport, unmatchedReport, duplicatesReport, ocrReport, toCsv, dubaiDay, dubaiDayRange, type Names } from "@/lib/reports";
import { validateLoginId, validatePassword, generatePassword } from "@/lib/accounts";
import { csrfAllowed, securityHeaders } from "@/lib/csrf";
import { redact } from "@/lib/log";
import { login, refresh, AuthError, type AuthRepo, type UserRec, type RefreshRec, type AuthConfig } from "@/lib/auth/service";
import { hashPassword } from "@/lib/auth/password";
import type { FineRec } from "@/lib/fines/pipeline";
import { DAY } from "@/lib/fines/workflow";

const NOW = Date.UTC(2026, 10, 1, 8, 0, 0); // 1 Nov 2026 12:00 Dubai
const names: Names = { vendor: id => (id == null ? "" : `V${id}`), vehicle: id => (id == null ? "" : `Car${id}`), driver: id => (id == null ? "" : `D${id}`) };
const fine = (o: Partial<FineRec> = {}): FineRec => ({ id: "f1", fineReference: "R1", issuingAuthority: "RTA", violationAt: new Date(NOW - 3 * DAY), noticeReceivedAt: new Date(NOW - 1000), plateRaw: "A 1", plateNormalized: "A1", plateEmirate: null, plateCode: "A", vehicleOdooId: 1, driverOdooId: 10, vendorOdooId: 100, assignmentEvidence: null, amount: 500, additionalPenalty: null, deadline: null, deadlineSource: null, matchStatus: "MATCHED", workflow: "PAYMENT_PENDING", reviewReasons: [], evidenceKeys: [], description: null, vehicleMakeModel: null, duplicateOfId: null, manualOverride: false, rejectedReason: null, amountPaid: 0, escalationLevel: 0, ...o });
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);

describe("reports", () => {
  it("daily: counts fines entered that Dubai day, not by violation date; excludes rejected", () => {
    const rows = [fine({ id: "a", amount: 100 }), fine({ id: "b", amount: 50, violationAt: new Date(NOW - 400 * DAY) }), fine({ id: "c", workflow: "REJECTED" }), fine({ id: "d", noticeReceivedAt: new Date(NOW - 3 * DAY) }), fine({ id: "e", workflow: "REVIEW_REQUIRED", vehicleOdooId: 2, amount: 25 })];
    const t = dailyReport(rows, "2026-11-01", NOW, names);
    expect(t.summary).toMatchObject({ recordedCount: 3, recordedAmount: 175, vehiclesAffected: 2, needingManualReview: 1, newUnresolved: 2 }); expect(t.rows).toHaveLength(3);
  });
  it("day boundaries use Dubai time (UTC+4)", () => { expect(dubaiDay(Date.UTC(2026, 10, 1, 20, 30))).toBe("2026-11-02"); expect(dubaiDayRange("2026-11-01").from.toISOString()).toBe("2026-10-31T20:00:00.000Z"); });
  it("vendor and vehicle totals count each fine once and separate the amounts", () => {
    const rows = [fine({ id: "a", amount: 100, additionalPenalty: 20, amountPaid: 50 }), fine({ id: "b", amount: 200, vendorOdooId: 100 }), fine({ id: "c", amount: 300, vendorOdooId: 101, vehicleOdooId: 2 }), fine({ id: "d", vendorOdooId: null, amount: 40 }), fine({ id: "x", workflow: "REVIEW_REQUIRED", amount: 999 }), fine({ id: "y", workflow: "REJECTED", amount: 999 })];
    const v = vendorReport(rows, NOW, names); expect(v.rows.reduce((s, r) => s + Number(r.count), 0)).toBe(4); expect(v.rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(640);
    const a = v.rows.find(r => r.name === "V100")!; expect(a).toMatchObject({ count: 2, amount: 300, penalty: 20, paid: 50, outstanding: 270 }); expect(v.rows.find(r => r.name === "Not resolved")!.count).toBe(1);
    expect(vehicleReport(rows, NOW, names).rows.find(r => r.name === "Car2")!.count).toBe(1);
  });
  it("closed fines contribute to totals but not to outstanding", () => { const v = vendorReport([fine({ workflow: "CLOSED", amountPaid: 500 })], NOW, names); expect(v.rows[0]).toMatchObject({ amount: 500, paid: 500, outstanding: 0 }); });
  it("overdue: only unresolved fines with a verified deadline in the past", () => {
    const rows = [fine({ id: "a", deadline: new Date(NOW - 2 * DAY), deadlineSource: "notice", escalationLevel: 1 }), fine({ id: "b", deadline: new Date(NOW - 2 * DAY), deadlineSource: null }), fine({ id: "c", deadline: new Date(NOW + DAY), deadlineSource: "notice" }), fine({ id: "d", workflow: "CLOSED", deadline: new Date(NOW - DAY), deadlineSource: "notice" })];
    const t = overdueReport(rows, NOW, names); expect(t.rows).toHaveLength(1); expect(t.rows[0]).toMatchObject({ daysOverdue: 2, escalation: 1 });
  });
  it("resolution time: average and median in days over closed fines only", () => {
    const mk = (id: string, d: number) => fine({ id, workflow: "CLOSED", noticeReceivedAt: new Date(NOW - d * DAY), closedAt: new Date(NOW) });
    expect(resolutionReport([mk("a", 2), mk("b", 4), mk("c", 9), fine({ id: "o" })], names).summary).toEqual({ closedFines: 3, averageDays: 5, medianDays: 4 });
    expect(resolutionReport([], names).summary).toEqual({ closedFines: 0, averageDays: null, medianDays: null });
  });
  it("driver report follows the historical assignment and warns it is not a finding of responsibility", () => {
    const t = driverReport([fine({ id: "a", driverOdooId: 11 }), fine({ id: "b", driverOdooId: 10 })], names); expect(t.rows.map(r => r.driver)).toEqual(["D10", "D11"]); expect(t.note).toMatch(/not a finding of responsibility/);
  });
  it("unmatched and duplicate reports", () => {
    expect(unmatchedReport([fine({ id: "a" }), fine({ id: "b", matchStatus: "AMBIGUOUS", reviewReasons: ["PLATE_INCOMPLETE"] }), fine({ id: "c", vehicleOdooId: null }), fine({ id: "d", matchStatus: "UNMATCHED", workflow: "REJECTED" })], names).rows).toHaveLength(2);
    expect(duplicatesReport([fine({ duplicateOfId: "zz" }), fine({ id: "q" })], names).rows).toHaveLength(1);
  });
  it("OCR report states a correction rate, not accuracy", () => { const t = ocrReport({ processed: 8, failed: 1, corrected: 2 }); expect(t.rows[3].value).toBe("25%"); expect(t.note).toMatch(/not measured/); expect(ocrReport({ processed: 0, failed: 0, corrected: 0 }).rows[3].value).toBeNull(); });
});
describe("CSV export", () => {
  it("quotes, escapes and neutralises spreadsheet formulas", () => {
    const csv = toCsv({ title: "t", columns: [{ key: "a", label: "A, B" }, { key: "b", label: "B" }], rows: [{ a: 'say "hi"', b: "=HYPERLINK(\"http://evil\")" }, { a: "line1\nline2", b: -5 }, { a: "+1", b: null }] });
    expect(csv.startsWith("\uFEFF")).toBe(true); expect(csv).toContain('"A, B",B'); expect(csv).toContain('"say ""hi"""'); expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain('"line1\nline2",-5'); expect(csv).toContain("'+1,");
  });
});
describe("accounts", () => {
  it("validates login IDs and passwords", () => {
    expect(validateLoginId("drv_001")).toBeNull(); expect(validateLoginId("a b")).not.toBeNull(); expect(validateLoginId("ab")).not.toBeNull();
    expect(validatePassword("short1")).not.toBeNull(); expect(validatePassword("onlyletterslong")).not.toBeNull(); expect(validatePassword("drv001abcdef1234", "DRV001")).not.toBeNull(); expect(validatePassword("Correct-horse-9")).toBeNull();
  });
  it("generated passwords are valid and different each time", () => { const a = generatePassword(), b = generatePassword(); expect(validatePassword(a)).toBeNull(); expect(a).not.toBe(b); expect(a).toHaveLength(16); });
});
describe("request hardening", () => {
  const h = "app.example";
  it("blocks cross-site state changes, allows same-origin and safe methods", () => {
    const ok = (m: string, origin: string | null, sfs: string | null = null, allowed: string[] = []) => csrfAllowed({ method: m, origin, secFetchSite: sfs, host: h, allowed });
    expect(ok("POST", "https://evil.example")).toBe(false); expect(ok("POST", "https://app.example")).toBe(true); expect(ok("POST", null, "cross-site")).toBe(false); expect(ok("POST", null, "same-origin")).toBe(true);
    expect(ok("GET", "https://evil.example")).toBe(true); expect(ok("POST", "https://admin.example", null, ["https://admin.example"])).toBe(true); expect(ok("POST", "not a url")).toBe(false);
  });
  it("sets strict security headers; HSTS only in production", () => {
    const p = securityHeaders(true); expect(p["Content-Security-Policy"]).toContain("frame-ancestors 'none'"); expect(p["Content-Security-Policy"]).not.toContain("unsafe-eval"); expect(p["Strict-Transport-Security"]).toBeTruthy(); expect(securityHeaders(false)["Strict-Transport-Security"]).toBeUndefined();
  });
  it("log redaction hides secrets by key name at any depth", () => {
    expect(redact({ ok: 1, password: "p", nested: { apiKey: "k", Authorization: "Bearer x", list: [{ token: "t", fine: 5 }] } })).toEqual({ ok: 1, password: "[redacted]", nested: { apiKey: "[redacted]", Authorization: "[redacted]", list: [{ token: "[redacted]", fine: 5 }] } });
  });
});
describe("employee gate on sign-in and refresh", () => {
  const cfg: AuthConfig = { secret: "x".repeat(40), accessTtlSec: 900, refreshTtlSec: 86400, maxFailures: 5, lockMs: 60_000 };
  async function repo() {
    const u: UserRec = { id: "u1", loginId: "d1", passwordHash: await hashPassword("correct-horse1"), role: "DRIVER", status: "ACTIVE", failedLogins: 0, lockedUntil: null, odooEmployeeId: 7 }; const rt = new Map<string, RefreshRec>(); let n = 0;
    const r: AuthRepo = { findByLoginId: async l => (l === "d1" ? u : null), findById: async () => u, setFailures: async () => {}, createRefresh: async x => { rt.set(x.tokenHash, { id: `r${++n}`, userId: x.userId, expiresAt: x.expiresAt, revokedAt: null }); }, findRefresh: async h => rt.get(h) ?? null, revokeRefresh: async id => { for (const x of rt.values()) if (x.id === id) x.revokedAt = new Date(); }, revokeAllForUser: async () => { for (const x of rt.values()) x.revokedAt = new Date(); } };
    return { r, rt };
  }
  const gate = (active: boolean) => async () => { if (!active) throw new AuthError("ACCOUNT_DISABLED", 403, "disabled"); };
  it("an employee archived in the ERP cannot sign in", async () => { const { r } = await repo(); expect(await code(login(r, cfg, "d1", "correct-horse1", Date.now(), gate(false)))).toBe("ACCOUNT_DISABLED"); expect(await code(login(r, cfg, "d1", "correct-horse1", Date.now(), gate(true)))).toBe("ok"); });
  it("refresh also re-checks and then revokes every session", async () => {
    const { r, rt } = await repo(); const s = await login(r, cfg, "d1", "correct-horse1", Date.now(), gate(true));
    expect(await code(refresh(r, cfg, s.refreshToken, Date.now(), gate(false)))).toBe("ACCOUNT_DISABLED"); expect([...rt.values()].every(x => x.revokedAt)).toBe(true);
  });
  it("a wrong password never reaches the gate", async () => { const { r } = await repo(); let called = false; await code(login(r, cfg, "d1", "wrong", Date.now(), async () => { called = true; })); expect(called).toBe(false); });
});
