import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const deleted = await prisma.user.deleteMany({ where: { loginId: "drv001" } });
  console.log(`Deleted ${deleted.count} user(s) with loginId=drv001`);
}
main().catch(console.error).finally(() => prisma.$disconnect());

