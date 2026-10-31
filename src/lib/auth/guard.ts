import { verifyToken, type Claims, type RoleName } from "./token";
import { AuthError } from "./service";
import { log } from "../log";

export function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars).");
  return s;
}
export function getCookie(req: Request, name: string): string | undefined {
  const m = (req.headers.get("cookie") ?? "").split(/;\s*/).find(c => c.startsWith(name + "="));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : undefined;
}
export function authenticate(req: Request, sec = secret(), now = Date.now()): Claims {
  const t = getCookie(req, "at");
  const c = t ? verifyToken(t, sec, now) : null;
  if (!c) throw new AuthError("UNAUTHENTICATED", 401, "Sign in required.");
  return c;
}
export function requireRole(c: Claims, ...roles: RoleName[]): Claims {
  if (!roles.includes(c.role)) throw new AuthError("FORBIDDEN", 403, "You do not have access to this resource.");
  return c;
}
/** Drivers may only touch their own records; admins pass. Never trust an ID from the URL/body for drivers. */
export function assertOwnerOrAdmin(c: Claims, ownerUserId: string): void {
  if (c.role !== "ADMIN" && c.sub !== ownerUserId) throw new AuthError("FORBIDDEN", 403, "You do not have access to this resource.");
}
export function errorResponse(e: unknown): Response {
  if (e instanceof AuthError) return Response.json({ error: { code: e.code, message: e.message, ...(e.extra ?? {}) } }, { status: e.status });
  log("error", "unhandled", { error: e instanceof Error ? e.name : "unknown" }); // name only: no stack or message that could carry secrets
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}
