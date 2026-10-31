import { z } from "zod";
import { login, AuthError } from "@/lib/auth/service";
import { prismaAuthRepo } from "@/lib/auth/prisma-repo";
import { cfg, sessionHeaders, clientIp, employeeGate } from "@/lib/auth/http";
import { errorResponse } from "@/lib/auth/guard";
import { allow } from "@/lib/ratelimit";

const Body = z.object({ loginId: z.string().min(1).max(64), password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  try {
    if (!req.headers.get("content-type")?.includes("application/json")) throw new AuthError("BAD_REQUEST", 400);
    if (!allow(`login:${clientIp(req)}`, 20, 15 * 60_000)) throw new AuthError("RATE_LIMITED", 429, "Too many attempts. Try again later.");
    const body = Body.safeParse(await req.json().catch(() => null));
    if (!body.success) throw new AuthError("BAD_REQUEST", 400, "loginId and password are required.");
    const c = cfg();
    const s = await login(prismaAuthRepo, c, body.data.loginId, body.data.password, Date.now(), employeeGate);
    return Response.json({ user: s.user }, { headers: sessionHeaders(s, c) });
  } catch (e) { return errorResponse(e); }
}
