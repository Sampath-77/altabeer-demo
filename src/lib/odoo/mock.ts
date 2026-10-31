import type { OdooClient, OdooAttendance, OdooEmployee, OdooVehicle, OdooAssignment, OdooExpense, OdooPayslip, ReceiptFile, OdooVendor, EmployeeQuery, OdooFineSnapshot, OdooFineRecord } from "./types";

/** In-memory stand-in for Odoo. Development and tests only; refused in production. */
export class MockOdoo implements OdooClient {
  employees = new Map<number, OdooEmployee>();
  attendance: OdooAttendance[] = [];
  assignments = new Map<number, { vehicle: OdooVehicle; assignment: OdooAssignment }>();
  expenses: OdooExpense[] = [];
  attachments: { expenseId: number; file: ReceiptFile }[] = [];
  payslips: OdooPayslip[] = [];
  vehicles: OdooVehicle[] = [];
  vendors: OdooVendor[] = [];
  fineRecords = new Map<string, OdooFineRecord & { snapshot: OdooFineSnapshot }>();
  clock = () => Date.now();
  failFines = 0;
  failNext = false;
  failAttach = false;
  private seq = 1;
  private guard() { if (this.failNext) { this.failNext = false; throw new Error("Odoo unreachable"); } }
  async getEmployee(id: number) { this.guard(); return this.employees.get(id) ?? null; }
  async getAssignmentFor(id: number) { this.guard(); return this.assignments.get(id) ?? null; }
  assignmentHistory: OdooAssignment[] = [];
  async findVehiclesByPlate(n: string): Promise<OdooVehicle[]> { this.guard(); return this.vehicles.filter(v => v.plate.toUpperCase().includes(n.toUpperCase())); }
  async assignmentsAt(vid: number, at: Date): Promise<OdooAssignment[]> {
    this.guard(); const d = new Date(at.getTime() + 4 * 3600_000).toISOString().slice(0, 10); // Dubai calendar day
    return this.assignmentHistory.filter(a => a.vehicleId === vid && a.from.slice(0, 10) <= d && (!a.to || a.to.slice(0, 10) >= d));
  }
  async openAttendance(e: number) { this.guard(); return this.attendance.find(a => a.employeeId === e && !a.checkOut) ?? null; }
  async listAttendance(e: number, o: { since?: Date; limit: number }) {
    this.guard();
    return this.attendance.filter(a => a.employeeId === e && (!o.since || new Date(a.checkIn) >= o.since))
      .sort((a, b) => b.checkIn.localeCompare(a.checkIn)).slice(0, o.limit);
  }
  async checkIn(e: number, at: Date) { this.guard(); const r = { id: this.seq++, employeeId: e, checkIn: at.toISOString(), checkOut: null }; this.attendance.push(r); return r; }
  async checkOut(id: number, at: Date) { this.guard(); const r = this.attendance.find(a => a.id === id)!; r.checkOut = at.toISOString(); return r; }
  async createExpense(i: { employeeId: number; category: "fuel" | "parking"; amount: number; vendor: string; date: string }) {
    this.guard(); const r: OdooExpense = { id: this.seq++, employeeId: i.employeeId, category: i.category, amount: i.amount, vendor: i.vendor, date: i.date, status: "submitted" };
    this.expenses.push(r); return r;
  }
  async attachReceipt(expenseId: number, file: ReceiptFile) {
    this.guard(); if (this.failAttach) { this.failAttach = false; throw new Error("attach failed"); }
    this.attachments.push({ expenseId, file });
  }
  async listExpenses(e: number, o: { since?: Date; limit: number }) { this.guard(); return this.expenses.filter(x => x.employeeId === e && (!o.since || x.date >= o.since.toISOString().slice(0, 10))).slice(-o.limit).reverse(); }
  async listPayslips(e: number) { this.guard(); return this.payslips.filter(p => p.employeeId === e); }
  async getPayslip(id: number) { this.guard(); return this.payslips.find(p => p.id === id) ?? null; }
  private emp(q: EmployeeQuery) {
    const t = q.search?.toLowerCase();
    return [...this.employees.values()].filter(e => (q.active === undefined || e.active === q.active) && (!t || e.name.toLowerCase().includes(t) || String(e.id) === t)
      && (!q.idIn || q.idIn.includes(e.id)) && (!q.idNotIn || !q.idNotIn.includes(e.id))).sort((a, b) => a.name.localeCompare(b.name));
  }
  async listEmployees(q: EmployeeQuery) { this.guard(); const all = this.emp(q); return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length }; }
  async openAttendances() { this.guard(); return this.attendance.filter(a => !a.checkOut); }
  async attendanceSince(ids: number[], since: Date) { this.guard(); return this.attendance.filter(a => ids.includes(a.employeeId) && new Date(a.checkIn) >= since); }
  async currentAssignments() { this.guard(); return [...this.assignments.values()].map(a => a.assignment).filter(a => !a.to); }
  async getVehicles(ids: number[]) { this.guard(); return this.vehicles.filter(v => ids.includes(v.id)); }
  async listVehicles(q: { offset: number; limit: number; search?: string; active?: boolean }) {
    this.guard(); const all = this.vehicles.filter(v => (q.active === undefined || v.active === q.active) && (!q.search || v.plate.toLowerCase().includes(q.search.toLowerCase())));
    return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length };
  }
  async countVehicles(active?: boolean) { this.guard(); return this.vehicles.filter(v => active === undefined || v.active === active).length; }
  async getVendors(ids: number[]) { this.guard(); return this.vendors.filter(v => ids.includes(v.id)); }
  async listVendors(q: { offset: number; limit: number; search?: string }) {
    this.guard(); const all = this.vendors.filter(v => !q.search || v.name.toLowerCase().includes(q.search.toLowerCase()));
    return { rows: all.slice(q.offset, q.offset + q.limit), total: all.length };
  }
  async upsertFine(s: OdooFineSnapshot) {
    this.guard(); if (this.failFines > 0) { this.failFines--; throw new Error("Odoo unreachable"); }
    const ex = this.fineRecords.get(s.appId); const id = ex?.id ?? this.seq++; const writeDate = new Date(this.clock()).toISOString();
    this.fineRecords.set(s.appId, { id, appId: s.appId, state: s.state, amount: s.amount ?? 0, amountPaid: s.amountPaid, writeDate, snapshot: s }); return { id, writeDate };
  }
  async getFineRecords(ids: number[]) { this.guard(); return [...this.fineRecords.values()].filter(r => ids.includes(r.id)); }
  async getExpenses(ids: number[]) { this.guard(); return this.expenses.filter(e => ids.includes(e.id)); }
  async ping() { this.guard(); }
}
