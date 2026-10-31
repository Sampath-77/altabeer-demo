import { adminContext } from "@/lib/admin-ctx";
import { vendorRows, paging } from "@/lib/admin";
import { errorResponse } from "@/lib/auth/guard";
export async function GET(req: Request) {
  try { const a = adminContext(req); const u = new URL(req.url);
    return Response.json(await vendorRows(a.odoo, { search: u.searchParams.get("search")?.trim() || undefined }, paging(u))); } catch (e) { return errorResponse(e); }
}
