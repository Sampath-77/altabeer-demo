import type { OdooClient, OdooPayslip } from "./odoo/types";
import { AuthError } from "./auth/service";
/** Returns 404 (not 403) for someone else's or unreleased payslips so existence is not revealed. */
export async function ownPayslip(c: OdooClient, employeeId: number, id: number): Promise<OdooPayslip> {
  const p = Number.isInteger(id) ? await c.getPayslip(id) : null;
  if (!p || p.employeeId !== employeeId || !["done", "paid"].includes(p.state)) throw new AuthError("NOT_FOUND", 404, "Payslip not found.");
  return p;
}
