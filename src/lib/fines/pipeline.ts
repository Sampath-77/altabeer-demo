import type { OdooClient, OdooVehicle } from "../odoo/types";
import type { Storage } from "../storage";
import type { OcrProvider } from "./ocr";
import { extractFine, type Extracted } from "./extract";
import { parsePlate, plateKey, matchPlate } from "./plate";
import { AuthError } from "../auth/service";

export type Reason = "MISSING_PLATE" | "MISSING_REFERENCE" | "INVALID_AMOUNT" | "UNCERTAIN_DATE" | "VEHICLE_NOT_FOUND" | "AMBIGUOUS_PLATE" | "PLATE_INCOMPLETE" | "NO_ASSIGNMENT" | "OVERLAPPING_ASSIGNMENT" | "POSSIBLE_DUPLICATE" | "DUPLICATE_REFERENCE" | "DEADLINE_UNVERIFIED" | "LOW_OCR_CONFIDENCE" | "OCR_FAILED" | "AMOUNT_AMBIGUOUS" | "DRIVER_REPORTED";
export const REASON_LABELS: Record<Reason, string> = {
  MISSING_PLATE: "No registration number was found.", MISSING_REFERENCE: "No fine reference number was found.", INVALID_AMOUNT: "The fine amount is missing or invalid.", UNCERTAIN_DATE: "The violation date is missing, unreadable or implausible.",
  VEHICLE_NOT_FOUND: "No vehicle in the ERP matches this plate.", AMBIGUOUS_PLATE: "More than one vehicle could match this plate.", PLATE_INCOMPLETE: "The plate has no code, so it can't be matched with confidence.",
  NO_ASSIGNMENT: "No driver was assigned to this vehicle on the violation date.", OVERLAPPING_ASSIGNMENT: "More than one driver was assigned on the violation date.",
  POSSIBLE_DUPLICATE: "A similar fine already exists (same plate, date and amount).", DUPLICATE_REFERENCE: "A fine with the same reference and authority already exists.",
  DEADLINE_UNVERIFIED: "No payment deadline was found on the notice. Do not assume one.", LOW_OCR_CONFIDENCE: "The OCR engine reported low confidence.", OCR_FAILED: "Text could not be read from this file.", AMOUNT_AMBIGUOUS: "Several different amounts appear; pick the right one.", DRIVER_REPORTED: "Reported by the driver; no notice was uploaded. Verify against an official notice.",
};
export const MIN_OCR_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE ?? 0.85); // a tunable guess, not a calibrated value

export interface FineRec {
  id: string; fineReference: string | null; issuingAuthority: string | null; violationAt: Date | null; noticeReceivedAt: Date | null;
  plateRaw: string | null; plateNormalized: string | null; plateEmirate: string | null; plateCode: string | null;
  vehicleOdooId: number | null; driverOdooId: number | null; vendorOdooId: number | null; assignmentEvidence: unknown;
  amount: number | null; additionalPenalty: number | null; deadline: Date | null; deadlineSource: string | null;
  matchStatus: "UNMATCHED" | "MATCHED" | "AMBIGUOUS" | "NO_ASSIGNMENT" | "OVERLAPPING_ASSIGNMENT"; workflow: string; reviewReasons: string[]; evidenceKeys: string[];
  description: string | null; vehicleMakeModel: string | null; duplicateOfId: string | null; manualOverride: boolean; rejectedReason: string | null;
  amountPaid?: number; acknowledgedAt?: Date | null; disputeReason?: string | null; paymentEvidenceKeys?: string[]; paymentClaimedAmount?: number | null; paymentReference?: string | null;
  paymentVerifiedAt?: Date | null; closedAt?: Date | null; closedReason?: string | null; escalationLevel?: number; lastEscalatedAt?: Date | null; odooRecordId?: number | null; lastSyncedAt?: Date | null;
}
export interface JobRec { id: string; fineId: string | null; sourceKey: string; status: "QUEUED" | "PROCESSING" | "DONE" | "FAILED"; mime?: string }
export interface FineRepo {
  createFine(d: { noticeReceivedAt: Date; evidenceKeys: string[] }): Promise<FineRec>;
  createJob(d: { fineId: string; sourceKey: string }): Promise<JobRec>;
  getFine(id: string): Promise<FineRec | null>;
  updateFine(id: string, patch: Partial<FineRec>): Promise<void>;
  getJob(id: string): Promise<JobRec | null>;
  updateJob(id: string, patch: Record<string, unknown>): Promise<void>;
  queuedJobs(limit: number): Promise<JobRec[]>;
  duplicates(f: { id: string; reference: string | null; authority: string | null; plateNormalized: string | null; violationAt: Date | null; amount: number | null }): Promise<{ strong: string[]; weak: string[] }>;
  audit(e: { actorId: string | null; action: string; entityId: string; before?: unknown; after?: unknown }): Promise<void>;
  outbox(e: { idempotencyKey: string; operation: string; payload: unknown }): Promise<void>;
}
export interface Deps { odoo: OdooClient; ocr: () => OcrProvider; storage: Storage; repo: FineRepo; now?: () => number }
const DAY = 86400_000;

