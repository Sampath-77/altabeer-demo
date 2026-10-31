import { secret } from "./guard";
import type { AuthConfig, Session } from "./service";

export const cfg = (): AuthConfig => ({
  secret: secret(),
  accessTtlSec: Number(process.env.ACCESS_TOKEN_TTL_MIN ?? 15) * 60,
  refreshTtlSec: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 14) * 86400,
  maxFailures: 5, lockMs: 15 * 60_000,
});
const flags = () => `HttpOnly; SameSite=Strict; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}`;
export function sessionHeaders(s: Session, c: AuthConfig): Headers {
  const h = new Headers();
  h.append("Set-Cookie", `at=${s.accessToken}; Path=/; Max-Age=${c.accessTtlSec}; ${flags()}`);
  h.append("Set-Cookie", `rt=${s.refreshToken}; Path=/api/auth; Max-Age=${c.refreshTtlSec}; ${flags()}`);
  return h;
}
export function clearHeaders(): Headers {
  const h = new Headers();
  h.append("Set-Cookie", `at=; Path=/; Max-Age=0; ${flags()}`);
  h.append("Set-Cookie", `rt=; Path=/api/auth; Max-Age=0; ${flags()}`);
  return h;
}
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

import { AuthError, type Gate } from "./service";
import { getOdooClient, isOdooConfigured } from "../odoo/client";
/** Drivers whose ERP employee record is archived cannot sign in or refresh. Fails closed if the ERP cannot be reached. */
export const employeeGate: Gate = async u => {
  if (u.role !== "DRIVER" || !u.odooEmployeeId || !isOdooConfigured()) return;
  let emp; try { emp = await getOdooClient().getEmployee(u.odooEmployeeId); } catch { throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable. Try again shortly."); }
  if (!emp || !emp.active) throw new AuthError("ACCOUNT_DISABLED", 403, "This account is disabled. Contact Al Tabeer operations.");
};
