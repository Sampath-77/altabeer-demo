import { authenticate, assertOwnerOrAdmin, errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";
import { localStorage_ } from "@/lib/storage";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const claims = authenticate(req);
    const attachment = await prisma.driverReportAttachment.findUnique({
      where: { id: params.id },
      include: { report: { select: { driverUserId: true } } },
    });
    if (!attachment) throw new AuthError("NOT_FOUND", 404, "Attachment not found.");

    // Enforce driver-level record isolation: driver can only access their own attachments, admin can access all
    assertOwnerOrAdmin(claims, attachment.report.driverUserId);

    const data = await localStorage_().get(attachment.storageKey);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(attachment.originalFilename)}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

