import { driverContext } from "@/lib/driver";
import { errorResponse } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { wfDeps } from "@/lib/fines/wf-prisma";
import { ownFine } from "@/lib/fines/workflow";
import { prisma } from "@/lib/auth/prisma-repo";

const T: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const d = await driverContext(req);
    const deps = wfDeps();
    const f = await ownFine(deps, params.id, d.employeeId);
    const k = f.evidenceKeys[0];
    if (!k) throw new AuthError("NOT_FOUND", 404, "No notice on file.");

    const url = new URL(req.url);
    const isDownload = url.searchParams.has("download") || url.searchParams.get("download") === "1";
    const dispositionType = isDownload ? "attachment" : "inline";

    const doc = await prisma.challanDocument.findUnique({
      where: { storageKey: k },
    }).catch(() => null);

    const ext = k.split(".").pop()?.toLowerCase() || "png";
    const mime = doc?.mimeType || T[ext] || "application/octet-stream";
    const filename = doc?.originalFilename || `notice-${params.id}.${ext}`;

    const data = await deps.storage.get(k);

    const range = req.headers.get("range");
    if (range && range.startsWith("bytes=")) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : data.length - 1;

      if (!isNaN(start) && !isNaN(end) && start <= end && end < data.length) {
        const chunk = data.subarray(start, end + 1);
        return new Response(new Uint8Array(chunk), {
          status: 206,
          headers: {
            "Content-Type": mime,
            "Content-Range": `bytes ${start}-${end}/${data.length}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunk.length),
            "Content-Disposition": `${dispositionType}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${dispositionType}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
