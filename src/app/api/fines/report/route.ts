import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { reportFine } from "@/lib/fines/workflow";
import { wfDeps } from "@/lib/fines/wf-prisma";
export async function POST(req: Request) {
  try { const d = await driverContext(req); const b = (await req.json().catch(() => ({}))) ?? {};
    const id = await reportFine(wfDeps(), d.employeeId, { amount: Number(b.amount), date: String(b.date ?? ""), note: typeof b.note === "string" ? b.note : "" }); return Response.json({ id }, { status: 201 }); } catch (e) { return errorResponse(e); }
}
