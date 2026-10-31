/* Admin-controlled account management. Usage:
 *   npm run accounts -- create --login drv001 --role DRIVER --employee 42 [--password ...]
 *   npm run accounts -- create --login ops1 --role ADMIN
 *   npm run accounts -- reset-password --login drv001
 *   npm run accounts -- disable --login drv001   |   enable --login drv001
 * A generated password is printed once to this terminal only. It is never logged or stored in plain text. */
import { prisma } from "../src/lib/auth/prisma-repo";
import { hashPassword } from "../src/lib/auth/password";
import { generatePassword, validateLoginId, validatePassword } from "../src/lib/accounts";
import { getOdooClient, isOdooConfigured } from "../src/lib/odoo/client";

const [cmd, ...rest] = process.argv.slice(2);
const arg = (k: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : undefined; };
const die = (m: string): never => { console.error(m); process.exit(1); };

async function main() {
  const login = arg("login") ?? die("--login is required"); const bad = validateLoginId(login); if (bad) die(bad);
  if (cmd === "create") {
    const role = arg("role"); if (role !== "ADMIN" && role !== "DRIVER") die("--role must be ADMIN or DRIVER");
    const emp = arg("employee") ? Number(arg("employee")) : null;
    if (emp) {
      if (!Number.isInteger(emp)) die("Invalid employee ID");
      if (isOdooConfigured()) {
        const e = await getOdooClient().getEmployee(emp);
        if (!e) die(`Employee ${emp} was not found in the ERP.`);
        if (!e!.active) die(`Employee ${emp} is inactive in the ERP.`);
        console.log(`Linking to ERP employee: ${e!.name}`);
      }
    } else if (role === "DRIVER") {
      die("Drivers need --employee <Odoo employee ID>");
    }
    const pw = arg("password") ?? generatePassword(); const pe = validatePassword(pw, login); if (pe) die(pe);
    await prisma.user.create({ data: { loginId: login, passwordHash: await hashPassword(pw), role: role as "ADMIN" | "DRIVER", odooEmployeeId: emp } });
    console.log(`Created ${role} ${login}.${arg("password") ? "" : ` Password (shown once): ${pw}`}`);
  } else if (cmd === "reset-password") {
    const u = await prisma.user.findUnique({ where: { loginId: login } }); if (!u) die("No such user.");
    const pw = arg("password") ?? generatePassword(); const pe = validatePassword(pw, login); if (pe) die(pe);
    await prisma.user.update({ where: { loginId: login }, data: { passwordHash: await hashPassword(pw), failedLogins: 0, lockedUntil: null } });
    await prisma.refreshToken.updateMany({ where: { userId: u!.id, revokedAt: null }, data: { revokedAt: new Date() } });   // sign out every device
    console.log(`Password reset; all sessions revoked.${arg("password") ? "" : ` New password (shown once): ${pw}`}`);
  } else if (cmd === "disable" || cmd === "enable") {
    const u = await prisma.user.findUnique({ where: { loginId: login } }); if (!u) die("No such user.");
    await prisma.user.update({ where: { loginId: login }, data: { status: cmd === "disable" ? "DISABLED" : "ACTIVE" } });
    if (cmd === "disable") await prisma.refreshToken.updateMany({ where: { userId: u!.id, revokedAt: null }, data: { revokedAt: new Date() } });
    console.log(`${login} ${cmd}d.`);
  } else die("Commands: create | reset-password | disable | enable");
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
