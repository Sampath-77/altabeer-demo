import { adminContext } from "./admin-ctx";
import { driverContext } from "./driver";
import { errorResponse } from "./auth/guard";
import { AuthError } from "./auth/service";
import { sniff } from "./expenses";
import { NotConfigured } from "./fines/notify";
import { wfDeps } from "./fines/wf-prisma";

type Ctx = { params: { id: string } };
export const adminRoute = (fn: (a: ReturnType<typeof adminContext>, id: string, req: Request) => Promise<unknown>, status = 200) => async (req: Request, { params }: Ctx) => {
  try { const a = adminContext(req); return Response.json((await fn(a, params.id, req)) ?? { ok: true }, { status }); }
  catch (e) { return errorResponse(e instanceof NotConfigured ? new AuthError("EMAIL_NOT_CONFIGURED", 503, e.message) : e); }
};
export const driverRoute = (fn: (d: Awaited<ReturnType<typeof driverContext>>, id: string, req: Request) => Promise<unknown>, status = 200) => async (req: Request, { params }: Ctx) => {
  try { const d = await driverContext(req); return Response.json((await fn(d, params.id, req)) ?? { ok: true }, { status }); } catch (e) { return errorResponse(e); }
};
export const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
export async function readFile(req: Request) {
  const form = await req.formData().catch(() => { throw new AuthError("BAD_REQUEST", 400, "Send the receipt as a form upload."); });
  const f = form.get("file"); let data: Buffer | null = null, kind: ReturnType<typeof sniff> = null;
  if (f instanceof File) { data = Buffer.from(await f.arrayBuffer()); if (data.length > 8 * 1024 * 1024) throw new AuthError("VALIDATION", 422, "The file is larger than 8 MB."); kind = sniff(data); if (!kind) throw new AuthError("VALIDATION", 422, "Unsupported file. Use a JPEG, PNG, WebP or PDF."); }
  return { form, data, kind };
}
export { wfDeps };
