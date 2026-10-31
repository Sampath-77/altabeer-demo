import { authenticate, requireRole, errorResponse } from "@/lib/auth/guard";
import { prismaNotifRepo } from "@/lib/db-repos";
export async function GET(req: Request) {
  try {
    const c = requireRole(authenticate(req), "DRIVER");
    const [notifications, unread] = await Promise.all([prismaNotifRepo.list(c.sub, 50), prismaNotifRepo.unread(c.sub)]);
    return Response.json({ notifications, unread });
  } catch (e) { return errorResponse(e); }
}
