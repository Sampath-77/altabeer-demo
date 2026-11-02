import type { OdooClient, OdooAttendance, OdooEmployee, OdooVehicle, OdooAssignment, OdooExpense, OdooPayslip, ExpenseStatus, EmployeeQuery, OdooVendor, OdooFineSnapshot, OdooFineRecord } from "./types";

/**
 * Odoo External JSON-2 adapter (POST {base}/json/2/{model}/{method}, Bearer API key).
 * UNVERIFIED against a live instance: model/field names below are Odoo-standard guesses.
 * Confirm them (and the assignment model) against the client's Odoo before production.
 */
export const ODOO_MAP = {
  employee: { model: "hr.employee", fields: ["id", "name", "active", "job_title"] },
  attendance: { model: "hr.attendance", fields: ["id", "employee_id", "check_in", "check_out"] },
  vehicle: { model: "fleet.vehicle", fields: ["id", "license_plate", "model_id", "active"] },
  expense: { model: "hr.expense", fields: ["id", "employee_id", "product_id", "name", "total_amount", "date", "state"] },
  payslip: { model: "hr.payslip", fields: ["id", "employee_id", "name", "date_from", "date_to", "state", "net_wage"] },
  payslipLine: { model: "hr.payslip.line", fields: ["id", "slip_id", "name", "code", "total"] },
  vendor: { model: "res.partner", fields: ["id", "name", "email", "phone"], domain: [["supplier_rank", ">", 0]] },
  fine: { model: "altabeer.fine", fields: ["id", "app_id", "state", "amount", "amount_paid", "write_date"] }, // custom module in odoo_module/altabeer_fine
  assignment: { model: "fleet.vehicle.assignation.log", fields: ["id", "vehicle_id", "driver_id", "driver_employee_id", "date_start", "date_end"] },
};
export class OdooError extends Error { constructor(msg: string, public status?: number) { super(msg); } }

const toOdoo = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
const fromOdoo = (s: string | false | null | undefined) => (s ? s.replace(" ", "T") + "Z" : null);
const EXP_STATE: Record<string, ExpenseStatus> = { draft: "draft", reported: "submitted", submitted: "submitted", approved: "approved", done: "paid", refused: "refused" };
const rel = (v: unknown): number | undefined => (Array.isArray(v) ? (v[0] as number) : undefined);

