import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const payslips = await d.odoo.listPayslips(d.employeeId).catch(() => { throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable."); });
    return Response.json({ payslips });
  } catch (e) { return errorResponse(e); }
}
