# System of record
| Data | Owner | Local copy |
|---|---|---|
| Employees, roles | Odoo | `User.odooEmployeeId` only (+ login credentials) |
| Vehicles, vendors, assignments | Odoo | IDs on `Fine`; no master copy |
| Attendance, expenses, payslips | Odoo | none (read-through); writes via `SyncOutbox` |
| Login credentials, sessions | App DB | n/a |
| Fine workflow, OCR, evidence | App DB | mirrored to an Odoo custom model via `Fine.odooRecordId` (Stage 7) |
| Notifications, audit logs | App DB | n/a |

Every Odoo write carries an `idempotencyKey` in `SyncOutbox`; retries use exponential backoff, then DEAD for admin review.
