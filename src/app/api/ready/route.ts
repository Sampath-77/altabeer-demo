import { prisma } from "@/lib/auth/prisma-repo";
import { getOdooClient, isOdooConfigured } from "@/lib/odoo/client";
import { probeOdoo } from "@/lib/sync/engine";
/** Readiness: 503 only if the database is down (the app cannot work at all). A down ERP reports "degraded" with 200 so the instance is not restarted for someone else's outage. */
export async function GET() {
  let db = false; try { await prisma.$queryRaw`SELECT 1`; db = true; } catch {}
  const erp = isOdooConfigured() ? (await probeOdoo(getOdooClient())).ok : null;
  return Response.json({ status: !db ? "down" : erp === false ? "degraded" : "ok", database: db, erp }, { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
