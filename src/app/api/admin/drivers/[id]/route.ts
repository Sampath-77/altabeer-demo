import { adminContext } from "@/lib/admin-ctx";
import { driverDetail } from "@/lib/admin";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try { const a = adminContext(req); const id = Number(params.id); if (!Number.isInteger(id)) throw new AuthError("NOT_FOUND", 404, "Driver not found."); return Response.json(await driverDetail(a.odoo, id)); } catch (e) { return errorResponse(e); }
}
