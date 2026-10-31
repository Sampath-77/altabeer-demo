import { timingSafeEqual } from "crypto";
import { runDeadlineJob } from "@/lib/fines/workflow";
import { wfDeps } from "@/lib/fines/wf-prisma";
/** Called by the worker or a scheduler with `Authorization: Bearer $JOB_SECRET`. Idempotent. */
export async function POST(req: Request) {
  const want = process.env.JOB_SECRET ?? ""; const got = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (want.length < 24 || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized." } }, { status: 401 });
  try { return Response.json(await runDeadlineJob(wfDeps())); } catch { return Response.json({ error: { code: "INTERNAL", message: "Job failed." } }, { status: 500 }); }
}
