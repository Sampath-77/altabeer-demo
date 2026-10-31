import { adminRoute, wfDeps, body } from "@/lib/route";
import { verifyPayment } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => { const b = await body(req); await verifyPayment(wfDeps(), id, a.adminId, b.approved === true, String(b.reason ?? "")); });
