# Synchronisation

**Odoo -> app (read-through, no local copy):** employees, vehicles, vendors, assignments, attendance, expenses and payslips are read from Odoo on every request, so changes in Odoo show up on the next refresh (admin pages poll every 30 s).
The worker additionally detects expense status changes (every 5 min) and new payslips (hourly) to notify drivers.

**App -> Odoo:** shifts, expenses and receipts are written synchronously (failure is shown to the user, nothing is faked).
Fines are written through `SyncOutbox`: each change enqueues an operation; the worker pushes the *current* state of the fine to `altabeer.fine` (idempotent by `app_id`), retrying transient failures with backoff (30 s doubling, capped at 1 h, 8 attempts) and dead-lettering permanent ones for an admin to retry.

**Conflicts:** every 15 min the worker compares synced fines with Odoo. If Odoo was edited after our last push and differs, it is recorded as a conflict and reported; neither side is overwritten. If the app is simply ahead, it re-pushes. `lastSyncedAt` is set from Odoo's own `write_date` after each push, so our writes are never mistaken for Odoo edits.

**Webhook (optional):** an Odoo automated action can POST `{event_id, record_id}` to `/api/integrations/odoo/webhook` (HMAC-signed, 5-minute window). It only triggers a re-read. Without it, the 15-minute reconcile still catches changes.

**Odoo module:** `odoo_module/altabeer_fine` is a DRAFT for Odoo 17. The integration user needs write access (HR manager group in the draft).
