export interface OdooEmployee { id: number; name: string; active: boolean; jobTitle?: string }
export interface OdooVehicle { id: number; plate: string; make?: string; model?: string; vendorId?: number; active: boolean }
export interface OdooAssignment { vehicleId: number; employeeId: number; from: string; to?: string | null }
/** Timestamps are ISO-8601 UTC strings. */
export interface OdooAttendance { id: number; employeeId: number; checkIn: string; checkOut?: string | null }

export interface OdooClient {
  getEmployee(id: number): Promise<OdooEmployee | null>;
  getAssignmentFor(employeeId: number): Promise<{ vehicle: OdooVehicle; assignment: OdooAssignment } | null>;
  findVehiclesByPlate(normalizedPlate: string): Promise<OdooVehicle[]>;
  assignmentsAt(vehicleId: number, at: Date): Promise<OdooAssignment[]>;
  openAttendance(employeeId: number): Promise<OdooAttendance | null>;
  listAttendance(employeeId: number, opts: { since?: Date; limit: number }): Promise<OdooAttendance[]>;
  checkIn(employeeId: number, at: Date): Promise<OdooAttendance>;
  checkOut(attendanceId: number, at: Date): Promise<OdooAttendance>;
}

export type ExpenseCategory = "fuel" | "parking";
export type ExpenseStatus = "draft" | "submitted" | "approved" | "paid" | "refused" | "unknown";
export interface OdooExpense { id: number; employeeId: number; category: ExpenseCategory | "other"; amount: number; vendor?: string; date: string; status: ExpenseStatus }
export interface ReceiptFile { name: string; mime: string; data: Buffer }
export interface OdooPayslip { id: number; employeeId: number; name: string; dateFrom: string; dateTo: string; state: string; net: number | null; lines: { name: string; category: string; amount: number }[] }

export interface OdooClient {
  createExpense(i: { employeeId: number; category: ExpenseCategory; amount: number; vendor: string; date: string }): Promise<OdooExpense>;
  attachReceipt(expenseId: number, f: ReceiptFile): Promise<void>;
  listExpenses(employeeId: number, o: { since?: Date; limit: number }): Promise<OdooExpense[]>;
  listPayslips(employeeId: number): Promise<OdooPayslip[]>;
  getPayslip(id: number): Promise<OdooPayslip | null>;
}

export interface OdooVendor { id: number; name: string; email?: string; phone?: string }
export interface Page<T> { rows: T[]; total: number }
export interface EmployeeQuery { offset: number; limit: number; search?: string; active?: boolean; idIn?: number[]; idNotIn?: number[] }
export interface OdooClient {
  listEmployees(q: EmployeeQuery): Promise<Page<OdooEmployee>>;
  openAttendances(): Promise<OdooAttendance[]>;
  attendanceSince(employeeIds: number[], since: Date): Promise<OdooAttendance[]>;
  currentAssignments(): Promise<OdooAssignment[]>;
  getVehicles(ids: number[]): Promise<OdooVehicle[]>;
  listVehicles(q: { offset: number; limit: number; search?: string; active?: boolean }): Promise<Page<OdooVehicle>>;
  countVehicles(active?: boolean): Promise<number>;
  getVendors(ids: number[]): Promise<OdooVendor[]>;
  listVendors(q: { offset: number; limit: number; search?: string }): Promise<Page<OdooVendor>>;
}

export interface OdooFineSnapshot { appId: string; reference: string | null; authority: string | null; plate: string | null; violationAt: string | null; noticeReceivedAt: string | null; vehicleId: number | null; driverId: number | null; vendorId: number | null; amount: number | null; penalty: number | null; amountPaid: number; deadline: string | null; deadlineSource: string | null; state: string; escalationLevel: number; closedReason: string | null; description: string | null }
export interface OdooFineRecord { id: number; appId: string; state: string; amount: number; amountPaid: number; writeDate: string }
export interface OdooClient {
  /** Idempotent by appId (unique in Odoo). Returns the record id and the write_date after the write. */
  upsertFine(s: OdooFineSnapshot): Promise<{ id: number; writeDate: string }>;
  getFineRecords(ids: number[]): Promise<OdooFineRecord[]>;
  getExpenses(ids: number[]): Promise<OdooExpense[]>;
  ping(): Promise<void>;
}
