import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { adminResolveFlag } from "@/lib/compliance/service";
import { AuthError } from "@/lib/auth/service";
import type { FlagResolutionReason } from "@prisma/client";

const VALID_REASONS: FlagResolutionReason[] = [
  "REPORT_SUBMITTED", "SUBMITTED_EXTERNAL_CHANNEL", "INCORRECT_REQUIREMENT",
  "APPROVED_EXCEPTION", "ADMIN_TEMPORARY_OVERRIDE", "OTHER",
];

// POST /api/admin/compliance/flags/[id]/resolve
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = body.reason as FlagResolutionReason;
    const remarks = String(body.remarks ?? "").trim();
    const override = body.override === true;

    if (!VALID_REASONS.includes(reason)) {
      throw new AuthError("VALIDATION", 422, `Invalid resolution reason. Valid options: ${VALID_REASONS.join(", ")}.`);
    }
    if (!remarks) throw new AuthError("VALIDATION", 422, "Explanation/remarks are required.");

    await adminResolveFlag(params.id, a.adminId, reason, remarks, override);
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}

