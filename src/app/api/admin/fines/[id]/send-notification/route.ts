import { adminRoute, wfDeps, body } from "@/lib/route";
import { vendorNotification } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => vendorNotification(wfDeps(), id, a.adminId, { key: req.headers.get("idempotency-key") ?? "", preview: (await body(req)).preview === true }));
