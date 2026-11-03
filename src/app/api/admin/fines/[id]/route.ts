import { adminContext } from "@/lib/admin-ctx";
import { errorResponse, secret } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { signToken } from "@/lib/auth/token";
import { prisma } from "@/lib/auth/prisma-repo";
import { REASON_LABELS } from "@/lib/fines/pipeline";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const viewToken = signToken({ sub: a.adminId, role: "ADMIN" }, 3600, secret());
    const f = await prisma.fine.findUnique({
      where: { id: params.id },
      include: {
        ocrJobs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");
    // Names come from Odoo, not OCR. Fail soft so the review screen still loads.
    const [veh, emp, ven] = await Promise.all([f.vehicleOdooId ? a.odoo.getVehicles([f.vehicleOdooId]) : [], f.driverOdooId ? a.odoo.listEmployees({ offset: 0, limit: 1, idIn: [f.driverOdooId] }).then(r => r.rows) : [], f.vendorOdooId ? a.odoo.getVendors([f.vendorOdooId]) : []]).catch(() => [[], [], []] as const);
    const vehicle = veh[0] ?? null;
    let currentDriverName: string | null = null;
    if (vehicle?.currentDriverId) {
      try {
        const curEmp = await a.odoo.listEmployees({ offset: 0, limit: 1, idIn: [vehicle.currentDriverId] }).then(r => r.rows[0]);
        if (curEmp) currentDriverName = curEmp.name;
      } catch { /* fail soft */ }
    }
    const job = f.ocrJobs[0] ?? null;

    // Fail-soft metadata lookup for ChallanDocument
    let doc: any = null;
    const evidenceKey = f.evidenceKeys && f.evidenceKeys[0];
    if (evidenceKey) {
      try {
        doc = await prisma.challanDocument.findUnique({
          where: { storageKey: evidenceKey },
        });
      } catch {
        // Table does not exist yet or offline DB - fail soft completely!
      }
    }

    return Response.json({
      fine: { ...f, ocrJobs: undefined },
      job: job && { id: job.id, status: job.status, provider: job.provider, confidence: job.confidence, errors: job.errors, rawText: job.rawText, fields: job.fields },
      fromErp: { vehicle: vehicle ? { plate: vehicle.plate, model: vehicle.model, active: vehicle.active, status: vehicle.vehicleStatus, vendorName: vehicle.vendorName } : null, driver: emp[0] ?? null, driverAtViolation: emp[0] ?? null, currentDriver: currentDriverName ? { id: vehicle?.currentDriverId, name: currentDriverName } : null, vendor: ven[0] ?? (vehicle?.vendorName ? { id: vehicle.vendorId, name: vehicle.vendorName } : null) },
      reasons: f.reviewReasons.map((r: string) => ({ code: r, message: REASON_LABELS[r as keyof typeof REASON_LABELS] ?? r })),
      evidenceUrl: evidenceKey ? `/api/admin/fines/${f.id}/evidence?token=${viewToken}` : null,
      downloadUrl: evidenceKey ? `/api/admin/fines/${f.id}/evidence?token=${viewToken}&download=1` : null,
      isPdf: doc?.mimeType === "application/pdf" || (evidenceKey?.toLowerCase().endsWith(".pdf") ?? false),
      document: doc ? {
        filename: doc.originalFilename,
        mimeType: doc.mimeType,
        fileSizeBytes: doc.fileSizeBytes,
        status: doc.storageStatus,
        uploadedAt: doc.createdAt,
      } : null,
    });
  } catch (e) { return errorResponse(e); }
}