export function createJson2Client(base: string, db: string, apiKey: string, timeoutMs = 30_000, f: typeof fetch = fetch, products = { fuel: Number(process.env.ODOO_PRODUCT_FUEL) || 0, parking: Number(process.env.ODOO_PRODUCT_PARKING) || 0 }): OdooClient {
  async function call<T>(model: string, method: string, body: Record<string, unknown>): Promise<T> {
    let res: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await f(`${base.replace(/\/$/, "")}/json/2/${model}/${method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `bearer ${apiKey}`, "X-Odoo-Database": db },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt === 3) {
          console.error(`Odoo call failed: ${model}/${method}:`, err instanceof Error ? err.message : err);
          throw new OdooError(`Odoo unreachable: ${err instanceof Error ? err.message : "network failure"}`);
        }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (res.status === 429 && attempt < 3) {
        console.warn(`Odoo 429 rate limit on ${model}/${method}, backing off (attempt ${attempt + 1})...`);
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      break;
    }
    if (!res || !res.ok) {
      const status = res?.status;
      const errText = res ? await res.text().catch(() => "") : "";
      console.error(`Odoo error: ${model}/${method} returned ${status}:`, errText.slice(0, 300));
      throw new OdooError(`Odoo returned ${status}`, status);
    }
    return res.json() as Promise<T>;
  }
  const searchRead = <T>(m: { model: string; fields: string[] }, domain: unknown[], extra: Record<string, unknown> = {}) =>
    call<T[]>(m.model, "search_read", { domain, fields: m.fields, ...extra });
  type Att = { id: number; employee_id: [number, string]; check_in: string; check_out: string | false };
  const att = (r: Att): OdooAttendance => ({ id: r.id, employeeId: r.employee_id[0], checkIn: fromOdoo(r.check_in)!, checkOut: fromOdoo(r.check_out) });

  type Ex = { id: number; employee_id: [number, string]; product_id: [number, string] | false; name: string; total_amount: number; date: string; state: string };
  const exp = async (domain: unknown[], extra: Record<string, unknown>): Promise<OdooExpense[]> =>
    (await searchRead<Ex>(ODOO_MAP.expense, domain, extra)).map(r => ({
      id: r.id, employeeId: r.employee_id[0], amount: r.total_amount, date: r.date, vendor: r.name.includes(": ") ? r.name.split(": ").slice(1).join(": ") : r.name,
      category: rel(r.product_id) === products.fuel ? "fuel" : rel(r.product_id) === products.parking ? "parking" : "other", status: EXP_STATE[r.state] ?? "unknown" }));
  type Ps = { id: number; employee_id: [number, string]; name: string; date_from: string; date_to: string; state: string; net_wage: number | false };
  const pay = async (domain: unknown[], extra: Record<string, unknown>): Promise<OdooPayslip[]> => {
    const slips = await searchRead<Ps>(ODOO_MAP.payslip, domain, extra);
    if (!slips.length) return [];
    const lines = await searchRead<{ slip_id: [number, string]; name: string; code?: string; category_id?: [number, string]; total: number }>(ODOO_MAP.payslipLine, [["slip_id", "in", slips.map(s => s.id)]]);
    return slips.map(s => ({ id: s.id, employeeId: s.employee_id[0], name: s.name, dateFrom: s.date_from, dateTo: s.date_to, state: s.state, net: s.net_wage === false ? null : s.net_wage,
      lines: lines.filter(l => l.slip_id[0] === s.id).map(l => ({ name: l.name, category: (Array.isArray(l.category_id) ? l.category_id[1] : l.code) || "salary", amount: l.total })) }));
  };

  const NOACT = { context: { active_test: false } };
  const driverDomain: unknown[] = process.env.ODOO_DRIVER_DOMAIN
    ? JSON.parse(process.env.ODOO_DRIVER_DOMAIN)
    : [["job_title", "in", ["Delivery Associate", "Driver"]]]; // restrict hr.employee to drivers, excluding non-driver roles like admin/accountant
  const empDomain = (o: EmployeeQuery) => {
    const d: unknown[] = [...driverDomain];
    if (o.active !== undefined) d.push(["active", "=", o.active]);
    if (o.search) d.push("|", ["name", "ilike", o.search], ["id", "=", Number(o.search) || 0]);
    if (o.idIn) d.push(["id", "in", o.idIn]);
    if (o.idNotIn?.length) d.push(["id", "not in", o.idNotIn]);
    return d;
  };
  type Veh = { id: number; license_plate: string; model_id: [number, string] | false; active: boolean; vendor_id?: [number, string] | false };
  const veh = (v: Veh): OdooVehicle => ({ id: v.id, plate: v.license_plate, model: Array.isArray(v.model_id) ? v.model_id[1] : undefined, active: v.active, vendorId: Array.isArray(v.vendor_id) ? v.vendor_id[0] : undefined });
  type Ven = { id: number; name: string; email: string | false; phone: string | false };
  const ven = (v: Ven): OdooVendor => ({ id: v.id, name: v.name, email: v.email || undefined, phone: v.phone || undefined });

  return {
    async getEmployee(id) {
      const [r] = await searchRead<{ id: number; name: string; active: boolean; job_title: string | false }>(ODOO_MAP.employee, [["id", "=", id]], { limit: 1, context: { active_test: false } });
      return r ? ({ id: r.id, name: r.name, active: r.active, jobTitle: r.job_title || undefined } as OdooEmployee) : null;
    },
    async openAttendance(employeeId) {
      const [r] = await searchRead<Att>(ODOO_MAP.attendance, [["employee_id", "=", employeeId], ["check_out", "=", false]], { limit: 1, order: "check_in desc" });
      return r ? att(r) : null;
    },
    async listAttendance(employeeId, { since, limit }) {
      const domain: unknown[] = [["employee_id", "=", employeeId]];
      if (since) domain.push(["check_in", ">=", toOdoo(since)]);
      return (await searchRead<Att>(ODOO_MAP.attendance, domain, { limit, order: "check_in desc" })).map(att);
    },
    async checkIn(employeeId, at) {
      const [id] = await call<number[]>(ODOO_MAP.attendance.model, "create", { vals_list: [{ employee_id: employeeId, check_in: toOdoo(at) }] });
      const [r] = await searchRead<Att>(ODOO_MAP.attendance, [["id", "=", id]], { limit: 1 });
      return att(r);
    },
    async checkOut(attendanceId, at) {
      await call(ODOO_MAP.attendance.model, "write", { ids: [attendanceId], vals: { check_out: toOdoo(at) } });
      const [r] = await searchRead<Att>(ODOO_MAP.attendance, [["id", "=", attendanceId]], { limit: 1 });
      return att(r);
    },
    async getAssignmentFor(employeeId) {
      const [a] = await searchRead<{ vehicle_id: [number, string]; driver_id?: [number, string]; driver_employee_id?: [number, string]; date_start: string; date_end: string | false }>(
        ODOO_MAP.assignment, ["|", ["driver_employee_id", "=", employeeId], ["driver_id", "=", employeeId], ["date_end", "=", false]], { limit: 1, order: "date_start desc" });
      if (!a) return null;
      const vid = rel(a.vehicle_id)!;
      const [v] = await searchRead<{ id: number; license_plate: string; model_id: [number, string] | false; active: boolean }>(ODOO_MAP.vehicle, [["id", "=", vid]], { limit: 1 });
      if (!v) return null;
      const vehicle: OdooVehicle = { id: v.id, plate: v.license_plate, model: Array.isArray(v.model_id) ? v.model_id[1] : undefined, active: v.active };
      const assignment: OdooAssignment = { vehicleId: vid, employeeId, from: fromOdoo(a.date_start) ?? a.date_start, to: null };
      return { vehicle, assignment };
    },
    async createExpense({ employeeId, category, amount, vendor, date }) {
      const product = products[category];
      if (!product) throw new OdooError(`ODOO_PRODUCT_${category.toUpperCase()} is not configured`);
      const [id] = await call<number[]>(ODOO_MAP.expense.model, "create", { vals_list: [{ name: `${category === "fuel" ? "Fuel" : "Parking"}: ${vendor}`, employee_id: employeeId, product_id: product, total_amount: amount, date }] });
      return (await exp([["id", "=", id]], { limit: 1 }))[0];
    },
    async attachReceipt(expenseId, file) {
      try {
        await call("ir.attachment", "create", { vals_list: [{ name: file.name, raw: file.data.toString("base64"), res_model: ODOO_MAP.expense.model, res_id: expenseId, mimetype: file.mime }] });
      } catch {
        await call("ir.attachment", "create", { vals_list: [{ name: file.name, datas: file.data.toString("base64"), res_model: ODOO_MAP.expense.model, res_id: expenseId, mimetype: file.mime }] });
      }
    },
    async listExpenses(employeeId, { since, limit }) {
      const d: unknown[] = [["employee_id", "=", employeeId]];
      if (since) d.push(["date", ">=", since.toISOString().slice(0, 10)]);
      return exp(d, { limit, order: "date desc, id desc" });
    },
    async listPayslips(employeeId) { return pay([["employee_id", "=", employeeId], ["state", "in", ["done", "paid"]]], { limit: 36, order: "date_from desc" }); },
    async getPayslip(id) { return (await pay([["id", "=", id]], { limit: 1 }))[0] ?? null; },
    async listEmployees(q: EmployeeQuery) {
      const d = empDomain(q);
      const [rows, total] = await Promise.all([
        searchRead<{ id: number; name: string; active: boolean; job_title: string | false }>(ODOO_MAP.employee, d, { ...NOACT, limit: q.limit, offset: q.offset, order: "name" }),
        call<number>(ODOO_MAP.employee.model, "search_count", { domain: d, ...NOACT }),
      ]);
      return { rows: rows.map(r => ({ id: r.id, name: r.name, active: r.active, jobTitle: r.job_title || undefined })), total };
    },
    async openAttendances() { return (await searchRead<Att>(ODOO_MAP.attendance, [["check_out", "=", false]], { limit: 2000 })).map(att); },
    async attendanceSince(ids, since) {
      if (!ids.length) return [];
      return (await searchRead<Att>(ODOO_MAP.attendance, [["employee_id", "in", ids], ["check_in", ">=", toOdoo(since)]], { limit: 5000, order: "check_in desc" })).map(att);
    },
    async currentAssignments() {
      const rows = await searchRead<{ vehicle_id: [number, string]; driver_id?: [number, string]; driver_employee_id?: [number, string]; date_start: string }>(ODOO_MAP.assignment, [["date_end", "=", false]], { limit: 5000 });
      return rows.map(a => ({ vehicleId: a.vehicle_id[0], employeeId: a.driver_employee_id ? a.driver_employee_id[0] : (a.driver_id ? a.driver_id[0] : 0), from: fromOdoo(a.date_start) ?? a.date_start, to: null }));
    },
    async getVehicles(ids) { return ids.length ? (await searchRead<Veh>(ODOO_MAP.vehicle, [["id", "in", ids]], { ...NOACT, limit: ids.length })).map(veh) : []; },
    async listVehicles(q) {
      const d: unknown[] = []; if (q.active !== undefined) d.push(["active", "=", q.active]); if (q.search) d.push(["license_plate", "ilike", q.search]);
      const [rows, total] = await Promise.all([searchRead<Veh>(ODOO_MAP.vehicle, d, { ...NOACT, limit: q.limit, offset: q.offset, order: "license_plate" }), call<number>(ODOO_MAP.vehicle.model, "search_count", { domain: d, ...NOACT })]);
      return { rows: rows.map(veh), total };
    },
    async countVehicles(active) { return call<number>(ODOO_MAP.vehicle.model, "search_count", { domain: active === undefined ? [] : [["active", "=", active]], ...NOACT }); },
    async getVendors(ids) { return ids.length ? (await searchRead<Ven>(ODOO_MAP.vendor, [...ODOO_MAP.vendor.domain, ["id", "in", ids]], { limit: ids.length })).map(ven) : []; },
    async listVendors(q) {
      const d: unknown[] = [...ODOO_MAP.vendor.domain]; if (q.search) d.push(["name", "ilike", q.search]);
      const [rows, total] = await Promise.all([searchRead<Ven>(ODOO_MAP.vendor, d, { limit: q.limit, offset: q.offset, order: "name" }), call<number>(ODOO_MAP.vendor.model, "search_count", { domain: d })]);
      return { rows: rows.map(ven), total };
    },
    async upsertFine(f: OdooFineSnapshot) {
      const o = (v: unknown) => (v === null || v === undefined ? false : v);
      const vals = { name: o(f.reference) || f.appId, app_id: f.appId, authority: o(f.authority), plate: o(f.plate), violation_at: f.violationAt ? toOdoo(new Date(f.violationAt)) : false, notice_received_at: f.noticeReceivedAt ? toOdoo(new Date(f.noticeReceivedAt)) : false,
        vehicle_id: o(f.vehicleId), driver_id: o(f.driverId), vendor_id: o(f.vendorId), amount: f.amount ?? 0, penalty: f.penalty ?? 0, amount_paid: f.amountPaid, deadline: f.deadline ? toOdoo(new Date(f.deadline)) : false,
        deadline_source: o(f.deadlineSource), state: f.state, escalation_level: f.escalationLevel, closed_reason: o(f.closedReason), description: o(f.description), last_app_sync: toOdoo(new Date()) };
      try {
        const [ex] = await searchRead<{ id: number }>(ODOO_MAP.fine, [["app_id", "=", f.appId]], { limit: 1, ...NOACT });
        let id: number;
        if (ex) { await call(ODOO_MAP.fine.model, "write", { ids: [ex.id], vals }); id = ex.id; }
        else { [id] = await call<number[]>(ODOO_MAP.fine.model, "create", { vals_list: [vals] }); }
        const [r] = await searchRead<{ write_date: string }>(ODOO_MAP.fine, [["id", "=", id]], { limit: 1 });
        return { id, writeDate: fromOdoo(r.write_date)! };
      } catch (e) {
        if ((e as OdooError)?.status === 404) {
          throw new OdooError("Odoo model 'altabeer.fine' does not exist. Install odoo_module/altabeer_fine in Odoo to enable traffic fine syncing.", 404);
        }
        throw e;
      }
    },
    async getFineRecords(ids: number[]): Promise<OdooFineRecord[]> {
      if (!ids.length) return [];
      try {
        return (await searchRead<{ id: number; app_id: string; state: string; amount: number; amount_paid: number; write_date: string }>(ODOO_MAP.fine, [["id", "in", ids]], { limit: ids.length, ...NOACT }))
          .map(r => ({ id: r.id, appId: r.app_id, state: r.state, amount: r.amount, amountPaid: r.amount_paid, writeDate: fromOdoo(r.write_date)! }));
      } catch (e) {
        if ((e as OdooError)?.status === 404) return [];
        throw e;
      }
    },
    async getExpenses(ids: number[]) { return ids.length ? exp([["id", "in", ids]], { limit: ids.length }) : []; },
    async ping() { await call<number>(ODOO_MAP.employee.model, "search_count", { domain: [], limit: 1 }); },
    // Plate lookup and historical assignments arrive with the fine-matching stage.
    /** Returns vehicles whose plate contains the number; exact matching (code/emirate) happens in the app, never here. */
    async findVehiclesByPlate(number) { return (await searchRead<Veh>(ODOO_MAP.vehicle, [["license_plate", "ilike", number]], { ...NOACT, limit: 50 })).map(veh); },
    async assignmentsAt(vehicleId, at) {
      const day = new Date(at.getTime() + 4 * 3600_000).toISOString().slice(0, 10); // Dubai calendar day
      const rows = await searchRead<{ vehicle_id: [number, string]; driver_id?: [number, string]; driver_employee_id?: [number, string]; date_start: string; date_end: string | false }>(ODOO_MAP.assignment,
        [["vehicle_id", "=", vehicleId], ["date_start", "<=", day], "|", ["date_end", "=", false], ["date_end", ">=", day]], { limit: 20 });
      return rows.map(a => ({ vehicleId, employeeId: a.driver_employee_id ? a.driver_employee_id[0] : (a.driver_id ? a.driver_id[0] : 0), from: a.date_start, to: a.date_end || null }));
    },
  };
}
