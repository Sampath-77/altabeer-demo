import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { fineDeps } from "@/lib/fines/deps";
import { correct } from "@/lib/fines/pipeline";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try { const a = adminContext(req); const r = await correct(fineDeps(), params.id, a.adminId, {}); return Response.json({ reasons: r.reasons, candidates: r.candidates }); } catch (e) { return errorResponse(e); }
}
