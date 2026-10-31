import { adminRoute, wfDeps, readFile } from "@/lib/route";
import { submitPayment } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => {
  const deps = wfDeps(); const { form, data, kind } = await readFile(req);
  const key = data && kind ? await deps.storage.put(data, kind.ext) : undefined;
  await submitPayment(deps, id, { adminId: a.adminId }, { amount: Number(form.get("amount")), reference: String(form.get("reference") ?? ""), evidenceKey: key });
}, 201);
