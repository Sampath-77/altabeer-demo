import { driverContext } from "@/lib/driver";
import { submitExpense } from "@/lib/expenses";
import { prismaSubRepo } from "@/lib/db-repos";
import { localStorage_ } from "@/lib/storage";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { allow } from "@/lib/ratelimit";

export async function POST(req: Request) {
  try {
    const d = await driverContext(req);
    if (!allow(`expense:${d.userId}`, 20, 60_000)) throw new AuthError("RATE_LIMITED", 429, "Too many uploads. Wait a minute and try again.");
    const form = await req.formData().catch(() => { throw new AuthError("BAD_REQUEST", 400, "Send the receipt as a form upload."); });
    const f = form.get("receipt");
    const buf = f instanceof File ? Buffer.from(await f.arrayBuffer()) : null;
    const r = await submitExpense({ odoo: d.odoo, repo: prismaSubRepo, storage: localStorage_(), userId: d.userId, employeeId: d.employeeId },
      req.headers.get("idempotency-key") ?? "", { category: form.get("category"), amount: form.get("amount"), vendor: form.get("vendor") }, buf);
    return Response.json({ expense: r }, { status: 201 });
  } catch (e) { return errorResponse(e); }
}
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const expenses = await d.odoo.listExpenses(d.employeeId, { limit: 30 }).catch(() => { throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable."); });
    return Response.json({ expenses });
  } catch (e) { return errorResponse(e); }
}
