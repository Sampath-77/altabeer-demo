import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { complianceReportRepo } from "@/lib/compliance/repo-prisma";
import { attachmentRepo } from "@/lib/compliance/repo-prisma";

// GET /api/driver/daily-reports — list this driver's historical reports
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const u = new URL(req.url);
    const limit = Math.min(Number(u.searchParams.get("limit") ?? 30), 90);
    const reports = await complianceReportRepo.listForDriver(d.userId, limit);
    // Attach counts
    const ids = reports.map(r => r.id);
    const counts = ids.length ? await attachmentRepo.countForReports(ids) : new Map<string, number>();
    return Response.json({ reports: reports.map(r => ({ ...r, attachmentCount: counts.get(r.id) ?? 0 })) });
  } catch (e) { return errorResponse(e); }
}

