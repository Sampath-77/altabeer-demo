import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";
import { REASON_LABELS } from "@/lib/fines/pipeline";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const f = await prisma.fine.findUnique({ where: { id: params.id }, include: { ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 } } });
    if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");
    // Names come from Odoo, not OCR. Fail soft so the review screen still loads.
    const [veh, emp, ven] = await Promise.all([f.vehicleOdooId ? a.odoo.getVehicles([f.vehicleOdooId]) : [], f.driverOdooId ? a.odoo.listEmployees({ offset: 0, limit: 1, idIn: [f.driverOdooId] }).then(r => r.rows) : [], f.vendorOdooId ? a.odoo.getVendors([f.vendorOdooId]) : []]).catch(() => [[], [], []] as const);
    const job = f.ocrJobs[0] ?? null;
    return Response.json({ fine: { ...f, ocrJobs: undefined }, job: job && { id: job.id, status: job.status, provider: job.provider, confidence: job.confidence, errors: job.errors, rawText: job.rawText, fields: job.fields },
      fromErp: { vehicle: veh[0] ?? null, driver: emp[0] ?? null, vendor: ven[0] ?? null }, reasons: f.reviewReasons.map((r: string) => ({ code: r, message: REASON_LABELS[r as keyof typeof REASON_LABELS] ?? r })), evidenceUrl: f.evidenceKeys[0] ? `/api/admin/fines/${f.id}/evidence` : null });
  } catch (e) { return errorResponse(e); }
}
