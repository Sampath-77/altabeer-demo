import nodemailer from "nodemailer";
import type { FineRec } from "./pipeline";

export interface OutMessage { to: string; subject: string; body: string }
/** SUBMITTED = handed to the provider. It is never reported as DELIVERED because SMTP/most APIs cannot confirm delivery. */
export interface SendResult { status: "SUBMITTED" | "FAILED"; providerRef?: string; response?: unknown }
export interface EmailProvider { name: string; send(m: OutMessage): Promise<SendResult> }

export function smtpProvider(url: string, from: string): EmailProvider {
  const t = nodemailer.createTransport(url);
  return { name: "smtp", async send(m) {
    try { const r = await t.sendMail({ from, to: m.to, subject: m.subject, text: m.body }); return { status: "SUBMITTED", providerRef: r.messageId, response: { accepted: r.accepted, rejected: r.rejected, response: r.response } }; }
    catch (e) { return { status: "FAILED", response: { error: e instanceof Error ? e.message : "send failed" } }; }
  } };
}
export const sentMock: OutMessage[] = [];
export const mockProvider: EmailProvider = { name: "mock", async send(m) { sentMock.push(m); return { status: "SUBMITTED", providerRef: `mock-${sentMock.length}` }; } };
export class NotConfigured extends Error {}
export function getEmailProvider(): EmailProvider {
  if (process.env.SMTP_URL) return smtpProvider(process.env.SMTP_URL, process.env.EMAIL_FROM ?? "Al Tabeer Operations <no-reply@altabeer.net>");
  if (process.env.NOTIFY_MODE === "mock" && process.env.NODE_ENV !== "production") return mockProvider;
  throw new NotConfigured("Email is not configured (SMTP_URL).");
}

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" }).format(d) + " (Dubai time)" : "not stated");
/** Factual notice only: no claims about legal liability or amounts recoverable. */
export function composeVendorEmail(f: FineRec, v: { plate: string; vendorName: string }): { subject: string; body: string } {
  const total = (f.amount ?? 0) + (f.additionalPenalty ?? 0);
  return {
    subject: `Traffic fine notice: vehicle ${v.plate} (ref ${f.fineReference ?? "n/a"})`,
    body: [`Dear ${v.vendorName},`, "", `A traffic fine has been recorded against vehicle ${v.plate}.`, "",
      `Fine reference: ${f.fineReference ?? "n/a"}`, `Issuing authority: ${f.issuingAuthority ?? "not stated"}`, `Violation: ${f.description ?? "not stated"}`, `Violation date: ${fmt(f.violationAt)}`,
      `Fine amount: AED ${(f.amount ?? 0).toFixed(2)}`, ...(f.additionalPenalty ? [`Additional penalty: AED ${f.additionalPenalty.toFixed(2)}`] : []), `Total shown on the notice: AED ${total.toFixed(2)}`,
      `Payment deadline: ${f.deadline && f.deadlineSource ? fmt(f.deadline) : "not verified on the notice"}`, "",
      "Please arrange payment and send us the payment confirmation. If you believe this fine is not yours, reply with the details so we can review it.", "", "Al Tabeer Operations"].join("\n"),
  };
}
