# Deployment

## Requirements
Node 20, PostgreSQL 14+, a reachable Odoo (17+ assumed), HTTPS in front of the app, a persistent volume for evidence files.

## First install
1. `cp .env.example .env` and fill in every value (see below). Never commit `.env`.
2. `npm ci && npx prisma generate`
3. Create the first migration on a development machine: `npx prisma migrate dev --name init`, and commit `prisma/migrations`. (No migration files are included: they could not be generated without a database.)
4. Production: `npx prisma migrate deploy`
5. `npm run build`, then run **both** `npm start` (web) and `npm run worker` (OCR queue, ERP sync, reminders, polling). Without the worker nothing is written to Odoo and no reminders are sent.
6. Create accounts: `npm run accounts -- create --login ops1 --role ADMIN`, then drivers with `--role DRIVER --employee <Odoo employee ID>`. The generated password is shown once.
7. Install the Odoo module draft (`odoo_module/altabeer_fine`) after reviewing it; give the integration user write access to it.

## Environment (placeholders in `.env.example`)
`DATABASE_URL`, `SESSION_SECRET` (32+ random chars), `ALLOWED_ORIGINS`, `ODOO_BASE_URL/DB/API_KEY` (dedicated least-privilege integration user), `ODOO_PRODUCT_FUEL/PARKING`, `ODOO_DRIVER_DOMAIN`, `ODOO_WEBHOOK_SECRET`, `OCR_PROVIDER/OCR_API_KEY`, `SMTP_URL/EMAIL_FROM`, `JOB_SECRET`, `STORAGE_PATH`. Do **not** set `ODOO_MODE=mock`, `OCR_PROVIDER=mock` or `NOTIFY_MODE=mock` in production (the app refuses them).

## HTTPS and cookies
`NODE_ENV=production` makes session cookies `Secure`, adds HSTS, and tightens CSP. Terminate TLS at a reverse proxy and forward `Host`. Cookies are HttpOnly + SameSite=Strict; state-changing API calls from other origins are rejected (add extra trusted origins to `ALLOWED_ORIGINS`).

## Health and monitoring
`/api/health` is liveness. `/api/ready` returns 503 only if the database is down; a down ERP shows as `degraded`. Logs are one JSON line per event with secrets redacted. Watch the **Sync status** page for dead operations and the worker's console output.

## Backups and recovery
Back up the PostgreSQL database (`pg_dump`) **and** the evidence volume together; restore both from the same point in time. Odoo is the record for employees, vehicles, attendance, expenses and payslips, so it needs its own backup. After restoring, the worker's reconcile job re-aligns fines with Odoo.

## Rollback
Keep the previous image/build. Roll back the code first; only roll back the database if a migration was destructive (there are none yet), using the pre-deploy `pg_dump`.

## Verify a deployment
`/api/ready` is ok; sign in as admin; Sync status shows ERP reachable and recent job times; upload a test notice and see it reach "needs review"; sign in as a test driver, check in and out, and confirm the attendance appears in Odoo.

## Not provided
Evidence retention and deletion policy (decide with Al Tabeer's legal advice; nothing is auto-deleted), push notifications, WhatsApp, Redis-backed rate limiting (the built-in limiter is per instance), and automatic discovery of fines from an official feed.
