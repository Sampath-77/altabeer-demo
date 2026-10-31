import { logout } from "@/lib/auth/service";
import { prismaAuthRepo } from "@/lib/auth/prisma-repo";
import { clearHeaders } from "@/lib/auth/http";
import { getCookie, errorResponse } from "@/lib/auth/guard";

export async function POST(req: Request) {
  try {
    await logout(prismaAuthRepo, getCookie(req, "rt"));
    return Response.json({ ok: true }, { headers: clearHeaders() });
  } catch (e) { return errorResponse(e); }
}