export interface Assessment { patch: Partial<FineRec>; reasons: Reason[]; candidates: OdooVehicle[] }

/** Resolves vehicle, vendor and the driver assigned AT THE VIOLATION TIME (not the current driver). Pure with respect to the DB. */
export async function assess(d: Pick<Deps, "odoo" | "repo" | "now">, f: Pick<FineRec, "id" | "fineReference" | "issuingAuthority" | "plateRaw" | "plateEmirate" | "plateCode" | "violationAt" | "amount" | "deadline" | "manualOverride" | "vehicleOdooId">, extra: { ocrConfidence?: number; ocrFailed?: boolean; extractWarnings?: string[] } = {}): Promise<Assessment> {
  const reasons = new Set<Reason>(); const now = d.now?.() ?? Date.now();
  if (extra.ocrFailed) reasons.add("OCR_FAILED");
  if (extra.ocrConfidence !== undefined && extra.ocrConfidence < MIN_OCR_CONFIDENCE) reasons.add("LOW_OCR_CONFIDENCE");
  if (extra.extractWarnings?.includes("AMOUNT_AMBIGUOUS")) reasons.add("AMOUNT_AMBIGUOUS");
  if (!f.fineReference) reasons.add("MISSING_REFERENCE");
  if (f.amount == null || !(f.amount > 0)) reasons.add("INVALID_AMOUNT");
  if (!f.violationAt || f.violationAt.getTime() > now + DAY || f.violationAt.getTime() < now - 3 * 365 * DAY) reasons.add("UNCERTAIN_DATE");
  if (!f.deadline) reasons.add("DEADLINE_UNVERIFIED");

  const patch: Partial<FineRec> = {}; let candidates: OdooVehicle[] = [];
  const parts = f.plateRaw ? parsePlate(f.plateRaw) : {}; if (f.plateEmirate) parts.emirate = f.plateEmirate; if (f.plateCode) parts.code = f.plateCode;
  patch.plateNormalized = f.plateRaw ? plateKey(parts) || null : null;
  let vehicle: OdooVehicle | undefined;
  if (f.manualOverride && f.vehicleOdooId) vehicle = (await d.odoo.getVehicles([f.vehicleOdooId]))[0];
  else if (!parts.number) { reasons.add("MISSING_PLATE"); patch.matchStatus = "UNMATCHED"; }
  else {
    const m = matchPlate(parts, await d.odoo.findVehiclesByPlate(parts.number)); candidates = m.vehicles;
    if (m.status === "MATCHED") vehicle = m.vehicles[0];
    else { patch.matchStatus = m.status === "AMBIGUOUS" ? "AMBIGUOUS" : "UNMATCHED"; reasons.add(m.status === "UNMATCHED" ? "VEHICLE_NOT_FOUND" : m.reason === "PLATE_INCOMPLETE" ? "PLATE_INCOMPLETE" : "AMBIGUOUS_PLATE"); }
  }
  if (!vehicle) { patch.vehicleOdooId = f.manualOverride ? f.vehicleOdooId : null; patch.driverOdooId = null; patch.vendorOdooId = null; patch.assignmentEvidence = null; }
  else {
    patch.vehicleOdooId = vehicle.id; patch.vendorOdooId = vehicle.vendorId ?? null; patch.matchStatus = "MATCHED";
    if (!f.violationAt) { patch.driverOdooId = null; patch.assignmentEvidence = { source: "odoo", note: "violation date missing; assignment not resolved" }; }
    else {
      const asg = await d.odoo.assignmentsAt(vehicle.id, f.violationAt);
      patch.assignmentEvidence = { source: "odoo", vehicleId: vehicle.id, at: f.violationAt.toISOString(), assignments: asg };
      if (asg.length === 1) patch.driverOdooId = asg[0].employeeId;
      else { patch.driverOdooId = null; patch.matchStatus = asg.length === 0 ? "NO_ASSIGNMENT" : "OVERLAPPING_ASSIGNMENT"; reasons.add(asg.length === 0 ? "NO_ASSIGNMENT" : "OVERLAPPING_ASSIGNMENT"); }
    }
  }
  const dup = await d.repo.duplicates({ id: f.id, reference: f.fineReference, authority: f.issuingAuthority, plateNormalized: patch.plateNormalized ?? null, violationAt: f.violationAt, amount: f.amount });
  if (dup.strong.length) { reasons.add("DUPLICATE_REFERENCE"); patch.duplicateOfId = dup.strong[0]; } else if (dup.weak.length) { reasons.add("POSSIBLE_DUPLICATE"); patch.duplicateOfId = dup.weak[0]; } else patch.duplicateOfId = null;
  return { patch, reasons: [...reasons], candidates };
}

