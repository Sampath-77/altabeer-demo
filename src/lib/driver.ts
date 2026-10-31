import { authenticate, requireRole } from "./auth/guard";
import { prisma } from "./auth/prisma-repo";
import { AuthError } from "./auth/service";
import { getOdooClient } from "./odoo/client";

/** Resolves the caller strictly from the session. No driver ID is ever read from the URL or body. */
export async function driverContext(req: Request) {
  const claims = requireRole(authenticate(req), "DRIVER");
  const u = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!u || u.status !== "ACTIVE") throw new AuthError("UNAUTHENTICATED", 401);
  if (!u.odooEmployeeId) throw new AuthError("NOT_LINKED", 409, "Your login is not linked to an employee record. Contact operations.");
  return { userId: u.id, employeeId: u.odooEmployeeId, odoo: getOdooClient() };
}
