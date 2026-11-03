import { describe, it, expect } from "vitest";
import { extractFine, parseDubaiDate } from "@/lib/fines/extract";
import { parsePlate, matchPlate } from "@/lib/fines/plate";
import { ingest, runOcrJob, processQueued, correct, approve, reject, type FineRepo, type FineRec, type JobRec, type Deps } from "@/lib/fines/pipeline";
import { googleVision, OcrError, type OcrProvider } from "@/lib/fines/ocr";
import { MockOdoo } from "@/lib/odoo/mock";
import type { AuthError } from "@/lib/auth/service";

const NOW = Date.UTC(2026, 9, 28, 8, 0, 0);
const code = (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);
// SYNTHETIC notice for testing the parser. Not a real RTA/Dubai Police format.
const NOTICE = `Dubai Police
Fine Number: DP-2026-884412
Plate Number: Dubai A 4827
Violation: Exceeding the speed limit
Violation Date & Time: 12/10/2026 14:35
Fine Amount: AED 600
Due Date: 12/12/2026`;

describe("parsing", () => {
  it("parses plates", () => {
    expect(parsePlate("Dubai A 4827")).toEqual({ emirate: "DUBAI", code: "A", number: "4827" });
    expect(parsePlate("A-4827")).toEqual({ emirate: undefined, code: "A", number: "4827" });
    expect(parsePlate("A4827")).toMatchObject({ code: "A", number: "4827" });
    expect(parsePlate("4827")).toMatchObject({ code: undefined, number: "4827" });
    expect(parsePlate("Abu Dhabi 12 34567")).toEqual({ emirate: "ABU DHABI", code: "12", number: "34567" });
  });
  it("parses Dubai local date to UTC and rejects impossible dates", () => {
    expect(parseDubaiDate("12/10/2026 14:35")).toEqual({ iso: "2026-10-12T10:35:00.000Z", hasTime: true });
    expect(parseDubaiDate("31/02/2026")).toBeNull(); expect(parseDubaiDate("garbage")).toBeNull();
  });
  it("extracts labelled fields with evidence snippets", () => {
    const x = extractFine(NOTICE);
    expect(x.fineReference?.value).toBe("DP-2026-884412"); expect(x.plateRaw?.value).toBe("Dubai A 4827"); expect(x.plateCode?.value).toBe("A"); expect(x.plateEmirate?.value).toBe("DUBAI");
    expect(x.amount?.value).toBe(600); expect(x.violationAt?.value).toBe("2026-10-12T10:35:00.000Z"); expect(x.deadline?.value).toBe("2026-12-12T19:59:00.000Z"); // end of 12 Dec, Dubai time
    expect(x.authority?.value).toBe("Dubai Police"); expect(x.amount?.snippet).toContain("600");
    expect(x.vehicleMakeModel).toBeUndefined(); // absent from the notice => not invented
  });
  it("returns nothing rather than guessing on junk, and flags ambiguous amounts", () => {
    const j = extractFine("hello world"); expect(j.fineReference).toBeUndefined(); expect(j.amount).toBeUndefined();
    expect(extractFine("AED 100\nAED 250").warnings).toContain("AMOUNT_AMBIGUOUS");
    expect(extractFine("Fine Amount: AED 1,250.50").amount?.value).toBe(1250.5);
  });
  it("extracts Abu Dhabi DoT / Toll challan format with textual date and multi-line fields", () => {
    const notice = `LEXUS GS 430, 2005,
White
DUBRI
38916
Date and Time of Issuing
25 Sep 2026, 5:03 pm
The Fine:
Location:
Source:
Department of Transportation Abu
Dhabi
AED 75
Amount:
Payable Black Points:
Online declaration:
Fine Number:
NO
8403883348
Details:
مخالفة بوابات التعرفة المرورية - مركبة غير مسجية
Registration Fine
Dispute:
Please contact Department of Transportation Abu Dhabi
for details about disputing your fine.`;
    const x = extractFine(notice);
    expect(x.fineReference?.value).toBe("8403883348");
    expect(x.plateRaw?.value).toBe("DUBRI 38916");
    expect(x.plateEmirate?.value).toBe("DUBAI");
    expect(x.vehicleMakeModel?.value).toBe("LEXUS GS 430, 2005");
    expect(x.vehicleColour?.value).toBe("White");
    expect(x.amount?.value).toBe(75);
    expect(x.currency?.value).toBe("AED");
    expect(x.issuingAuthority?.value).toBe("Department of Transportation Abu Dhabi");
    expect(x.violationAt?.value).toBe("2026-09-25T13:03:00.000Z");
    expect(x.violationCategory?.value).toBe("Toll / Darb Violation");
  });
});

