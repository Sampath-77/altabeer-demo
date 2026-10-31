# API reference (as implemented)

All routes are JSON unless noted. Auth is by HttpOnly cookies (`at` access token, `rt` refresh token). Errors: `{ "error": { "code", "message" } }`.
Common codes: 400 BAD_REQUEST, 401 UNAUTHENTICATED/INVALID_SESSION, 403 FORBIDDEN/ACCOUNT_DISABLED, 404 NOT_FOUND, 409 CONFLICT, 422 VALIDATION, 429 RATE_LIMITED, 502 ODOO_UNAVAILABLE.
These are summaries, not a generated OpenAPI file. Route names differ from the spec's proposal where a simpler form was used.

## Auth
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/login | anyone (rate limited, lockout after 5 failures) | `{loginId,password}`; sets cookies |
| POST | /api/auth/refresh | cookie `rt` | rotates refresh token; reuse revokes all sessions |
| POST | /api/auth/logout | any | revokes refresh token |
| GET | /api/me | signed in | current user |

## Driver (role DRIVER; identity always from the session)
| Method | Path | Purpose |
|---|---|---|
| GET | /api/driver/dashboard | name, role, shift, month stats, vehicle, fuel/parking totals, unread count |
| GET | /api/shifts/current, /api/shifts?limit= | current shift, history |
| POST | /api/shifts/check-in, /api/shifts/check-out | 409 ALREADY_CHECKED_IN / NO_OPEN_SHIFT |
| GET/POST | /api/expenses | list; submit (multipart `category,amount,vendor,receipt`, header `Idempotency-Key`) |
| GET | /api/payslips, /api/payslips/{id} | own released payslips only (others: 404) |
| GET | /api/driver/notifications; POST /api/driver/notifications/{id}/read | own only |
| GET | /api/fines | own fines + summary |
| POST | /api/fines/report | `{amount,date,note}` goes to admin review |
| POST | /api/fines/{id}/acknowledge, /dispute, /payment-evidence | own fines only; payment-evidence is multipart `file,amount,reference` |
| GET | /api/fines/{id}/evidence | own notice file |

## Admin (role ADMIN)
| Method | Path | Purpose |
|---|---|---|
| GET | /api/admin/dashboard, /api/admin/fines/stats | metrics (definitions returned in the payload) |
| GET | /api/admin/drivers, /drivers/{id}, /vehicles, /vendors | paginated (`page`,`pageSize`<=100) with filters |
| POST | /api/admin/fines/upload | multipart `file`; 202, OCR runs in the background |
| GET | /api/admin/fines, /fines/{id}, /fines/{id}/evidence, /fines/{id}/history | list, review data, original file, audit and notification history |
| POST | /api/admin/fines/{id}/correct, /rematch, /approve, /reject | review actions (audited) |
| POST | /api/admin/fines/{id}/send-notification | vendor email; body `{preview:true}` previews; header `Idempotency-Key` |
| POST | /api/admin/fines/{id}/record-payment, /verify-payment, /close, /reopen | payment and closure workflow |
| GET | /api/admin/reports/fines?type=&date=&from=&to=&format=csv | reports (daily, vendor, vehicle, driver, overdue, resolution, unmatched, duplicates, ocr, notifications, sync) |
| GET | /api/admin/sync-status; POST /api/admin/sync/{id}/retry | integration health, retry a dead operation |
| GET | /api/admin/audit-logs | filterable audit trail |

## Integration and operations
| Method | Path | Auth |
|---|---|---|
| POST | /api/integrations/odoo/webhook | HMAC `X-Signature` over `<X-Timestamp>.<body>` |
| POST | /api/internal/jobs/deadlines | `Authorization: Bearer $JOB_SECRET` |
| GET | /api/health (liveness), /api/ready (database + ERP) | none |
