import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { wfDeps } from "@/lib/fines/wf-prisma";
import { ownFine } from "@/lib/fines/workflow";
const T: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const d = await driverContext(req); const deps = wfDeps();
    const f = await ownFine(deps, params.id, d.employeeId); const k = f.evidenceKeys[0];
    if (!k) throw new AuthError("NOT_FOUND", 404, "No notice on file.");
    return new Response(new Uint8Array(await deps.storage.get(k)), { headers: { "Content-Type": T[k.split(".").pop()!] ?? "application/octet-stream", "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store", "Content-Security-Policy": "sandbox" } });
  } catch (e) { return errorResponse(e); }
}
