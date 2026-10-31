import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { ownPayslip } from "@/lib/payslips";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const d = await driverContext(req);
    const p = await ownPayslip(d.odoo, d.employeeId, Number(params.id)).catch(e => { throw e instanceof AuthError ? e : new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable."); });
    return Response.json({ payslip: p });
  } catch (e) { return errorResponse(e); }
}
