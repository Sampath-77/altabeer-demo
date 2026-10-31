import { driverContext } from "@/lib/driver";
import { shiftService } from "@/lib/shifts";
import { errorResponse } from "@/lib/auth/guard";
import { assertCheckInEligible } from "@/lib/compliance/service";

export async function POST(req: Request) {
  try {
    const d = await driverContext(req);
    // ── Compliance gate: reject if driver has an unresolved missing-report flag ──
    await assertCheckInEligible(d.userId);
    return Response.json({ shift: await shiftService(d.odoo, d.employeeId).checkIn() }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
