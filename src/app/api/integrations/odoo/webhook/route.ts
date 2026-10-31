import { verifyWebhook } from "@/lib/sync/engine";
import { prismaSyncRepo } from "@/lib/sync/prisma";
/** Odoo calls this when an altabeer.fine record changes. The body only triggers a re-read; its data is never trusted. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhook(process.env.ODOO_WEBHOOK_SECRET ?? "", raw, req.headers.get("x-signature") ?? "", req.headers.get("x-timestamp") ?? "")) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Invalid signature." } }, { status: 401 });
  let b: { event_id?: unknown; record_id?: unknown }; try { b = JSON.parse(raw); } catch { return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid JSON." } }, { status: 400 }); }
  const id = typeof b.event_id === "string" ? b.event_id : "", rid = Number(b.record_id);
  if (!/^[\w-]{6,80}$/.test(id) || !Number.isInteger(rid)) return Response.json({ error: { code: "BAD_REQUEST", message: "event_id and record_id are required." } }, { status: 400 });
  await prismaSyncRepo.enqueue({ idempotencyKey: `webhook:${id}`, operation: "reconcile.fine", payload: { odooRecordId: rid } }); // repeated delivery of the same event is a no-op
  return Response.json({ ok: true }, { status: 202 });
}
