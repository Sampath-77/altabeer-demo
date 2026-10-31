import { driverRoute, wfDeps, readFile } from "@/lib/route";
import { submitPayment, ownFine } from "@/lib/fines/workflow";
import { AuthError } from "@/lib/auth/service";
export const POST = driverRoute(async (d, id, req) => {
  const deps = wfDeps(); await ownFine(deps, id, d.employeeId); // authorise before touching the file
  const { form, data, kind } = await readFile(req);
  if (!data || !kind) throw new AuthError("VALIDATION", 422, "Attach the payment receipt.");
  const key = await deps.storage.put(data, kind.ext);
  await submitPayment(deps, id, { employeeId: d.employeeId }, { amount: Number(form.get("amount")), reference: String(form.get("reference") ?? ""), evidenceKey: key });
}, 201);
