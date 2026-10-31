import { prisma } from "./auth/prisma-repo";
import type { SubRepo } from "./expenses";
import type { NotifRepo } from "./notifications";

export const prismaSubRepo: SubRepo = {
  find: k => prisma.expenseSubmission.findUnique({ where: { idempotencyKey: k } }),
  create: r => prisma.expenseSubmission.create({ data: r }),
  setExpense: async (id, odooExpenseId) => { await prisma.expenseSubmission.update({ where: { id }, data: { odooExpenseId } }); },
  markAttached: async id => { await prisma.expenseSubmission.update({ where: { id }, data: { attached: true } }); },
};
export const prismaNotifRepo: NotifRepo = {
  list: (userId, limit) => prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit }),
  unread: userId => prisma.notification.count({ where: { userId, readAt: null } }),
  // Scoped by userId: another user's notification id simply matches nothing.
  markRead: async (id, userId) => (await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } })).count > 0,
  create: async (userId, n) => { await prisma.notification.create({ data: { userId, ...n } }); },
};
