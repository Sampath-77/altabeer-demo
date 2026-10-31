import { driverContext } from "@/lib/driver";
import { shiftService } from "@/lib/shifts";
import { errorResponse } from "@/lib/auth/guard";
export async function GET(req: Request) {
  try { const d = await driverContext(req); return Response.json(await shiftService(d.odoo, d.employeeId).current()); } catch (e) { return errorResponse(e); }
}
