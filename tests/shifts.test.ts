import { describe, it, expect } from "vitest";
import { shiftService } from "@/lib/shifts";
import { MockOdoo } from "@/lib/odoo/mock";
import { createJson2Client } from "@/lib/odoo/json2";
import type { AuthError } from "@/lib/auth/service";

const T0 = Date.UTC(2026, 9, 28, 4, 0, 0);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);
function mk(now = T0) {
  const o = new MockOdoo(); o.employees.set(7, { id: 7, name: "Test Driver", active: true });
  let t = now; return { o, t: (n: number) => (t = n), svc: shiftService(o, 7, () => t) };
}
describe("shifts", () => {
  it("checks in, rejects duplicate, checks out, records duration", async () => {
    const { o, svc, t } = mk();
    const s = await svc.checkIn();
    expect(s.checkOut).toBeNull(); expect(o.attendance).toHaveLength(1);
    expect(await code(svc.checkIn())).toBe("ALREADY_CHECKED_IN"); expect(o.attendance).toHaveLength(1);
    t(T0 + 90 * 60000);
    expect((await svc.checkOut()).durationMinutes).toBe(90);
    expect((await svc.current()).open).toBe(false);
  });
  it("rejects check-out without an open shift", async () => { expect(await code(mk().svc.checkOut())).toBe("NO_OPEN_SHIFT"); });
  it("rejects inactive employees", async () => {
    const { o, svc } = mk(); o.employees.get(7)!.active = false;
    expect(await code(svc.checkIn())).toBe("EMPLOYEE_INACTIVE"); expect(o.attendance).toHaveLength(0);
  });
  it("surfaces Odoo failure and records nothing; retry then creates exactly one", async () => {
    const { o, svc } = mk();
    o.failNext = true; expect(await code(svc.checkIn())).toBe("ODOO_UNAVAILABLE"); expect(o.attendance).toHaveLength(0);
    await svc.checkIn(); expect(await code(svc.checkIn())).toBe("ALREADY_CHECKED_IN"); expect(o.attendance).toHaveLength(1);
  });
  it("warns about a stale open shift", async () => {
    const { svc, t } = mk(); await svc.checkIn(); t(T0 + 17 * 3600_000);
    expect((await svc.current()).staleWarning).toMatch(/over 16 hours/);
  });
  it("scopes history to the employee and orders newest first", async () => {
    const { o, svc, t } = mk(); await svc.checkIn(); t(T0 + 3600_000); await svc.checkOut(); t(T0 + 7200_000); await svc.checkIn();
    o.attendance.push({ id: 99, employeeId: 8, checkIn: new Date(T0).toISOString(), checkOut: null });
    const h = await svc.history(); expect(h).toHaveLength(2); expect(h[0].checkOut).toBeNull();
  });
  it("computes month stats in Dubai time", async () => {
    const { svc, t } = mk(); await svc.checkIn(); t(T0 + 2 * 3600_000); await svc.checkOut();
    expect(await svc.monthStats()).toEqual({ daysWorked: 1, hoursLogged: 2 });
  });
});
describe("JSON-2 adapter request shape (mocked fetch, not a live Odoo)", () => {
  it("sends auth headers, UTC datetimes, and maps HTTP errors", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/create")) return new Response("[5]");
      return new Response(JSON.stringify([{ id: 5, employee_id: [7, "x"], check_in: "2026-10-28 04:00:00", check_out: false }]));
    }) as unknown as typeof fetch;
    const c = createJson2Client("https://erp.example", "db1", "KEY", 1000, f);
    const a = await c.checkIn(7, new Date(T0));
    expect(calls[0].url).toBe("https://erp.example/json/2/hr.attendance/create");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("bearer KEY");
    expect(JSON.parse(calls[0].init.body as string).vals_list[0].check_in).toBe("2026-10-28 04:00:00");
    expect(a.checkIn).toBe("2026-10-28T04:00:00Z");
    const bad = createJson2Client("https://erp.example", "db1", "KEY", 1000, (async () => new Response("no", { status: 403 })) as unknown as typeof fetch);
    await expect(bad.openAttendance(7)).rejects.toThrow(/403/);
  });
});
