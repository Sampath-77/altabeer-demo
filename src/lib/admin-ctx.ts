import { authenticate, requireRole } from "./auth/guard";
import { getOdooClient } from "./odoo/client";
export function adminContext(req: Request) {
  const c = requireRole(authenticate(req), "ADMIN");
  return { adminId: c.sub, odoo: getOdooClient() };
}
