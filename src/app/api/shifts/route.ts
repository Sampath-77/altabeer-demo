import { driverContext } from "@/lib/driver";
import { shiftService } from "@/lib/shifts";
import { errorResponse } from "@/lib/auth/guard";
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("limit")) || 20, 1), 100);
    return Response.json({ shifts: await shiftService(d.odoo, d.employeeId).history(limit) });
  } catch (e) { return errorResponse(e); }
}
