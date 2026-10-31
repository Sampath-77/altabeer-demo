import type { OdooClient } from "./types";
import { createJson2Client } from "./json2";
import { MockOdoo } from "./mock";

export class OdooNotConfiguredError extends Error {
  constructor() { super("Odoo integration is not configured (ODOO_BASE_URL / ODOO_DB / ODOO_API_KEY)."); }
}
export const isOdooConfigured = () => process.env.ODOO_MODE === "mock" || Boolean(process.env.ODOO_BASE_URL && process.env.ODOO_DB && process.env.ODOO_API_KEY);

let mock: MockOdoo | undefined;

export function getOdooClient(): OdooClient {
  if (process.env.ODOO_MODE === "mock") {
    if (process.env.NODE_ENV === "production") throw new Error("ODOO_MODE=mock is not allowed in production.");
    return (mock ??= new MockOdoo());
  }
  if (!isOdooConfigured()) throw new OdooNotConfiguredError();
  return createJson2Client(process.env.ODOO_BASE_URL!, process.env.ODOO_DB!, process.env.ODOO_API_KEY!);
}
