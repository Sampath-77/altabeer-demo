import { describe, it, expect } from "vitest";
import { dashboard, driverRows, driverDetail, vehicleRows, vendorRows, paging } from "@/lib/admin";
import { adminContext } from "@/lib/admin-ctx";
import { signToken } from "@/lib/auth/token";
import { MockOdoo } from "@/lib/odoo/mock";
import type { AuthError } from "@/lib/auth/service";

const NOW = Date.UTC(2026, 9, 28, 12, 0, 0), H = 3600_000;
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);
function seed() {
  const o = new MockOdoo();
  o.vendors.push({ id: 100, name: "Vendor A" }, { id: 101, name: "Vendor B" });
  o.vehicles.push({ id: 1, plate: "A 4827", model: "BMW X5", vendorId: 100, active: true }, { id: 2, plate: "B 1111", vendorId: 101, active: true }, { id: 3, plate: "C 0001", vendorId: 100, active: false });
  const emps: [number, string, boolean][] = [[1, "Ali", true], [2, "Bilal", true], [3, "Chen", true], [4, "Dev", false], [5, "Esa", true]];
  for (const [id, name, active] of emps) o.employees.set(id, { id, name, active });
  o.attendance.push(
    { id: 1, employeeId: 1, checkIn: new Date(NOW - 3 * H).toISOString(), checkOut: null },        // Ali in, 3h
    { id: 2, employeeId: 2, checkIn: new Date(NOW - 20 * H).toISOString(), checkOut: null },       // Bilal in, 20h => overdue
    { id: 3, employeeId: 3, checkIn: new Date(NOW - 30 * H).toISOString(), checkOut: new Date(NOW - 22 * H).toISOString() },
    { id: 4, employeeId: 4, checkIn: new Date(NOW - 2 * H).toISOString(), checkOut: null });       // inactive Dev with open row
  o.assignments.set(1, { vehicle: o.vehicles[0], assignment: { vehicleId: 1, employeeId: 1, from: "2026-01-01T00:00:00Z", to: null } });
  o.assignments.set(2, { vehicle: o.vehicles[1], assignment: { vehicleId: 2, employeeId: 2, from: "2026-01-01T00:00:00Z", to: null } });
  return o;
}
const pg = { page: 1, pageSize: 25 };

describe("dashboard metrics", () => {
  it("counts per the stated definitions", async () => {
    const d = await dashboard(seed(), NOW);
    expect(d.drivers).toEqual({ active: 4, inactive: 1, checkedIn: 2, checkedOut: 2, openOrOverdueShifts: 1 });
    expect(d.vehicles).toEqual({ total: 3, active: 2 }); expect(d.vendors.total).toBe(2);
    expect(d.fines.available).toBe(false); // no invented fine numbers
  });
  it("checked-out drivers are not counted as inactive; inactive open rows excluded from checked-in", async () => {
    const d = await dashboard(seed(), NOW);
    expect(d.drivers.checkedIn + d.drivers.checkedOut).toBe(d.drivers.active);
  });
  it("fails visibly when Odoo is down", async () => {
    const o = seed(); o.failNext = true; expect(await code(dashboard(o, NOW))).toBe("ODOO_UNAVAILABLE");
  });
});
describe("driver & shift monitoring", () => {
  it("returns shift, vehicle and vendor per driver", async () => {
    const r = await driverRows(seed(), { status: "active" }, pg, NOW);
    const ali = r.rows.find(x => x.name === "Ali")!;
    expect(ali.shift).toMatchObject({ state: "checked_in", durationMinutes: 180, overdue: false });
    expect(ali.vehicle?.plate).toBe("A 4827"); expect(ali.vendor?.name).toBe("Vendor A");
    expect(r.rows.find(x => x.name === "Bilal")!.shift.overdue).toBe(true);
    expect(r.rows.find(x => x.name === "Chen")!.shift).toMatchObject({ state: "checked_out", lastCheckOut: new Date(NOW - 22 * H).toISOString() });
    expect(r.rows.find(x => x.name === "Esa")!.vehicle).toBeNull();
  });
  it("filters by shift state, status, vendor, vehicle, search", async () => {
    const o = seed();
    expect((await driverRows(o, { shift: "in" }, pg, NOW)).rows.map(r => r.name)).toEqual(["Ali", "Bilal"]);
    expect((await driverRows(o, { shift: "out" }, pg, NOW)).rows.map(r => r.name)).toEqual(["Chen", "Esa"]);
    expect((await driverRows(o, { status: "inactive" }, pg, NOW)).rows.map(r => r.name)).toEqual(["Dev"]);
    expect((await driverRows(o, { status: "all" }, pg, NOW)).total).toBe(5);
    expect((await driverRows(o, { vendorId: 101 }, pg, NOW)).rows.map(r => r.name)).toEqual(["Bilal"]);
    expect((await driverRows(o, { vehicle: "4827" }, pg, NOW)).rows.map(r => r.name)).toEqual(["Ali"]);
    expect((await driverRows(o, { search: "chen" }, pg, NOW)).rows).toHaveLength(1);
    expect((await driverRows(o, { vendorId: 999 }, pg, NOW)).total).toBe(0);
  });
  it("paginates server-side without losing or duplicating rows", async () => {
    const o = seed();
    const a = await driverRows(o, { status: "all" }, { page: 1, pageSize: 2 }, NOW), b = await driverRows(o, { status: "all" }, { page: 2, pageSize: 2 }, NOW), c = await driverRows(o, { status: "all" }, { page: 3, pageSize: 2 }, NOW);
    expect(a.total).toBe(5); const names = [...a.rows, ...b.rows, ...c.rows].map(r => r.name);
    expect(new Set(names).size).toBe(5);
  });
  it("driver detail: 404 for unknown, history for known", async () => {
    const o = seed();
    expect(await code(driverDetail(o, 999, NOW))).toBe("NOT_FOUND");
    const d = await driverDetail(o, 1, NOW); expect(d.driver.name).toBe("Ali"); expect(d.shifts).toHaveLength(1);
  });
  it("clamps paging params", () => { expect(paging(new URL("http://x/?page=-3&pageSize=9999"))).toEqual({ page: 1, pageSize: 100 }); });
});
describe("vehicles & vendors", () => {
  it("lists vehicles with vendor and current driver; filters inactive", async () => {
    const o = seed();
    const r = await vehicleRows(o, {}, pg);
    expect(r.rows.map(v => v.plate)).toEqual(["A 4827", "B 1111"]);
    expect(r.rows[0]).toMatchObject({ vendor: { name: "Vendor A" }, driver: { name: "Ali" } });
    expect((await vehicleRows(o, { status: "inactive" }, pg)).rows[0].plate).toBe("C 0001");
  });
  it("counts only active vehicles per vendor", async () => {
    const r = await vendorRows(seed(), {}, pg);
    expect(r.rows.find(v => v.name === "Vendor A")!.activeVehicles).toBe(1);
  });
});
describe("admin authorization", () => {
  const S = "x".repeat(40);
  const mkReq = (role: "DRIVER" | "ADMIN") => new Request("http://x", { headers: { cookie: `at=${signToken({ sub: "u", role }, 60, S)}` } });
  it("rejects drivers and anonymous callers", () => {
    process.env.SESSION_SECRET = S; process.env.ODOO_MODE = "mock";
    expect(() => adminContext(mkReq("DRIVER"))).toThrow(/access/);
    expect(() => adminContext(new Request("http://x"))).toThrow(/Sign in/);
    expect(adminContext(mkReq("ADMIN")).adminId).toBe("u");
  });
});
