import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { getPendingReportDates } from "@/lib/compliance/service";

// GET /api/driver/daily-reports/pending — list dates where a report is still required
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const pendingDates = await getPendingReportDates(d.userId);
    return Response.json({ pendingDates });
  } catch (e) { return errorResponse(e); }
}

