export interface OcrResult { text: string; confidence?: number; provider: string }
export interface OcrProvider { name: string; recognize(data: Buffer, mime: string): Promise<OcrResult> }
export class OcrError extends Error {}

/**
 * Google Cloud Vision (DOCUMENT_TEXT_DETECTION). NOT TESTED against the live service.
 * Confidence is the mean page confidence reported by Vision; if absent it is left undefined, never invented.
 */
export function googleVision(apiKey: string, f: typeof fetch = fetch): OcrProvider {
  type Page = { confidence?: number };
  const mean = (p: Page[] = []) => { const c = p.map(x => x.confidence).filter((x): x is number => typeof x === "number"); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : undefined; };
  return {
    name: "google-vision",
    async recognize(data, mime) {
      const content = data.toString("base64"); const pdf = mime === "application/pdf";
      const url = `https://vision.googleapis.com/v1/${pdf ? "files" : "images"}:annotate?key=${encodeURIComponent(apiKey)}`;
      const feature = [{ type: "DOCUMENT_TEXT_DETECTION" }];
      const body = pdf ? { requests: [{ inputConfig: { content, mimeType: mime }, features: feature, pages: [1, 2, 3, 4, 5] }] } : { requests: [{ image: { content }, features: feature }] };
      let res: Response;
      try { res = await f(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }); }
      catch { throw new OcrError("OCR provider unreachable"); }
      if (!res.ok) throw new OcrError(`OCR provider returned ${res.status}`);
      const j = await res.json() as { responses?: { error?: { message: string }; fullTextAnnotation?: { text: string; pages?: Page[] }; responses?: { fullTextAnnotation?: { text: string; pages?: Page[] } }[] }[] };
      const r0 = j.responses?.[0];
      if (r0?.error) throw new OcrError(`OCR provider error: ${r0.error.message}`);
      const anns = pdf ? (r0?.responses ?? []).map(x => x.fullTextAnnotation).filter(Boolean) : [r0?.fullTextAnnotation].filter(Boolean);
      const text = anns.map(a => a!.text).join("\n");
      if (!text.trim()) throw new OcrError("No text found in the document");
      return { text, confidence: mean(anns.flatMap(a => a!.pages ?? [])), provider: "google-vision" };
    },
  };
}

/**
 * OCR.Space Cloud API (Free tier: 25,000 requests/month, no credit card required).
 */
export function ocrSpace(apiKey: string, f: typeof fetch = fetch): OcrProvider {
  return {
    name: "ocr-space",
    async recognize(data, mime) {
      const form = new FormData();
      const ext = mime === "application/pdf" ? "pdf" : mime.includes("png") ? "png" : "jpg";
      const blob = new Blob([data], { type: mime });
      form.append("file", blob, `notice.${ext}`);
      form.append("apikey", apiKey);
      form.append("language", "eng");
      form.append("isOverlayRequired", "false");
      form.append("OCREngine", "2"); // Engine 2 is optimized for numbers, plates, receipts, and table layouts
      form.append("scale", "true");

      let res: Response;
      try {
        res = await f("https://api.ocr.space/parse/image", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        throw new OcrError("OCR provider unreachable");
      }

      if (!res.ok) throw new OcrError(`OCR provider returned ${res.status}`);
      const json = await res.json() as {
        ParsedResults?: { ParsedText?: string; ErrorMessage?: string }[];
        IsErroredOnProcessing?: boolean;
        ErrorMessage?: string[];
      };

      if (json.IsErroredOnProcessing) {
        const msg = json.ErrorMessage?.join("; ") || json.ParsedResults?.[0]?.ErrorMessage || "OCR processing failed";
        throw new OcrError(`OCR provider error: ${msg}`);
      }

      const text = (json.ParsedResults ?? []).map(r => r.ParsedText ?? "").join("\n").trim();
      if (!text) throw new OcrError("No text found in the document");

      return { text, provider: "ocr-space" };
    },
  };
}

/** Development only: treats the uploaded bytes as the text itself. Refused in production. */
export const plainTextProvider: OcrProvider = { name: "dev-plaintext", async recognize(d) { return { text: d.toString("utf8"), provider: "dev-plaintext" }; } };

export function getOcrProvider(): OcrProvider {
  const p = process.env.OCR_PROVIDER;
  if (p === "ocr-space" && process.env.OCR_API_KEY) return ocrSpace(process.env.OCR_API_KEY);
  if (p === "google-vision" && process.env.OCR_API_KEY) return googleVision(process.env.OCR_API_KEY);
  if (p === "mock") { if (process.env.NODE_ENV === "production") throw new Error("OCR_PROVIDER=mock is not allowed in production."); return plainTextProvider; }
  throw new OcrError("OCR is not configured (OCR_PROVIDER / OCR_API_KEY).");
}
