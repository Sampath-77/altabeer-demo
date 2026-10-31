import { fineDeps } from "./lib/fines/deps";
import { processQueued } from "./lib/fines/pipeline";
import { runDeadlineJob } from "./lib/fines/workflow";
import { wfDeps } from "./lib/fines/wf-prisma";
import { syncDeps } from "./lib/sync/prisma";
import { processOutbox, reconcileAll, pollExpenses, pollPayslips } from "./lib/sync/engine";
import { runComplianceCheckJob, runDailySummaryJob } from "./lib/compliance/service";
import { getOdooClient } from "./lib/odoo/client";

/** `npm run worker`: OCR queue every 5 s, ERP outbox every 5 s, deadlines/reconcile/polls on their own cadence. One failing task never stops the others. */
const every: { name: string; ms: number; last: number; run: () => Promise<unknown> }[] = [
  { name: "ocr", ms: 5_000, last: 0, run: () => processQueued(fineDeps()) },
  { name: "outbox", ms: 5_000, last: 0, run: () => processOutbox(syncDeps()) },
  { name: "expenses", ms: 5 * 60_000, last: 0, run: () => pollExpenses(syncDeps()) },
  { name: "reconcile", ms: 15 * 60_000, last: 0, run: () => reconcileAll(syncDeps()) },
  { name: "deadlines", ms: 60 * 60_000, last: 0, run: () => runDeadlineJob(wfDeps()) },
  { name: "payslips", ms: 60 * 60_000, last: 0, run: () => pollPayslips(syncDeps()) },
  { name: "compliance", ms: 15 * 60_000, last: 0, run: () => runComplianceCheckJob(getOdooClient()) },
  { name: "daily-summary", ms: 60 * 60_000, last: 0, run: () => runDailySummaryJob(getOdooClient()) },
];
async function main() {
  for (;;) {
    for (const t of every) if (Date.now() - t.last >= t.ms) { t.last = Date.now(); try { const r = await t.run(); if (t.ms >= 60_000) console.log(t.name, r); } catch (e) { console.error(`${t.name} failed:`, e instanceof Error ? e.message : e); } }
    await new Promise(r => setTimeout(r, 1000));
  }
}
main();
