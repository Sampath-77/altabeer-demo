import { driverRoute, wfDeps } from "@/lib/route";
import { acknowledge } from "@/lib/fines/workflow";
export const POST = driverRoute(async (d, id) => acknowledge(wfDeps(), id, d.employeeId));
