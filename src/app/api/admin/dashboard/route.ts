import { adminContext } from "@/lib/admin-ctx";
import { dashboard } from "@/lib/admin";
import { errorResponse } from "@/lib/auth/guard";
export async function GET(req: Request) { try { return Response.json(await dashboard(adminContext(req).odoo)); } catch (e) { return errorResponse(e); } }
