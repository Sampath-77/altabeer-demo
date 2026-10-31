import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { fineDeps } from "@/lib/fines/deps";
import { correct } from "@/lib/fines/pipeline";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req); const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new AuthError("BAD_REQUEST", 400, "Invalid body.");
    const r = await correct({ ...fineDeps(), odoo: a.odoo }, params.id, a.adminId, body);
    return Response.json({ reasons: r.reasons, candidates: r.candidates });
  } catch (e) { return errorResponse(e); }
}
