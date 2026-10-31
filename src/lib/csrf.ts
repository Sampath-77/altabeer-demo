/** Cookie-authenticated, state-changing requests must come from our own origin. SameSite=Strict is the first line; this is the second. */
export function csrfAllowed(o: { method: string; origin: string | null; secFetchSite: string | null; host: string | null; allowed: string[] }): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(o.method)) return true;
  if (o.origin) { try { const u = new URL(o.origin); return u.host === o.host || o.allowed.includes(u.origin); } catch { return false; } }
  return o.secFetchSite === null || o.secFetchSite === "same-origin" || o.secFetchSite === "none";
}
export function securityHeaders(prod: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Security-Policy": ["default-src 'self'", "script-src 'self' 'unsafe-inline'" + (prod ? "" : " 'unsafe-eval'"), "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join("; "),
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "same-origin", "Permissions-Policy": "camera=(self), microphone=(), geolocation=()",
  };
  if (prod) h["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return h;
}
