import { driverRoute, wfDeps, body } from "@/lib/route";
import { dispute } from "@/lib/fines/workflow";
export const POST = driverRoute(async (d, id, req) => dispute(wfDeps(), id, d.employeeId, String((await body(req)).reason ?? "")));
