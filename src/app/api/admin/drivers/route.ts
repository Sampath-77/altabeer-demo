import { adminContext } from "@/lib/admin-ctx";
import { driverRows, paging } from "@/lib/admin";
import { errorResponse } from "@/lib/auth/guard";
const pick = <T extends string>(v: string | null, ok: readonly T[]) => (ok.includes(v as T) ? (v as T) : undefined);
export async function GET(req: Request) {
  try {
    const a = adminContext(req); const u = new URL(req.url); const g = (k: string) => u.searchParams.get(k);
    return Response.json(await driverRows(a.odoo, {
      search: g("search")?.trim() || undefined, status: pick(g("status"), ["active", "inactive", "all"]), shift: pick(g("shift"), ["in", "out", "all"]),
      vendorId: Number(g("vendorId")) || undefined, vehicle: g("vehicle")?.trim() || undefined }, paging(u)));
  } catch (e) { return errorResponse(e); }
}