export async function ingest(d: Deps, file: { data: Buffer; ext: string; mime: string }): Promise<{ fineId: string; jobId: string }> {
  const key = await d.storage.put(file.data, file.ext);
  const fine = await d.repo.createFine({ noticeReceivedAt: new Date(d.now?.() ?? Date.now()), evidenceKeys: [key] });
  const job = await d.repo.createJob({ fineId: fine.id, sourceKey: key });
  return { fineId: fine.id, jobId: job.id };
}

const MIME: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
export async function runOcrJob(d: Deps, jobId: string): Promise<void> {
  const job = await d.repo.getJob(jobId); if (!job || job.status !== "QUEUED" || !job.fineId) return;
  await d.repo.updateJob(jobId, { status: "PROCESSING" });
  const fine = (await d.repo.getFine(job.fineId))!;
  let text = "", confidence: number | undefined, provider: string | undefined, extracted: Extracted = { warnings: [] }, ocrFailed = false, err: string | undefined;
  try {
    const p = d.ocr(); provider = p.name;
    const data = await d.storage.get(job.sourceKey);
    const r = await p.recognize(data, MIME[job.sourceKey.split(".").pop()!] ?? "application/octet-stream");
    text = r.text; confidence = r.confidence; extracted = extractFine(text);
  } catch (e) { ocrFailed = true; err = e instanceof Error ? e.message : "OCR failed"; }

  const v = <T,>(x?: { value: T }) => x?.value ?? null;
  const base: Partial<FineRec> = {
    fineReference: v(extracted.fineReference), issuingAuthority: v(extracted.authority), plateRaw: v(extracted.plateRaw), plateEmirate: v(extracted.plateEmirate), plateCode: v(extracted.plateCode),
    amount: v(extracted.amount), additionalPenalty: v(extracted.additionalPenalty), violationAt: extracted.violationAt ? new Date(extracted.violationAt.value) : null,
    deadline: extracted.deadline ? new Date(extracted.deadline.value) : null, deadlineSource: extracted.deadline ? "notice" : null, description: v(extracted.description), vehicleMakeModel: v(extracted.vehicleMakeModel),
  };
  let odooDown = false; let a: Assessment = { patch: {}, reasons: [], candidates: [] };
  try { a = await assess(d, { ...fine, ...base } as FineRec, { ocrConfidence: confidence, ocrFailed, extractWarnings: extracted.warnings }); }
  catch { odooDown = true; }
  if (odooDown) { await d.repo.updateJob(jobId, { status: "QUEUED", errors: ["Odoo unreachable during matching; will retry"] }); return; } // leave queued for retry; nothing half-written
  await d.repo.updateFine(fine.id, { ...base, ...a.patch, reviewReasons: a.reasons, workflow: "REVIEW_REQUIRED" });
  await d.repo.updateJob(jobId, { status: ocrFailed ? "FAILED" : "DONE", rawText: text || null, fields: extracted, confidence: confidence ?? null, provider, errors: err ? [err] : [], finishedAt: new Date() });
}
/** Worker entry: picks up queued jobs (also recovers jobs left queued after an Odoo outage). */
export async function processQueued(d: Deps, limit = 10) { for (const j of await d.repo.queuedJobs(limit)) await runOcrJob(d, j.id); }

