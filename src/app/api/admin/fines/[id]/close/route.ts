import { adminRoute, wfDeps, body } from "@/lib/route";
import { closeFine } from "@/lib/fines/workflow";
export const POST = adminRoute(async (a, id, req) => closeFine(wfDeps(), id, a.adminId, String((await body(req)).reason ?? "")));
