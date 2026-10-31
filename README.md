# Al Tabeer Driver App and Fleet / Traffic Fine Management

Driver PWA (shifts, expenses, fines, payslips, notifications) and admin dashboard (driver and shift monitoring, vehicles, vendors, OCR fine intake and review, fine workflow, reports, sync status, audit log), integrated with Odoo.

- Stack: Next.js 14, TypeScript, PostgreSQL (Prisma), Zod, Vitest.
- Start with `docs/DEPLOYMENT.md`. API: `docs/API.md`. Data ownership: `docs/DATA-OWNERSHIP.md`. Sync design: `docs/SYNC.md`.
- Develop without Odoo: `ODOO_MODE=mock OCR_PROVIDER=mock NOTIFY_MODE=mock npm run dev` (in-memory stand-ins, development only).
- Tests: `npm test` (no database or Odoo needed). `npm run typecheck`.
- Odoo field/model names in `src/lib/odoo/json2.ts` (`ODOO_MAP`) are unverified assumptions. Confirm them against your instance first.
