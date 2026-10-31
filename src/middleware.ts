import { NextResponse, type NextRequest } from "next/server";
import { csrfAllowed, securityHeaders } from "./lib/csrf";

const EXEMPT = ["/api/integrations/odoo/webhook", "/api/internal/"]; // token/HMAC authenticated, no cookies
export function middleware(req: NextRequest) {
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api/") && !EXEMPT.some(e => p.startsWith(e)) && !csrfAllowed({ method: req.method, origin: req.headers.get("origin"), secFetchSite: req.headers.get("sec-fetch-site"), host: req.headers.get("host"), allowed: (process.env.ALLOWED_ORIGINS ?? "").split(",").filter(Boolean) }))
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Cross-site request blocked." } }, { status: 403 });
  const res = NextResponse.next(); for (const [k, v] of Object.entries(securityHeaders(process.env.NODE_ENV === "production"))) res.headers.set(k, v); return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
