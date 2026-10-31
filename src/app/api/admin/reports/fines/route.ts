import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { prisma } from "@/lib/auth/prisma-repo";
import { toRec } from "@/lib/fines/repo-prisma";
import * as R from "@/lib/reports";
import type { FineRec } from "@/lib/fines/pipeline";

const TYPES = ["daily", "vendor", "vehicle", "driver", "overdue", "resolution", "unmatched", "duplicates", "notifications", "sync", "ocr"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/; const MAX = 5000;
export async function GET(req: Request) {
  try {
    const a = adminContext(req); const u = new URL(req.url); const g = (k: string) => u.searchParams.get(k);
    const type = g("type") ?? ""; if (!TYPES.includes(type)) throw new AuthError("BAD_REQUEST", 400, `type must be one of ${TYPES.join(", ")}.`);
    const day = g("date") ?? R.dubaiDay(Date.now()); const from = g("from"), to = g("to");
    for (const d of [day, from, to]) if (d && !DAY_RE.test(d)) throw new AuthError("BAD_REQUEST", 400, "Dates must be YYYY-MM-DD.");
    const now = Date.now(); let table: R.Table; let truncated = false; let namesNote: string | undefined;

    if (type === "notifications") table = R.notificationFailures(await prisma.notificationLog.findMany({ where: { status: "FAILED" }, orderBy: { createdAt: "desc" }, take: MAX }));
    else if (type === "sync") table = R.syncFailures(await prisma.syncOutbox.findMany({ where: { status: { in: ["DEAD", "FAILED"] } }, orderBy: { updatedAt: "desc" }, take: MAX }));
    else if (type === "ocr") {
      const [processed, failed, corrected] = await Promise.all([prisma.ocrJob.count({ where: { status: { in: ["DONE", "FAILED"] } } }), prisma.ocrJob.count({ where: { status: "FAILED" } }), prisma.auditLog.findMany({ where: { action: "fine.corrected" }, distinct: ["entityId"], select: { entityId: true } })]);
      table = R.ocrReport({ processed, failed, corrected: corrected.length });
    } else {
      const where: Record<string, unknown> = {};
      if (type === "daily") { const r = R.dubaiDayRange(day); where.OR = [{ noticeReceivedAt: { gte: r.from, lte: r.to } }, { workflow: { in: ["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING", "PAID_AWAITING_VERIFICATION", "DISPUTED", "UNDER_REVIEW", "REVIEW_REQUIRED"] } }]; }
      else if (from || to) where.noticeReceivedAt = { ...(from ? { gte: R.dubaiDayRange(from).from } : {}), ...(to ? { lte: R.dubaiDayRange(to).to } : {}) };
      const raw = await prisma.fine.findMany({ where, orderBy: { noticeReceivedAt: "desc" }, take: MAX + 1 }); truncated = raw.length > MAX;
      const rows: FineRec[] = (raw as unknown[]).slice(0, MAX).map(r => toRec(r as never));
      // names come from the ERP; fall back to IDs so a report never fails because Odoo is slow
      const ids = (k: "vendorOdooId" | "vehicleOdooId" | "driverOdooId") => [...new Set(rows.map(r => r[k]).filter((x): x is number => !!x))];
      const vendors = new Map<number, string>(), vehicles = new Map<number, string>(), drivers = new Map<number, string>();
      try {
        for (const v of await a.odoo.getVendors(ids("vendorOdooId"))) vendors.set(v.id, v.name);
        for (const v of await a.odoo.getVehicles(ids("vehicleOdooId"))) vehicles.set(v.id, v.model ? `${v.plate} (${v.model})` : v.plate);
        const di = ids("driverOdooId"); if (di.length) for (const e of (await a.odoo.listEmployees({ offset: 0, limit: di.length, idIn: di })).rows) drivers.set(e.id, e.name);
      } catch { namesNote = "ERP names were unavailable; IDs are shown instead."; }
      const names: R.Names = { vendor: id => (id == null ? "" : vendors.get(id) ?? `Vendor #${id}`), vehicle: id => (id == null ? "" : vehicles.get(id) ?? `Vehicle #${id}`), driver: id => (id == null ? "" : drivers.get(id) ?? `Employee #${id}`) };
      table = type === "daily" ? R.dailyReport(rows, day, now, names) : type === "vendor" ? R.vendorReport(rows, now, names) : type === "vehicle" ? R.vehicleReport(rows, now, names) : type === "driver" ? R.driverReport(rows, names)
        : type === "overdue" ? R.overdueReport(rows, now, names) : type === "resolution" ? R.resolutionReport(rows, names) : type === "unmatched" ? R.unmatchedReport(rows, names) : R.duplicatesReport(rows, names);
    }
    const notes = [table.note, namesNote, truncated ? `Showing the latest ${MAX} fines only. Narrow the date range.` : null].filter(Boolean).join(" ");
    if (g("format") === "csv") return new Response(R.toCsv({ ...table, note: notes }), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${type}-report-${day}.csv"`, "Cache-Control": "private, no-store" } });
    return Response.json({ ...table, note: notes || undefined, generatedAt: new Date(now).toISOString() });
  } catch (e) { return errorResponse(e); }
}
