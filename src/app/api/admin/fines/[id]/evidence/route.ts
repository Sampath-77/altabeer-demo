import { adminContext } from "@/lib/admin-ctx";
import { errorResponse, secret } from "@/lib/auth/guard";
import { AuthError } from "@/lib/auth/service";
import { verifyToken } from "@/lib/auth/token";
import { prisma } from "@/lib/auth/prisma-repo";
import { localStorage_ } from "@/lib/storage";
import { sniff } from "@/lib/expenses";

const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    // 1. Authenticate via admin session cookie OR ?token= query parameter
    const url = new URL(req.url);
    const qToken = url.searchParams.get("token");
    let authenticated = false;

    try {
      adminContext(req);
      authenticated = true;
    } catch (authErr) {
      if (qToken) {
        const claims = verifyToken(qToken, secret());
        if (claims && claims.role === "ADMIN") {
          authenticated = true;
        }
      }
      if (!authenticated) throw authErr;
    }

    // 2. Fetch fine record
    const f = await prisma.fine.findUnique({
      where: { id: params.id },
      select: { id: true, evidenceKeys: true },
    });
    if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");

    const key = f.evidenceKeys[0];
    if (!key) throw new AuthError("NOT_FOUND", 404, "No original challan document recorded for this fine.");

    // 3. Fetch document metadata if stored in ChallanDocument
    const doc = await prisma.challanDocument.findUnique({
      where: { storageKey: key },
    }).catch(() => null);

    const ext = key.split(".").pop()?.toLowerCase() || "png";
    const mime = doc?.mimeType || TYPES[ext] || "application/octet-stream";
    const filename = doc?.originalFilename || `challan-${params.id}.${ext}`;
    const isDownload = url.searchParams.has("download") || url.searchParams.get("download") === "1";
    const dispositionType = isDownload ? "attachment" : "inline";

    // 4. Retrieve original binary bytes from persistent storage
    const storage = localStorage_();
    let data: Buffer;
    try {
      data = await storage.get(key);
    } catch (storageErr) {
      console.error(`Storage retrieval failed for fine ${params.id}, key ${key}:`, storageErr);
      throw new AuthError("NOT_FOUND", 404, "Original document is unavailable. Please upload the original challan again.");
    }

    // 5. Support HTTP Range requests (crucial for multi-page PDFs)
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

    // 6. Return full binary response with security headers
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(data.length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": `${dispositionType}; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    if (!(e instanceof AuthError)) {
      console.error("Evidence route unexpected error for fine", params.id, ":", e);
    }
    return errorResponse(e);
  }
}

/** Allows administrators to re-upload or replace the original challan document for an existing fine. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const a = adminContext(req);
    const fine = await prisma.fine.findUnique({ where: { id: params.id }, select: { id: true } });
    if (!fine) throw new AuthError("NOT_FOUND", 404, "Fine not found.");

    const form = await req.formData().catch(() => {
      throw new AuthError("BAD_REQUEST", 400, "Send the notice as a form upload.");
    });
    const f = form.get("file");
    if (!(f instanceof File)) throw new AuthError("VALIDATION", 422, "Attach an image or PDF of the fine notice.");

    const data = Buffer.from(await f.arrayBuffer());
    if (data.length === 0 || data.length > 15 * 1024 * 1024) {
      throw new AuthError("VALIDATION", 422, "The file must be between 1 byte and 15 MB.");
    }
    const kind = sniff(data);
    if (!kind) throw new AuthError("VALIDATION", 422, "Unsupported file. Use a JPEG, PNG, WebP or PDF.");

    const storage = localStorage_();
    const key = await storage.put(data, kind.ext, {
      filename: f.name || `challan-${params.id}.${kind.ext}`,
      mime: kind.mime,
      uploadedBy: a.adminId,
      fineId: params.id,
    });

    await prisma.fine.update({
      where: { id: params.id },
      data: { evidenceKeys: [key] },
    });

    return Response.json({ ok: true, key, filename: f.name });
  } catch (e) {
    return errorResponse(e);
  }
}
