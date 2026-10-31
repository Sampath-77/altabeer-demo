import type { OdooClient, OdooAttendance, OdooVehicle } from "./odoo/types";
import { STALE_SHIFT_HOURS } from "./shifts";
import { AuthError } from "./auth/service";

const DAY = 86400_000;
export const DEFINITIONS = {
  activeDriver: "Employee record is active in Odoo (limited to the configured driver filter).",
  inactiveDriver: "Employee record is archived/inactive in Odoo.",
  checkedIn: "Active driver with an open attendance record (no check-out).",
  checkedOut: "Active driver with no open attendance record. Checked-out drivers are not inactive.",
  overdueShift: `Open shift older than ${STALE_SHIFT_HOURS} hours.`,
  activeVehicle: "Vehicle is active in Odoo.",
};
export interface Paging { page: number; pageSize: number }
export const paging = (u: URL): Paging => ({ page: Math.max(Number(u.searchParams.get("page")) || 1, 1), pageSize: Math.min(Math.max(Number(u.searchParams.get("pageSize")) || 25, 1), 100) });
export async function odooGuard<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { if (e instanceof AuthError) throw e; throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable. Try again shortly."); }
}
const unavailable = (reason: string) => ({ available: false as const, reason });

export async function dashboard(c: OdooClient, now = Date.now()) {
  return odooGuard((async () => {
    const open = await c.openAttendances();
    const openIds = [...new Set(open.map(o => o.employeeId))];
    const active = await c.listEmployees({ offset: 0, limit: 1, active: true });
    const inactive = await c.listEmployees({ offset: 0, limit: 1, active: false });
    const inOpen = openIds.length ? await c.listEmployees({ offset: 0, limit: openIds.length, active: true, idIn: openIds }) : { rows: [], total: 0 };
    const vehicles = await c.countVehicles();
    const activeVehicles = await c.countVehicles(true);
    const vendors = await c.listVendors({ offset: 0, limit: 1 });
    const activeOpen = new Set(inOpen.rows.map(r => r.id));
    const overdue = new Set(open.filter(o => activeOpen.has(o.employeeId) && (now - Date.parse(o.checkIn)) / 3600_000 > STALE_SHIFT_HOURS).map(o => o.employeeId));
    return {
      generatedAt: new Date(now).toISOString(),
      drivers: { active: active.total, inactive: inactive.total, checkedIn: inOpen.total, checkedOut: active.total - inOpen.total, openOrOverdueShifts: overdue.size },
      vehicles: { total: vehicles, active: activeVehicles }, vendors: { total: vendors.total },
      fines: unavailable("Fine management is built in a later stage; no fine figures are shown."),
      ocrAwaitingReview: unavailable("OCR is built in a later stage."),
      syncFailures: unavailable("Sync monitoring is built in a later stage."),
      definitions: DEFINITIONS,
    };
  })());
}

export interface DriverFilter { search?: string; status?: "active" | "inactive" | "all"; shift?: "in" | "out" | "all"; vendorId?: number; vehicle?: string }
const latest = (rows: OdooAttendance[]) => { const m = new Map<number, OdooAttendance>(); for (const r of rows) { const p = m.get(r.employeeId); if (!p || r.checkIn > p.checkIn) m.set(r.employeeId, r); } return m; };

export async function driverRows(c: OdooClient, f: DriverFilter, pg: Paging, now = Date.now()) {
  return odooGuard((async () => {
    const open = await c.openAttendances();
    const assignments = await c.currentAssignments();
    const openIds = [...new Set(open.map(o => o.employeeId))];
    const vehicleIds = [...new Set(assignments.map(a => a.vehicleId))];
    const vehicles = new Map((await c.getVehicles(vehicleIds)).map(v => [v.id, v]));
    // vendor / vehicle filters resolve through current assignments
    let idIn: number[] | undefined; let idNotIn: number[] | undefined;
    const restrict = (ids: number[]) => { idIn = idIn ? idIn.filter(i => ids.includes(i)) : ids; };
    if (f.vendorId) restrict(assignments.filter(a => vehicles.get(a.vehicleId)?.vendorId === f.vendorId).map(a => a.employeeId));
    if (f.vehicle) restrict(assignments.filter(a => vehicles.get(a.vehicleId)?.plate.toLowerCase().includes(f.vehicle!.toLowerCase())).map(a => a.employeeId));
    if (f.shift === "in") restrict(openIds); if (f.shift === "out") idNotIn = openIds;
    if (idIn && idIn.length === 0) return { rows: [], total: 0, page: pg.page, pageSize: pg.pageSize, generatedAt: new Date(now).toISOString() };
    const active = f.status === "inactive" ? false : f.status === "all" ? undefined : true;
    const page = await c.listEmployees({ offset: (pg.page - 1) * pg.pageSize, limit: pg.pageSize, search: f.search, active, idIn, idNotIn });
    const ids = page.rows.map(r => r.id);
    const hist = latest((await c.attendanceSince(ids, new Date(now - 14 * DAY))).filter(a => a.checkOut));
    const openBy = latest(open.filter(o => ids.includes(o.employeeId)));
    const asgBy = new Map(assignments.map(a => [a.employeeId, a]));
    const vendors = new Map((await c.getVendors([...new Set([...asgBy.values()].map(a => vehicles.get(a.vehicleId)?.vendorId).filter((x): x is number => !!x))])).map(v => [v.id, v]));
    const rows = page.rows.map(e => {
      const o = openBy.get(e.id), h = hist.get(e.id), a = asgBy.get(e.id), v = a ? vehicles.get(a.vehicleId) : undefined;
      const mins = o ? Math.round((now - Date.parse(o.checkIn)) / 60000) : null;
      return {
        id: e.id, name: e.name, active: e.active, jobTitle: e.jobTitle ?? null,
        shift: { state: o ? "checked_in" as const : "checked_out" as const, checkIn: o?.checkIn ?? null, lastCheckOut: h?.checkOut ?? null, durationMinutes: mins, overdue: mins != null && mins > STALE_SHIFT_HOURS * 60 },
        vehicle: v ? { id: v.id, plate: v.plate, model: v.model ?? null } : null,
        vendor: v?.vendorId ? { id: v.vendorId, name: vendors.get(v.vendorId)?.name ?? null } : null,
      };
    });
    return { rows, total: page.total, page: pg.page, pageSize: pg.pageSize, generatedAt: new Date(now).toISOString() };
  })());
}

