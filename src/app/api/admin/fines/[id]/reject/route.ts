import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { fineDeps } from "@/lib/fines/deps";
import { reject } from "@/lib/fines/pipeline";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try { const a = adminContext(req); const b = await req.json().catch(() => ({})); await reject(fineDeps(), params.id, a.adminId, String(b?.reason ?? "")); return Response.json({ ok: true }); } catch (e) { return errorResponse(e); }
}
