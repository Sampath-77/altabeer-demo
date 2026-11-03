import { adminContext } from "@/lib/admin-ctx";
import { errorResponse, secret } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { verifyToken } from "@/lib/auth/token";
import { prisma } from "@/lib/auth/prisma-repo";
import { localStorage_ } from "@/lib/storage";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    // 1. Authenticate via admin session cookie OR ?token= query parameter
    const url = new URL(req.url);
    const qToken = url.searchParams.get("token");
    let authenticated = false;

    try {
      adminContext(req);
      authenticated = true;
    } catch (authErr) {
      if (qToken) {
        const claims = verifyToken(qToken, secret());
        if (claims && claims.role === "ADMIN") {
          authenticated = true;
        }
      }
      if (!authenticated) throw authErr;
    }

    const f = await prisma.fine.findUnique({ where: { id: params.id }, select: { evidenceKeys: true } });
    const key = f?.evidenceKeys[0];
    if (!key) throw new AuthError("NOT_FOUND", 404, "No evidence file recorded for this fine.");

    const data = await localStorage_().get(key);
    const ext = key.split(".").pop()?.toLowerCase() || "png";
    const mime = TYPES[ext] ?? "application/octet-stream";

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="challan-${params.id}.${ext}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    console.error("Evidence route error for fine", params.id, ":", e);
    return errorResponse(e);
  }
}
