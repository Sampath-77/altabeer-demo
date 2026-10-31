import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";
import { localStorage_ } from "@/lib/storage";

const TYPES: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    adminContext(req);
    const f = await prisma.fine.findUnique({ where: { id: params.id }, select: { evidenceKeys: true } });
    const key = f?.evidenceKeys[0]; if (!key) throw new AuthError("NOT_FOUND", 404, "No evidence file.");
    const data = await localStorage_().get(key);
    return new Response(new Uint8Array(data), { headers: { "Content-Type": TYPES[key.split(".").pop()!] ?? "application/octet-stream", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" } });
  } catch (e) { return errorResponse(e); }
}
