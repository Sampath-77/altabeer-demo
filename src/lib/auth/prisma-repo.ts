import { PrismaClient } from "@prisma/client";
import type { AuthRepo } from "./service";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? (g.prisma = new PrismaClient());

export const prismaAuthRepo: AuthRepo = {
  findByLoginId: l => prisma.user.findUnique({ where: { loginId: l } }),
  findById: id => prisma.user.findUnique({ where: { id } }),
  setFailures: async (id, failedLogins, lockedUntil) => { await prisma.user.update({ where: { id }, data: { failedLogins, lockedUntil } }); },
  createRefresh: async r => { await prisma.refreshToken.create({ data: r }); },
  findRefresh: h => prisma.refreshToken.findUnique({ where: { tokenHash: h } }),
  revokeRefresh: async id => { await prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }); },
  revokeAllForUser: async userId => { await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); },
};
