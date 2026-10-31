import { driverContext } from "@/lib/driver";
import { shiftService } from "@/lib/shifts";
import { errorResponse } from "@/lib/auth/guard";
export async function POST(req: Request) {
  try { const d = await driverContext(req); return Response.json({ shift: await shiftService(d.odoo, d.employeeId).checkOut() }); } catch (e) { return errorResponse(e); }
}
