import { driverContext } from "@/lib/driver";
import { shiftService } from "@/lib/shifts";
import { errorResponse } from "@/lib/auth/guard";
import { prismaNotifRepo } from "@/lib/db-repos";
import { complianceFlagRepo, complianceReportRepo } from "@/lib/compliance/repo-prisma";
import { dubaiDate } from "@/lib/compliance/schedule";

import type { OdooExpense } from "@/lib/odoo/types";
const sum = (l: OdooExpense[] | null, c: string) => l ? { available: true as const, total: Math.round(l.filter(e => e.category === c && e.status !== "refused").reduce((a, e) => a + e.amount, 0) * 100) / 100 } : na("Could not load expenses from the ERP.");
const na = (reason: string) => ({ available: false as const, reason });
export async function GET(req: Request) {
  try {
    const d = await driverContext(req);
    const s = shiftService(d.odoo, d.employeeId);
    const nowMs = Date.now();
    const today = dubaiDate(nowMs);
    const monthStart = new Date(Date.UTC(new Date(nowMs + 4 * 3600e3).getUTCFullYear(), new Date(nowMs + 4 * 3600e3).getUTCMonth(), 1));
    const [emp, shift, stats, asg, exps, unread, activeFlag, todayReport] = await Promise.allSettled([
      d.odoo.getEmployee(d.employeeId), s.current(), s.monthStats(), d.odoo.getAssignmentFor(d.employeeId),
      d.odoo.listExpenses(d.employeeId, { since: monthStart, limit: 500 }), prismaNotifRepo.unread(d.userId),
      complianceFlagRepo.findActiveForDriver(d.userId),
      complianceReportRepo.findByDriverDate(d.userId, today),
    ]);
    if (emp.status === "rejected" && shift.status === "rejected") throw emp.reason; // Odoo down: fail visibly
    const v = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    const e = v(emp), a = v(asg);
    const flag = v(activeFlag);
    const todayRpt = v(todayReport);
    return Response.json({
      driver: e ? { name: e.name, role: e.jobTitle ?? null } : null,
      shift: v(shift), month: v(stats),
      assignment: a ? { plate: a.vehicle.plate, model: a.vehicle.model ?? null, since: a.assignment.from } : null,
      earnings: na("Payroll integration arrives in a later stage; no figure is estimated."),
      fuel: sum(v(exps), "fuel"), parking: sum(v(exps), "parking"), unreadNotifications: v(unread) ?? 0, fines: na("Fines arrive in a later stage."),
      // Compliance status — drives the restriction banner on the home screen
      compliance: {
        restricted: !!flag,
        activeFlag: flag ? { id: flag.id, flagReference: flag.flagReference, reportingDate: flag.reportingDate, reason: flag.reason } : null,
        todayReportSubmitted: !!todayRpt,
        todayReportReference: todayRpt?.reportReference ?? null,
        todayReportType: todayRpt?.reportType ?? null,
      },
      partial: [emp, shift, stats, asg, exps].some(r => r.status === "rejected"),
    });
  } catch (e) { return errorResponse(e); }
}