const veh = (id: number, plate: string, vendorId?: number) => ({ id, plate, vendorId, active: true });
describe("plate matching", () => {
  const vs = [veh(1, "Dubai A 4827"), veh(2, "Sharjah A 4827"), veh(3, "B 4827"), veh(4, "Dubai C 1111")];
  it("matches only on number + code (+ emirate when known)", () => {
    expect(matchPlate({ emirate: "DUBAI", code: "A", number: "4827" }, vs)).toMatchObject({ status: "MATCHED", vehicles: [{ id: 1 }] });
    expect(matchPlate({ code: "A", number: "4827" }, vs).status).toBe("AMBIGUOUS");           // Dubai A vs Sharjah A
    expect(matchPlate({ number: "4827" }, vs)).toMatchObject({ status: "AMBIGUOUS", reason: "PLATE_INCOMPLETE" }); // never auto-match number-only
    expect(matchPlate({ emirate: "DUBAI", code: "A", number: "482" }, vs).status).toBe("UNMATCHED"); // no partial match
    expect(matchPlate({ code: "Z", number: "4827" }, vs).status).toBe("AMBIGUOUS");           // code wrong: candidates offered, not matched
  });
});

function mem() {
  const fines = new Map<string, FineRec>(); const jobs = new Map<string, JobRec & Record<string, unknown>>(); const audits: { action: string }[] = []; const outbox: string[] = []; let n = 0;
  const repo: FineRepo = {
    createFine: async d => { const f: FineRec = { id: `f${++n}`, fineReference: null, issuingAuthority: null, violationAt: null, noticeReceivedAt: d.noticeReceivedAt, plateRaw: null, plateNormalized: null, plateEmirate: null, plateCode: null, vehicleOdooId: null, driverOdooId: null, vendorOdooId: null, assignmentEvidence: null, amount: null, additionalPenalty: null, deadline: null, deadlineSource: null, matchStatus: "UNMATCHED", workflow: "REVIEW_REQUIRED", reviewReasons: [], evidenceKeys: d.evidenceKeys, description: null, vehicleMakeModel: null, duplicateOfId: null, manualOverride: false, rejectedReason: null }; fines.set(f.id, f); return f; },
    createJob: async d => { const j = { id: `j${++n}`, status: "QUEUED" as const, ...d }; jobs.set(j.id, j); return j; },
    getFine: async id => (fines.has(id) ? { ...fines.get(id)! } : null),
    updateFine: async (id, p) => { Object.assign(fines.get(id)!, p); },
    getJob: async id => jobs.get(id) ?? null, updateJob: async (id, p) => { Object.assign(jobs.get(id)!, p); },
    queuedJobs: async () => [...jobs.values()].filter(j => j.status === "QUEUED"),
    duplicates: async f => { const o = [...fines.values()].filter(x => x.id !== f.id && x.workflow !== "REJECTED");
      return { strong: f.reference ? o.filter(x => x.fineReference === f.reference && x.issuingAuthority === f.authority).map(x => x.id) : [], weak: o.filter(x => f.plateNormalized && x.plateNormalized === f.plateNormalized && x.violationAt?.getTime() === f.violationAt?.getTime() && x.amount === f.amount).map(x => x.id) }; },
    audit: async e => { audits.push(e); }, outbox: async e => { outbox.push(e.idempotencyKey); },
  };
  return { fines, jobs, audits, outbox, repo };
}
function env(text = NOTICE, conf?: number) {
  const m = mem(); const odoo = new MockOdoo();
  odoo.vehicles.push({ id: 1, plate: "Dubai A 4827", vendorId: 100, active: true });
  odoo.assignmentHistory.push({ vehicleId: 1, employeeId: 11, from: "2026-01-01", to: "2026-10-01" }, { vehicleId: 1, employeeId: 22, from: "2026-10-02", to: null }); // current driver (22) != driver on 12 Oct? both: 12 Oct => 22
  const ocr: OcrProvider = { name: "test", recognize: async () => ({ text, confidence: conf, provider: "test" }) };
  const storage = { put: async () => "k1.jpg", get: async () => Buffer.from("x") };
  const deps: Deps = { odoo, ocr: () => ocr, storage, repo: m.repo, now: () => NOW };
  return { ...m, odoo, deps };
}
const run = async (e: ReturnType<typeof env>) => { const r = await ingest(e.deps, { data: Buffer.from("x"), ext: "jpg", mime: "image/jpeg" }); await runOcrJob(e.deps, r.jobId); return { ...r, fine: e.fines.get(r.fineId)! }; };

