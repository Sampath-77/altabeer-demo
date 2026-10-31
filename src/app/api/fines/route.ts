import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { prisma } from "@/lib/auth/prisma-repo";
import { toRec } from "@/lib/fines/repo-prisma";
import type { FineRec } from "@/lib/fines/pipeline";
import { driverDto, outstanding, UNRESOLVED } from "@/lib/fines/workflow";

export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const rows = await prisma.fine.findMany({ where: { driverOdooId: d.employeeId, OR: [{ workflow: { notIn: ["REVIEW_REQUIRED", "REJECTED"] } }, { reviewReasons: { has: "DRIVER_REPORTED" } }] }, orderBy: { violationAt: "desc" }, take: 200 });
    const recs: FineRec[] = rows.map((r: unknown) => toRec(r as never));
    const vs = await d.odoo.getVehicles([...new Set(recs.map(r => r.vehicleOdooId).filter((x): x is number => !!x))]).catch(() => []);
    const name = (id: number | null) => { const v = vs.find(x => x.id === id); return v ? `${v.model ? v.model + " · " : ""}${v.plate}` : null; };
    const fines = recs.map(r => driverDto(r, name(r.vehicleOdooId)));
    const open = recs.filter(r => UNRESOLVED.includes(r.workflow));
    return Response.json({ fines, summary: { unresolved: open.length, outstanding: Math.round(open.reduce((s, r) => s + outstanding(r), 0) * 100) / 100 } });
  } catch (e) { return errorResponse(e); }
}
