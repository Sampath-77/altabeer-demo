import { authenticate, errorResponse } from "@/lib/auth/guard";
import { prisma } from "@/lib/auth/prisma-repo";
import { AuthError } from "@/lib/auth/service";
import { getOdooClient, isOdooConfigured } from "@/lib/odoo/client";

export async function GET(req: Request) {
  try {
    const c = authenticate(req);
    const u = await prisma.user.findUnique({ where: { id: c.sub }, select: { id: true, loginId: true, role: true, status: true, odooEmployeeId: true } });
    if (!u || u.status !== "ACTIVE") throw new AuthError("UNAUTHENTICATED", 401);
    let name: string | null = null;
    let jobTitle: string | null = null;
    if (u.odooEmployeeId && isOdooConfigured()) {
      try {
        const emp = await getOdooClient().getEmployee(u.odooEmployeeId);
        if (emp) {
          name = emp.name;
          jobTitle = emp.jobTitle ?? null;
        }
      } catch {}
    }
    return Response.json({ user: { ...u, name, jobTitle } });
  } catch (e) { return errorResponse(e); }
}
