import type { OdooAttendance, OdooClient } from "./odoo/types";
import { AuthError } from "./auth/service";

export const STALE_SHIFT_HOURS = 16;
export interface ShiftDto { id: number; checkIn: string; checkOut: string | null; durationMinutes: number | null }
export interface CurrentShift { open: boolean; shift?: ShiftDto; staleWarning?: string }

const dto = (a: OdooAttendance, now: number): ShiftDto => {
  const end = a.checkOut ? Date.parse(a.checkOut) : now;
  return { id: a.id, checkIn: a.checkIn, checkOut: a.checkOut ?? null, durationMinutes: Math.max(0, Math.round((end - Date.parse(a.checkIn)) / 60000)) };
};
async function odoo<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable. Nothing was recorded. Try again.");
  }
}
export function shiftService(c: OdooClient, employeeId: number, nowFn: () => number = Date.now) {
  const current = async (): Promise<CurrentShift> => {
    const o = await odoo(c.openAttendance(employeeId));
    if (!o) return { open: false };
    const s = dto(o, nowFn());
    const stale = (s.durationMinutes ?? 0) > STALE_SHIFT_HOURS * 60;
    return { open: true, shift: s, ...(stale && { staleWarning: `This shift has been open for over ${STALE_SHIFT_HOURS} hours. Check out and tell operations if it is wrong.` }) };
  };
  return {
    current,
    async checkIn(): Promise<ShiftDto> {
      const emp = await odoo(c.getEmployee(employeeId));
      if (!emp || !emp.active) throw new AuthError("EMPLOYEE_INACTIVE", 403, "Your employee record is not active.");
      if (await odoo(c.openAttendance(employeeId))) throw new AuthError("ALREADY_CHECKED_IN", 409, "You already have an open shift.");
      return dto(await odoo(c.checkIn(employeeId, new Date(nowFn()))), nowFn());
    },
    async checkOut(): Promise<ShiftDto> {
      const o = await odoo(c.openAttendance(employeeId));
      if (!o) throw new AuthError("NO_OPEN_SHIFT", 409, "You have no open shift to check out of.");
      return dto(await odoo(c.checkOut(o.id, new Date(nowFn()))), nowFn());
    },
    async history(limit = 20): Promise<ShiftDto[]> {
      return (await odoo(c.listAttendance(employeeId, { limit }))).map(a => dto(a, nowFn()));
    },
    async monthStats(): Promise<{ daysWorked: number; hoursLogged: number }> {
      const n = new Date(nowFn()); // Dubai is UTC+4 with no DST
      const dubai = new Date(n.getTime() + 4 * 3600_000);
      const since = new Date(Date.UTC(dubai.getUTCFullYear(), dubai.getUTCMonth(), 1) - 4 * 3600_000);
      const rows = (await odoo(c.listAttendance(employeeId, { since, limit: 500 }))).map(a => dto(a, nowFn()));
      const days = new Set(rows.map(r => new Date(Date.parse(r.checkIn) + 4 * 3600_000).toISOString().slice(0, 10)));
      return { daysWorked: days.size, hoursLogged: Math.round(rows.reduce((s, r) => s + (r.durationMinutes ?? 0), 0) / 6) / 10 };
    },
  };
}
