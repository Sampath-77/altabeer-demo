import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { getDriverComplianceStatus } from "@/lib/compliance/service";

export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const status = await getDriverComplianceStatus(d.userId, d.employeeId);
    return Response.json(status);
  } catch (e) { return errorResponse(e); }
}

