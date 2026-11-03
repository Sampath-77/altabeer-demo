import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { sniff } from "@/lib/expenses";
import { allow } from "@/lib/ratelimit";
import { fineDeps } from "@/lib/fines/deps";
import { ingest, runOcrJob } from "@/lib/fines/pipeline";

const MAX = 15 * 1024 * 1024;
export async function POST(req: Request) {
  try {
    const a = adminContext(req);
    if (!allow(`fine-upload:${a.adminId}`, 60, 60_000)) throw new AuthError("RATE_LIMITED", 429, "Too many uploads. Wait a minute and try again.");
    const form = await req.formData().catch(() => { throw new AuthError("BAD_REQUEST", 400, "Send the notice as a form upload."); });
    const f = form.get("file"); if (!(f instanceof File)) throw new AuthError("VALIDATION", 422, "Attach an image or PDF of the fine notice.");
    const data = Buffer.from(await f.arrayBuffer());
    if (data.length === 0 || data.length > MAX) throw new AuthError("VALIDATION", 422, "The file must be between 1 byte and 15 MB.");
    const kind = sniff(data); if (!kind) throw new AuthError("VALIDATION", 422, "Unsupported file. Use a JPEG, PNG, WebP or PDF.");
    const d = fineDeps(); const r = await ingest(d, {
      data,
      ext: kind.ext,
      mime: kind.mime,
      originalFilename: f.name || `challan.${kind.ext}`,
      uploadedBy: a.adminId,
    });
    try {
      await runOcrJob(d, r.jobId);
    } catch (ocrErr) {
      console.error("Immediate OCR failed (will remain queued for worker):", ocrErr);
    }
    return Response.json(r, { status: 202 });
  } catch (e) {
    console.error("Upload handler error:", e);
    return errorResponse(e);
  }
}
