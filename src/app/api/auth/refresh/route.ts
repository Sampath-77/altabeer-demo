import { refresh } from "@/lib/auth/service";
import { prismaAuthRepo } from "@/lib/auth/prisma-repo";
import { cfg, sessionHeaders, clearHeaders, employeeGate } from "@/lib/auth/http";
import { errorResponse, getCookie } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";

export async function POST(req: Request) {
  try {
    const t = getCookie(req, "rt");
    if (!t) throw new AuthError("INVALID_SESSION", 401);
    const c = cfg();
    const s = await refresh(prismaAuthRepo, c, t, Date.now(), employeeGate);
    return Response.json({ user: s.user }, { headers: sessionHeaders(s, c) });
  } catch (e) {
    const r = errorResponse(e);
    if (e instanceof AuthError) clearHeaders().forEach((v, k) => r.headers.append(k, v));
    return r;
  }
}
