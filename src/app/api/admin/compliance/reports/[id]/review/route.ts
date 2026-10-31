import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { adminReviewReport } from "@/lib/compliance/service";
import { AuthError } from "@/lib/auth/service";

// POST /api/admin/compliance/reports/[id]/review
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = body.action as "REVIEWED" | "CORRECTION_REQUESTED";
    const remarks = String(body.remarks ?? "").trim();
    if (action !== "REVIEWED" && action !== "CORRECTION_REQUESTED") {
      throw new AuthError("VALIDATION", 422, "action must be REVIEWED or CORRECTION_REQUESTED.");
    }
    await adminReviewReport(params.id, a.adminId, action, remarks);
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