export async function driverDetail(c: OdooClient, id: number, now = Date.now()) {
  return odooGuard((async () => {
    const { rows } = await c.listEmployees({ offset: 0, limit: 1, idIn: [id] });
    if (!rows[0]) throw new AuthError("NOT_FOUND", 404, "Driver not found.");
    const [shifts, asg, open] = await Promise.all([c.listAttendance(id, { limit: 30 }), c.getAssignmentFor(id), c.openAttendance(id)]);
    return { driver: rows[0], openShift: open, assignment: asg ? { plate: asg.vehicle.plate, model: asg.vehicle.model ?? null, since: asg.assignment.from, vendorId: asg.vehicle.vendorId ?? null } : null,
      shifts: shifts.map(s => ({ id: s.id, checkIn: s.checkIn, checkOut: s.checkOut ?? null, durationMinutes: Math.round(((s.checkOut ? Date.parse(s.checkOut) : now) - Date.parse(s.checkIn)) / 60000) })), generatedAt: new Date(now).toISOString() };
  })());
}

export async function vehicleRows(c: OdooClient, q: { search?: string; status?: "active" | "inactive" | "all" }, pg: Paging) {
  return odooGuard((async () => {
    const page = await c.listVehicles({ offset: (pg.page - 1) * pg.pageSize, limit: pg.pageSize, search: q.search, active: q.status === "inactive" ? false : q.status === "all" ? undefined : true });
    const asg = await c.currentAssignments();
    const drivers = new Map((await c.listEmployees({ offset: 0, limit: 100, idIn: asg.filter(a => page.rows.some(v => v.id === a.vehicleId)).map(a => a.employeeId), }).then(r => r.rows)).map(e => [e.id, e]));
    const vendors = new Map((await c.getVendors([...new Set(page.rows.map((v: OdooVehicle) => v.vendorId).filter((x): x is number => !!x))])).map(v => [v.id, v]));
    const rows = page.rows.map(v => {
      const a = asg.find(x => x.vehicleId === v.id);
      return { id: v.id, plate: v.plate, model: v.model ?? null, active: v.active, vendor: v.vendorId ? { id: v.vendorId, name: vendors.get(v.vendorId)?.name ?? null } : null,
        driver: a ? { id: a.employeeId, name: drivers.get(a.employeeId)?.name ?? null, since: a.from } : null };
    });
    return { rows, total: page.total, page: pg.page, pageSize: pg.pageSize, fines: unavailable("Fine history arrives with the fines stage.") };
  })());
}

export async function vendorRows(c: OdooClient, q: { search?: string }, pg: Paging) {
  return odooGuard((async () => {
    const page = await c.listVendors({ offset: (pg.page - 1) * pg.pageSize, limit: pg.pageSize, search: q.search });
    const ids = new Set(page.rows.map(v => v.id));
    // vehicles per vendor: scan vehicles (bounded) and count by vendor
    const counts = new Map<number, number>();
    for (let off = 0; off < 5000; off += 500) {
      const vs = await c.listVehicles({ offset: off, limit: 500, active: true });
      for (const v of vs.rows) if (v.vendorId && ids.has(v.vendorId)) counts.set(v.vendorId, (counts.get(v.vendorId) ?? 0) + 1);
      if (off + 500 >= vs.total) break;
    }
    return { rows: page.rows.map(v => ({ ...v, activeVehicles: counts.get(v.id) ?? 0 })), total: page.total, page: pg.page, pageSize: pg.pageSize, fines: unavailable("Vendor fine totals arrive with the fines stage.") };
  })());
}
