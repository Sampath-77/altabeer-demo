import { describe, it, expect, beforeEach } from "vitest";
import { localStorage_ } from "@/lib/storage";
import { AuthError } from "@/lib/auth/service";

describe("Durable Persistent Storage Architecture", () => {
  const storage = localStorage_();
  const samplePdf = Buffer.from("%PDF-1.4 sample content for al-tabeer challan notice verification %EOF");
  const sampleJpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("JFIF fake image data")]);

  it("stores and retrieves PDF binary bytes with correct metadata", async () => {
    const key = await storage.put(samplePdf, "pdf", {
      filename: "official-challan.pdf",
      mime: "application/pdf",
      uploadedBy: "admin-123",
      fineId: "fine-abc",
    });

    expect(key).toMatch(/^[a-f0-9-]+\.pdf$/);

    const retrieved = await storage.get(key);
    expect(retrieved).toBeInstanceOf(Buffer);
    expect(retrieved.toString()).toBe(samplePdf.toString());
    expect(retrieved.length).toBe(samplePdf.length);

    if (storage.info) {
      const info = await storage.info(key);
      expect(info).not.toBeNull();
      expect(info?.filename).toBe("official-challan.pdf");
      expect(info?.mime).toBe("application/pdf");
      expect(info?.status).toBe("AVAILABLE");
    }
  });

  it("stores and retrieves JPEG images preserving binary fidelity", async () => {
    const key = await storage.put(sampleJpeg, "jpg", {
      filename: "traffic_violation.jpg",
      mime: "image/jpeg",
    });

    const retrieved = await storage.get(key);
    expect(retrieved).toEqual(sampleJpeg);

    if (storage.info) {
      const info = await storage.info(key);
      expect(info?.mime).toBe("image/jpeg");
    }
  });

  it("throws a clear 404 AuthError when file is genuinely missing", async () => {
    const missingKey = "non-existent-file-12345.png";
    await expect(storage.get(missingKey)).rejects.toThrow(AuthError);
    try {
      await storage.get(missingKey);
    } catch (e: any) {
      expect(e.status).toBe(404);
      expect(e.code).toBe("NOT_FOUND");
      expect(e.message).toContain("Original document is unavailable. Please upload the original challan again.");
    }
  });

  it("rejects invalid storage keys with path traversal attempts", async () => {
    await expect(storage.get("../../../etc/passwd")).rejects.toThrow();
    await expect(storage.get("invalid/key/structure")).rejects.toThrow();
  });
});