describe("pipeline", () => {
  it("matches vehicle, vendor and the driver assigned at the violation time", async () => {
    const e = env(); const { fine, jobId } = await run(e);
    expect(fine).toMatchObject({ fineReference: "DP-2026-884412", amount: 600, vehicleOdooId: 1, vendorOdooId: 100, driverOdooId: 22, matchStatus: "MATCHED", workflow: "REVIEW_REQUIRED" });
    expect(e.jobs.get(jobId)!.status).toBe("DONE"); expect(fine.reviewReasons).toEqual([]);
  });
  it("resolves the Dubai calendar day for early-morning violations (before 04:00 Dubai = previous UTC day)", async () => {
    const e = env(NOTICE.replace("12/10/2026 14:35", "02/10/2026 01:30")); expect((await run(e)).fine.driverOdooId).toBe(22); // 2 Oct Dubai => new assignment starts 2 Oct
  });
  it("uses the assignment in force on the violation date, not the current one", async () => {
    const e = env(NOTICE.replace("12/10/2026", "20/09/2026")); expect((await run(e)).fine.driverOdooId).toBe(11);
  });
  it("flags missing assignment, overlapping assignments and unverified deadline", async () => {
    const a = env(NOTICE.replace("12/10/2026", "20/09/2025").replace("Due Date: 12/12/2026", "")); a.odoo.assignmentHistory.length = 0;
    const f = (await run(a)).fine; expect(f.matchStatus).toBe("NO_ASSIGNMENT"); expect(f.reviewReasons).toEqual(expect.arrayContaining(["NO_ASSIGNMENT", "DEADLINE_UNVERIFIED"])); expect(f.driverOdooId).toBeNull();
    const b = env(); b.odoo.assignmentHistory.push({ vehicleId: 1, employeeId: 33, from: "2026-10-05", to: null });
    const g = (await run(b)).fine; expect(g.matchStatus).toBe("OVERLAPPING_ASSIGNMENT"); expect(g.driverOdooId).toBeNull();
  });
  it("sends unknown plates and incomplete plates to review without matching", async () => {
    expect((await run(env(NOTICE.replace("A 4827", "A 9999")))).fine.reviewReasons).toContain("VEHICLE_NOT_FOUND");
    const f = (await run(env(NOTICE.replace("Dubai A 4827", "4827")))).fine; expect(f.reviewReasons).toContain("PLATE_INCOMPLETE"); expect(f.vehicleOdooId).toBeNull();
  });
  it("flags low confidence only when the provider reports one", async () => {
    expect((await run(env(NOTICE, 0.5))).fine.reviewReasons).toContain("LOW_OCR_CONFIDENCE");
    expect((await run(env(NOTICE, undefined))).fine.reviewReasons).not.toContain("LOW_OCR_CONFIDENCE");
  });
  it("detects duplicates by reference and by plate+date+amount, never discarding them", async () => {
    const e = env(); await run(e); const second = await run(e);
    expect(second.fine.reviewReasons).toContain("DUPLICATE_REFERENCE"); expect(second.fine.duplicateOfId).toBe("f1");
    const e2 = env(); await run(e2); const w = await run({ ...e2, deps: { ...e2.deps, ocr: () => ({ name: "t", recognize: async () => ({ text: NOTICE.replace("DP-2026-884412", "OTHER-1234567"), provider: "t" }) }) } } as typeof e2);
    expect(w.fine.reviewReasons).toContain("POSSIBLE_DUPLICATE"); expect(e2.fines.size).toBe(2);
  });
  it("OCR provider failure ends in FAILED with reasons, ready for manual entry", async () => {
    const e = env(); e.deps.ocr = () => ({ name: "t", recognize: async () => { throw new OcrError("boom"); } });
    const { fine, jobId } = await run(e); expect(e.jobs.get(jobId)!.status).toBe("FAILED"); expect(fine.reviewReasons).toContain("OCR_FAILED"); expect(fine.workflow).toBe("REVIEW_REQUIRED");
  });
  it("Odoo outage during matching leaves the job queued; worker completes it later", async () => {
    const e = env(); const r = await ingest(e.deps, { data: Buffer.from("x"), ext: "jpg", mime: "image/jpeg" });
    e.odoo.failNext = true; await runOcrJob(e.deps, r.jobId);
    expect(e.jobs.get(r.jobId)!.status).toBe("QUEUED"); expect(e.fines.get(r.fineId)!.vehicleOdooId).toBeNull();
    await processQueued(e.deps); expect(e.jobs.get(r.jobId)!.status).toBe("DONE"); expect(e.fines.get(r.fineId)!.vehicleOdooId).toBe(1);
  });
});

