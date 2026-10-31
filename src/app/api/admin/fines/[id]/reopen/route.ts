import { adminRoute, wfDeps, body } from "@/lib/route";
import { reopenFine } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => reopenFine(wfDeps(), id, a.adminId, String((await body(req)).reason ?? "")));
