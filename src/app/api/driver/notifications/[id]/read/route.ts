import { authenticate, requireRole, errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prismaNotifRepo } from "@/lib/db-repos";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const c = requireRole(authenticate(req), "DRIVER");
    if (!(await prismaNotifRepo.markRead(params.id, c.sub))) throw new AuthError("NOT_FOUND", 404, "Notification not found.");
    return Response.json({ ok: true });
  } catch (e) { return errorResponse(e); }
}
