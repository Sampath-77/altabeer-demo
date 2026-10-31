import { adminContext } from "@/lib/admin-ctx";
import { errorResponse } from "@/lib/auth/guard";
import { prisma } from "@/lib/auth/prisma-repo";
import { toRec } from "@/lib/fines/repo-prisma";
import { computeFineStats } from "@/lib/fines/workflow";
export async function GET(req: Request) {
  try { adminContext(req); const rows = (await prisma.fine.findMany({ where: { workflow: { not: "CLOSED" } } })).map(toRec); return Response.json(computeFineStats(rows, Date.now())); } catch (e) { return errorResponse(e); }
}
