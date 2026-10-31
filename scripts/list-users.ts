import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ select: { loginId: true, role: true, odooEmployeeId: true, status: true } });
  console.log("Current app users:");
  console.table(users);
}
main().catch(console.error).finally(() => prisma.$disconnect());

