import { adminContext } from "@/lib/admin-ctx";
import { vehicleRows, paging } from "@/lib/admin";
import { errorResponse } from "@/lib/auth/guard";
export async function GET(req: Request) {
  try { const a = adminContext(req); const u = new URL(req.url); const s = u.searchParams.get("status");
    return Response.json(await vehicleRows(a.odoo, { search: u.searchParams.get("search")?.trim() || undefined, status: s === "inactive" || s === "all" ? s : "active" }, paging(u))); } catch (e) { return errorResponse(e); }
}
