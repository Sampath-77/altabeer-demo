import { adminRoute, wfDeps, body } from "@/lib/route";
import { approveAndActivate } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => approveAndActivate(wfDeps(), id, a.adminId, { confirmNotDuplicate: (await body(req)).confirmNotDuplicate === true }));