describe("admin review", () => {
  it("correction re-runs matching and writes an audit entry with before/after", async () => {
    const e = env(NOTICE.replace("A 4827", "A 9999")); const { fine } = await run(e);
    await correct(e.deps, fine.id, "adm", { plateRaw: "Dubai A 4827" });
    expect(e.fines.get(fine.id)).toMatchObject({ vehicleOdooId: 1, matchStatus: "MATCHED" }); expect(e.audits.at(-1)!.action).toBe("fine.corrected");
  });
  it("manual vehicle override is recorded and the historical driver is still resolved", async () => {
    const e = env(NOTICE.replace("A 4827", "A 9999")); const { fine } = await run(e);
    await correct(e.deps, fine.id, "adm", { vehicleOdooId: 1 });
    expect(e.fines.get(fine.id)).toMatchObject({ manualOverride: true, vehicleOdooId: 1, driverOdooId: 22 });
  });
  it("rejects bad corrections", async () => {
    const e = env(); const { fine } = await run(e);
    expect(await code(correct(e.deps, fine.id, "a", { amount: "abc" }))).toBe("VALIDATION");
    expect(await code(correct(e.deps, fine.id, "a", { violationAt: "nope" }))).toBe("VALIDATION");
    expect(await code(correct(e.deps, "missing", "a", {}))).toBe("NOT_FOUND");
  });
  it("approval needs required fields and a vehicle; queues one idempotent Odoo write", async () => {
    const e = env(NOTICE.replace("A 4827", "A 9999")); const { fine } = await run(e);
    expect(await code(approve(e.deps, fine.id, "adm"))).toBe("VALIDATION");
    await correct(e.deps, fine.id, "adm", { plateRaw: "Dubai A 4827" });
    await approve(e.deps, fine.id, "adm"); expect(e.fines.get(fine.id)!.workflow).toBe("APPROVED"); expect(e.outbox).toEqual([`fine:${fine.id}:create`]);
    expect(await code(approve(e.deps, fine.id, "adm"))).toBe("CONFLICT");
  });
  it("blocks approving a duplicate until explicitly confirmed", async () => {
    const e = env(); await run(e); const d = await run(e);
    expect(await code(approve(e.deps, d.fine.id, "adm"))).toBe("DUPLICATE");
    await approve(e.deps, d.fine.id, "adm", { confirmNotDuplicate: true }); expect(e.fines.get(d.fine.id)!.workflow).toBe("APPROVED");
  });
  it("reject needs a reason and is audited", async () => {
    const e = env(); const { fine } = await run(e);
    expect(await code(reject(e.deps, fine.id, "adm", " "))).toBe("VALIDATION");
    await reject(e.deps, fine.id, "adm", "not a traffic fine"); expect(e.fines.get(fine.id)).toMatchObject({ workflow: "REJECTED", rejectedReason: "not a traffic fine" }); expect(e.audits.at(-1)!.action).toBe("fine.rejected");
  });
});

describe("Google Vision adapter (mocked fetch, not the live service)", () => {
  it("builds the request, reads text and mean confidence, and surfaces failures", async () => {
    let url = "";
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: "hi", pages: [{ confidence: 0.9 }, { confidence: 0.7 }] } }] })); }) as unknown as typeof fetch;
    const r = await googleVision("K", f).recognize(Buffer.from("x"), "image/png");
    expect(url).toContain("images:annotate"); expect(r.text).toBe("hi"); expect(r.confidence).toBeCloseTo(0.8);
    const none = (async () => new Response(JSON.stringify({ responses: [{ fullTextAnnotation: { text: "no confidence" } }] }))) as unknown as typeof fetch;
    expect((await googleVision("K", none).recognize(Buffer.from("x"), "image/png")).confidence).toBeUndefined();
    await expect(googleVision("K", (async () => new Response("", { status: 403 })) as unknown as typeof fetch).recognize(Buffer.from("x"), "image/png")).rejects.toThrow(/403/);
    await expect(googleVision("K", (async () => new Response(JSON.stringify({ responses: [{}] }))) as unknown as typeof fetch).recognize(Buffer.from("x"), "application/pdf")).rejects.toThrow(/No text/);
  });
});