const EDITABLE = ["fineReference", "issuingAuthority", "plateRaw", "plateEmirate", "plateCode", "violationAt", "amount", "additionalPenalty", "deadline", "description", "vehicleMakeModel"] as const;
export interface Correction { [k: string]: unknown; vehicleOdooId?: number | null }
export async function correct(d: Deps, id: string, actor: string, input: Correction): Promise<Assessment> {
  const f = await d.repo.getFine(id); if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");
  if (!["REVIEW_REQUIRED", "NEW"].includes(f.workflow)) throw new AuthError("CONFLICT", 409, "This fine is no longer in review.");
  const patch: Partial<FineRec> = {};
  for (const k of EDITABLE) if (k in input) {
    const val = input[k];
    if (k === "violationAt" || k === "deadline") (patch as Record<string, unknown>)[k] = val ? new Date(String(val)) : null;
    else if (k === "amount" || k === "additionalPenalty") (patch as Record<string, unknown>)[k] = val === null || val === "" ? null : Number(val);
    else (patch as Record<string, unknown>)[k] = val === "" ? null : val;
  }
  if ("deadline" in patch) patch.deadlineSource = patch.deadline ? "admin" : null;
  for (const k of ["amount", "additionalPenalty"] as const) if (k in patch && patch[k] != null && !Number.isFinite(patch[k] as number)) throw new AuthError("VALIDATION", 422, "Amount must be a number.");
  for (const k of ["violationAt", "deadline"] as const) if (patch[k] && isNaN((patch[k] as Date).getTime())) throw new AuthError("VALIDATION", 422, "Invalid date.");
  if (input.vehicleOdooId !== undefined) { patch.vehicleOdooId = input.vehicleOdooId; patch.manualOverride = input.vehicleOdooId != null; }
  const merged = { ...f, ...patch };
  const a = await assess(d, merged, {}).catch(() => { throw new AuthError("ODOO_UNAVAILABLE", 502, "The Al Tabeer ERP is unreachable. Nothing was changed."); });
  const final = { ...patch, ...a.patch, reviewReasons: f.reviewReasons.includes("DRIVER_REPORTED") ? [...a.reasons, "DRIVER_REPORTED"] : a.reasons };
  await d.repo.updateFine(id, final);
  await d.repo.audit({ actorId: actor, action: "fine.corrected", entityId: id, before: pick(f, [...EDITABLE, "vehicleOdooId", "driverOdooId", "vendorOdooId", "matchStatus"]), after: pick({ ...f, ...final }, [...EDITABLE, "vehicleOdooId", "driverOdooId", "vendorOdooId", "matchStatus"]) });
  return a;
}
const pick = (o: object, ks: readonly string[]) => Object.fromEntries(ks.map(k => [k, (o as Record<string, unknown>)[k]]));

export async function approve(d: Pick<Deps, "repo">, id: string, actor: string, opts: { confirmNotDuplicate?: boolean } = {}) {
  const f = await d.repo.getFine(id); if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");
  if (f.workflow !== "REVIEW_REQUIRED") throw new AuthError("CONFLICT", 409, "This fine is not awaiting review.");
  const miss = [!f.fineReference && "fine reference", !f.plateRaw && "registration", !(f.amount && f.amount > 0) && "amount", !f.violationAt && "violation date", !f.vehicleOdooId && "matched vehicle"].filter(Boolean);
  if (miss.length) throw new AuthError("VALIDATION", 422, `Cannot approve: missing ${miss.join(", ")}.`);
  if (f.reviewReasons.some(r => r === "DUPLICATE_REFERENCE" || r === "POSSIBLE_DUPLICATE") && !opts.confirmNotDuplicate) throw new AuthError("DUPLICATE", 409, "This looks like a duplicate. Confirm it is not before approving.");
  await d.repo.updateFine(id, { workflow: "APPROVED" });
  await d.repo.outbox({ idempotencyKey: `fine:${id}:create`, operation: "fine.create", payload: { fineId: id } });
  await d.repo.audit({ actorId: actor, action: "fine.approved", entityId: id, before: { workflow: f.workflow }, after: { workflow: "APPROVED", reviewReasons: f.reviewReasons, confirmNotDuplicate: !!opts.confirmNotDuplicate } });
}
export async function reject(d: Pick<Deps, "repo">, id: string, actor: string, reason: string) {
  const f = await d.repo.getFine(id); if (!f) throw new AuthError("NOT_FOUND", 404, "Fine not found.");
  if (f.workflow !== "REVIEW_REQUIRED") throw new AuthError("CONFLICT", 409, "This fine is not awaiting review.");
  if (!reason.trim()) throw new AuthError("VALIDATION", 422, "Give a reason for rejecting.");
  await d.repo.updateFine(id, { workflow: "REJECTED", rejectedReason: reason.trim() });
  await d.repo.audit({ actorId: actor, action: "fine.rejected", entityId: id, before: { workflow: f.workflow }, after: { workflow: "REJECTED", reason: reason.trim() } });
}
