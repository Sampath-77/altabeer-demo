import { prisma } from "../auth/prisma-repo";
import { prismaFineRepo, toRec } from "./repo-prisma";
import { getOdooClient } from "../odoo/client";
import { getEmailProvider } from "./notify";
import { localStorage_ } from "../storage";
import type { WfRepo, WfDeps } from "./workflow";

const p2002 = (e: unknown) => (e as { code?: string })?.code === "P2002";
export const prismaWfRepo: WfRepo = {
  ...prismaFineRepo,
  driverUserId: async emp => (await prisma.user.findFirst({ where: { odooEmployeeId: emp, role: "DRIVER", status: "ACTIVE" }, select: { id: true } }))?.id ?? null,
  adminUserIds: async () => (await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } })).map((u: { id: string }) => u.id),
  addNotification: async (userId, n) => { try { await prisma.notification.create({ data: { userId, ...n } }); } catch (e) { if (!p2002(e)) throw e; } },
  claimLog: async l => { try { const r = await prisma.notificationLog.create({ data: { ...l, status: "QUEUED" } }); return { id: r.id }; } catch (e) { if (p2002(e)) return null; throw e; } },
  finishLog: async (id, r) => { await prisma.notificationLog.update({ where: { id }, data: { status: r.status, providerRef: r.providerRef, providerResponse: (r.response ?? undefined) as never, attempts: { increment: 1 } } }); },
  dueFines: async () => (await prisma.fine.findMany({ where: { workflow: { in: ["ACK_PENDING", "ACKNOWLEDGED", "PAYMENT_PENDING"] }, deadline: { not: null }, deadlineSource: { not: null } } })).map(toRec),
};
export const wfDeps = (): WfDeps => ({ odoo: getOdooClient(), repo: prismaWfRepo, storage: localStorage_(), email: getEmailProvider });
