import { isOdooConfigured } from "@/lib/odoo/client";
export async function GET() {
  return Response.json({ status: "ok", odooConfigured: isOdooConfigured() });
}
