import { parsePlate } from "./plate";

export interface Field<T> { value: T; snippet: string; page?: number }
export interface AdditionalField { label: string; value: string; snippet: string; page?: number }
export interface Extracted {
  // Fine identification
  fineReference?: Field<string>;
  fineNumber?: Field<string>;
  transactionNumber?: Field<string>;
  noticeNumber?: Field<string>;
  fineCategory?: Field<string>;
  fineSource?: Field<string>;
  issuingAuthority?: Field<string>;
  issuingDepartment?: Field<string>;
  documentType?: Field<string>;
  documentLanguage?: Field<string>;
  qrContent?: Field<string>;

  // Vehicle
  plateRaw?: Field<string>;
  plateEmirate?: Field<string>;
  plateCode?: Field<string>;
  vehicleType?: Field<string>;
  vehicleMakeModel?: Field<string>;
  vehicleColour?: Field<string>;
  vehicleClassification?: Field<string>;

  // Violation
  description?: Field<string>;
  violationCategory?: Field<string>;
  violationCode?: Field<string>;
  violationAt?: Field<string>;
  violationTime?: Field<string>;
  violationLocation?: Field<string>;
  roadName?: Field<string>;
  area?: Field<string>;
  speedLimit?: Field<number>;
  recordedSpeed?: Field<number>;
  authorityComments?: Field<string>;

  // Financial
  amount?: Field<number>;
  outstandingAmount?: Field<number>;
  discountAmount?: Field<number>;
  discountPercentage?: Field<number>;
  additionalPenalty?: Field<number>;
  adminCharges?: Field<number>;
  totalPayable?: Field<number>;
  currency?: Field<string>;
  amountPaid?: Field<number>;

  // Payment & deadline
  deadline?: Field<string>;
  discountDeadline?: Field<string>;
  paymentReference?: Field<string>;
  paymentChannel?: Field<string>;
  paymentInstructions?: Field<string>;
  paymentUrl?: Field<string>;
  paymentDate?: Field<string>;

  // Driver / owner (only if explicitly in document)
  driverName?: Field<string>;
  licenseNumber?: Field<string>;
  ownerName?: Field<string>;

  // Document info
  documentIssueDate?: Field<string>;
  authority?: Field<string>;
  contactInfo?: Field<string>;
  officialWebsite?: Field<string>;

  // Dynamic catch-all
  additionalFields: AdditionalField[];
  warnings: string[];
  rawText?: string;
}

const AUTH: [RegExp, string][] = [
  [/roads\s*(and|&)\s*transport\s*authority|\bRTA\b/i, "RTA"],
  [/dubai\s+police/i, "Dubai Police"],
  [/abu\s*dhabi\s+police/i, "Abu Dhabi Police"],
  [/sharjah\s+police/i, "Sharjah Police"],
  [/ajman\s+police/i, "Ajman Police"],
  [/\bsalik\b/i, "Salik"],
  [/ministry\s+of\s+interior/i, "Ministry of Interior"],
  [/federal\s+traffic\s+authority/i, "Federal Traffic Authority"],
];

const SEP = String.raw`\s*[:#.\-–"']?\s*`;

function after(lines: string[], labels: string): { value: string; line: string } | undefined {
  const re = new RegExp(`(?:^|\\b)(?:${labels})${SEP}(.+)$`, "i");
  for (const line of lines) {
    const m = re.exec(line);
    if (m && m[1].trim()) return { value: m[1].trim(), line };
  }
}

const num = (s: string): number => {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(s);
  return m ? Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")) : NaN;
};

/** Parses a Dubai-time date (dd/mm/yyyy [HH:mm]) to a UTC ISO string. dd/mm order is assumed (UAE convention). */
export function parseDubaiDate(s: string): { iso: string; hasTime: boolean } | null {
  const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const [d, mo, y, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, h - 4, mi));
  return { iso: t.toISOString(), hasTime: m[4] !== undefined };
}

// Track which lines are "claimed" to avoid duplicates in additionalFields
function claimedSet(out: Extracted): Set<string> {
  const claimed = new Set<string>();
  const fields: (Field<unknown> | undefined)[] = [
    out.fineReference, out.fineNumber, out.transactionNumber, out.noticeNumber,
    out.fineCategory, out.fineSource, out.issuingAuthority, out.issuingDepartment,
    out.documentType, out.plateRaw, out.vehicleType, out.vehicleMakeModel, out.vehicleColour,
    out.description, out.violationCategory, out.violationCode, out.violationAt,
    out.violationLocation, out.roadName, out.area, out.amount, out.outstandingAmount,
    out.discountAmount, out.additionalPenalty, out.adminCharges, out.totalPayable,
    out.deadline, out.discountDeadline, out.paymentReference, out.paymentChannel,
    out.driverName, out.licenseNumber, out.ownerName, out.authority, out.contactInfo,
    out.officialWebsite,
  ];
  for (const f of fields) if (f) claimed.add(f.snippet);
  return claimed;
}

/** Heuristic, label-based extraction. Tuned on UAE challan formats. Treat every value as a suggestion for admin review. */
export function extractFine(text: string): Extracted {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: Extracted = { warnings: [], additionalFields: [], rawText: text };
  const set = <K extends keyof Extracted>(k: K, v: Extracted[K]) => { out[k] = v; };

  // ── Fine identification ──
  const ref = after(lines, "fine\\s*(?:no|number|ref(?:erence)?)|ticket\\s*(?:no|number)|violation\\s*(?:no|number)|notice\\s*(?:no|number)|reference\\s*(?:no|number)?|challan\\s*(?:no|number)");
  const refTok = ref && /[A-Z0-9][A-Z0-9\-\/]{4,}/i.exec(ref.value);
  if (ref && refTok) set("fineReference", { value: refTok[0].toUpperCase(), snippet: ref.line });

  const txn = after(lines, "transaction\\s*(?:no|number|id|ref)|txn\\s*(?:no|id)");
  if (txn) set("transactionNumber", { value: txn.value, snippet: txn.line });

  const notice = after(lines, "notice\\s*(?:no|number)|document\\s*(?:no|number)");
  if (notice && !out.fineReference) set("noticeNumber", { value: notice.value, snippet: notice.line });

  const fineCat = after(lines, "fine\\s*type|fine\\s*category|violation\\s*type|case\\s*type");
  if (fineCat) set("fineCategory", { value: fineCat.value, snippet: fineCat.line });

  const fineSrc = after(lines, "fine\\s*source|issuing\\s*source|source");
  if (fineSrc) set("fineSource", { value: fineSrc.value, snippet: fineSrc.line });

  const dept = after(lines, "issuing\\s*(?:department|dept|authority|office)|department|section");
  if (dept) set("issuingDepartment", { value: dept.value, snippet: dept.line });

  const lang = after(lines, "language|lang");
  if (lang) set("documentLanguage", { value: lang.value, snippet: lang.line });

  // ── Vehicle ──
  const plate = after(lines, "plate\\s*(?:no|number)?|vehicle\\s*(?:no|number)|registration(?:\\s*(?:no|number))?|car\\s*no|reg\\s*(?:no|number)");
  if (plate) {
    const p = parsePlate(plate.value);
    if (p.number) {
      set("plateRaw", { value: plate.value, snippet: plate.line });
      if (p.code) set("plateCode", { value: p.code, snippet: plate.line });
      if (p.emirate) set("plateEmirate", { value: p.emirate, snippet: plate.line });
    }
  }
  const src = after(lines, "plate\\s*source|emirate");
  if (src && !out.plateEmirate) { const e = parsePlate(src.value).emirate; if (e) set("plateEmirate", { value: e, snippet: src.line }); }
  const cat = after(lines, "plate\\s*(?:code|category|class)");
  if (cat && !out.plateCode) { const c = /^[A-Z0-9]{1,2}\b/i.exec(cat.value); if (c) set("plateCode", { value: c[0].toUpperCase(), snippet: cat.line }); }

  const vtype = after(lines, "vehicle\\s*type|vehicle\\s*class");
  if (vtype) set("vehicleType", { value: vtype.value, snippet: vtype.line });
  const mm = after(lines, "vehicle\\s*(?:make|model)|make\\s*(?:&|and)?\\s*model|make|model");
  if (mm) set("vehicleMakeModel", { value: mm.value, snippet: mm.line });
  const colour = after(lines, "vehicle\\s*colou?r|colou?r|color");
  if (colour) set("vehicleColour", { value: colour.value, snippet: colour.line });

  // ── Violation ──
  const desc = after(lines, "violation(?:\\s*description)?|offen[cs]e|fine\\s*description|description|reason");
  if (desc && !/^\d/.test(desc.value)) set("description", { value: desc.value, snippet: desc.line });

  const vcat = after(lines, "violation\\s*category|offen[cs]e\\s*category|offence\\s*group");
  if (vcat) set("violationCategory", { value: vcat.value, snippet: vcat.line });

  const vcode = after(lines, "violation\\s*code|offen[cs]e\\s*code|traffic\\s*code|article");
  if (vcode) set("violationCode", { value: vcode.value, snippet: vcode.line });

  const vd = after(lines, "violation\\s*date(?:\\s*(?:&|and)\\s*time)?|date\\s*of\\s*(?:violation|offen[cs]e)|offen[cs]e\\s*date|date\\s*(?:&|and)\\s*time|incident\\s*date");
  const vp = vd && parseDubaiDate(vd.value);
  if (vd && vp) set("violationAt", { value: vp.iso, snippet: vd.line });
  else if (vd) out.warnings.push("DATE_UNPARSEABLE");

  const vtime = after(lines, "violation\\s*time|offen[cs]e\\s*time|time\\s*of\\s*(?:violation|offen[cs]e)|incident\\s*time");
  if (vtime) set("violationTime", { value: vtime.value, snippet: vtime.line });

  const vloc = after(lines, "violation\\s*location|location\\s*of\\s*(?:violation|offen[cs]e)|location|place");
  if (vloc) set("violationLocation", { value: vloc.value, snippet: vloc.line });

  const road = after(lines, "road\\s*name|road|street|highway");
  if (road) set("roadName", { value: road.value, snippet: road.line });

  const area = after(lines, "area|zone|district|region");
  if (area) set("area", { value: area.value, snippet: area.line });

  const spLim = after(lines, "speed\\s*limit|allowed\\s*speed|maximum\\s*speed|limit");
  if (spLim) { const v = num(spLim.value); if (Number.isFinite(v)) set("speedLimit", { value: v, snippet: spLim.line }); }

  const recSp = after(lines, "recorded\\s*speed|actual\\s*speed|measured\\s*speed|speed\\s*recorded|vehicle\\s*speed");
  if (recSp) { const v = num(recSp.value); if (Number.isFinite(v)) set("recordedSpeed", { value: v, snippet: recSp.line }); }

  const authComm = after(lines, "authority\\s*comments?|remarks?|notes?|instructions?");
  if (authComm) set("authorityComments", { value: authComm.value, snippet: authComm.line });

  // ── Financial ──
  const amt = after(lines, "fine\\s*amount|violation\\s*amount|fine\\s*value|amount\\s*due|original\\s*amount|base\\s*amount");
  if (amt && Number.isFinite(num(amt.value))) set("amount", { value: num(amt.value), snippet: amt.line });

  const outstanding = after(lines, "outstanding\\s*(?:amount|balance)|balance\\s*due|remaining\\s*(?:amount|balance)");
  if (outstanding && Number.isFinite(num(outstanding.value))) set("outstandingAmount", { value: num(outstanding.value), snippet: outstanding.line });

  // AED amount fallback
  const distinct = new Set(lines.filter(l => /\b(AED|DHS?|DH)\b/i.test(l)).map(l => num(l)).filter(Number.isFinite));
  if (!out.amount && distinct.size === 1) {
    const l = lines.find(x => /\b(AED|DHS?|DH)\b/i.test(x))!;
    set("amount", { value: num(l), snippet: l });
  } else if (!out.amount && distinct.size > 1) out.warnings.push("AMOUNT_AMBIGUOUS");

  // Currency detection
  const curr = lines.find(l => /\b(AED|USD|EUR|GBP|SAR|QAR|BHD|KWD)\b/.test(l));
  if (curr) { const m = /\b(AED|USD|EUR|GBP|SAR|QAR|BHD|KWD)\b/.exec(curr); if (m) set("currency", { value: m[1], snippet: curr }); }

  const disc = after(lines, "discount\\s*(?:amount)?|early\\s*(?:payment\\s*)?discount|early\\s*payment");
  if (disc && Number.isFinite(num(disc.value))) set("discountAmount", { value: num(disc.value), snippet: disc.line });

  const discPct = after(lines, "discount\\s*percentage|discount\\s*%|%\\s*discount");
  if (discPct) { const pct = num(discPct.value); if (Number.isFinite(pct)) set("discountPercentage", { value: pct, snippet: discPct.line }); }

  const pen = after(lines, "late\\s*fee|delay\\s*(?:fine|fee)|additional\\s*(?:fine|penalty|charge)|extra\\s*penalty|penalty\\s*amount");
  if (pen && Number.isFinite(num(pen.value))) set("additionalPenalty", { value: num(pen.value), snippet: pen.line });

  const admin = after(lines, "admin(?:istrative)?\\s*(?:charge|fee|cost)|service\\s*(?:charge|fee)");
  if (admin && Number.isFinite(num(admin.value))) set("adminCharges", { value: num(admin.value), snippet: admin.line });

  const total = after(lines, "total\\s*(?:amount\\s*)?(?:payable|due|owed|to\\s*pay)|amount\\s*payable|total\\s*fine|grand\\s*total");
  if (total && Number.isFinite(num(total.value))) set("totalPayable", { value: num(total.value), snippet: total.line });

  const paid = after(lines, "amount\\s*paid|paid\\s*amount|payment\\s*received");
  if (paid && Number.isFinite(num(paid.value))) set("amountPaid", { value: num(paid.value), snippet: paid.line });

  // ── Deadlines ──
  const dl = after(lines, "due\\s*date|pay\\s*(?:before|by)|payment\\s*(?:deadline|due)|last\\s*(?:date|day)|deadline|expiry\\s*date");
  const dp = dl && parseDubaiDate(dl.value);
  if (dl && dp) set("deadline", { value: dp.hasTime ? dp.iso : new Date(Date.parse(dp.iso) + (23 * 60 + 59) * 60_000).toISOString(), snippet: dl.line });

  const ddl = after(lines, "discount\\s*(?:expiry|deadline|valid|available)\\s*(?:until|date|till)?|early\\s*payment\\s*(?:deadline|date|by)");
  const ddp = ddl && parseDubaiDate(ddl.value);
  if (ddl && ddp) set("discountDeadline", { value: ddp.iso, snippet: ddl.line });

  // ── Payment ──
  const payRef = after(lines, "payment\\s*(?:reference|ref|no|number|id)|pay\\s*ref");
  if (payRef) set("paymentReference", { value: payRef.value, snippet: payRef.line });

  const payCh = after(lines, "payment\\s*(?:channel|method|mode|via|through)|pay\\s*(?:via|through|at)");
  if (payCh) set("paymentChannel", { value: payCh.value, snippet: payCh.line });

  const payInstr = after(lines, "payment\\s*instructions?|how\\s*to\\s*pay|pay\\s*at|pay\\s*online|payment\\s*options?");
  if (payInstr) set("paymentInstructions", { value: payInstr.value, snippet: payInstr.line });

  const payUrl = lines.find(l => /https?:\/\/[^\s]+/i.test(l) && /pay|fine|challan|traffic/i.test(l));
  if (payUrl) { const m = /https?:\/\/[^\s]+/i.exec(payUrl); if (m) set("paymentUrl", { value: m[0], snippet: payUrl }); }

  const payDate = after(lines, "payment\\s*date|paid\\s*on|date\\s*of\\s*payment");
  const pdp = payDate && parseDubaiDate(payDate.value);
  if (payDate && pdp) set("paymentDate", { value: pdp.iso, snippet: payDate.line });

  // ── Driver / Owner (only if explicitly printed) ──
  const driverLine = after(lines, "driver\\s*(?:name|id)?|driver");
  if (driverLine && /[A-Za-z]{2,}/.test(driverLine.value)) set("driverName", { value: driverLine.value, snippet: driverLine.line });

  const lic = after(lines, "licen[cs]e\\s*(?:no|number)?|driving\\s*licen[cs]e|dl\\s*no");
  if (lic) set("licenseNumber", { value: lic.value, snippet: lic.line });

  const owner = after(lines, "(?:registered\\s*)?owner\\s*(?:name)?|vehicle\\s*owner");
  if (owner && /[A-Za-z]{2,}/.test(owner.value)) set("ownerName", { value: owner.value, snippet: owner.line });

  // ── Authority ──
  for (const [re, name] of AUTH) { const l = lines.find(x => re.test(x)); if (l) { set("authority", { value: name, snippet: l }); break; } }

  const contact = after(lines, "contact|tel|phone|fax|email|hotline|call\\s*centre|helpline");
  if (contact) set("contactInfo", { value: contact.value, snippet: contact.line });

  const web = lines.find(l => /https?:\/\/[^\s]+/i.test(l) && !/pay|fine|challan/i.test(l));
  if (web) { const m = /https?:\/\/[^\s]+/i.exec(web); if (m) set("officialWebsite", { value: m[0], snippet: web }); }

  const docDate = after(lines, "document\\s*(?:date|issue\\s*date|created|generated)|issue\\s*date|notice\\s*date");
  const ddDate = docDate && parseDubaiDate(docDate.value);
  if (docDate && ddDate) set("documentIssueDate", { value: ddDate.iso, snippet: docDate.line });

  // ── Generic key-value catch-all for additionalFields ──
  const claimed = claimedSet(out);
  const kvRe = /^([A-Za-z][A-Za-z0-9 \/_\-()]{2,40})\s*[:\-]\s*(.{1,200})$/;
  for (const line of lines) {
    if (claimed.has(line)) continue;
    if (line.length < 4 || line.length > 250) continue;
    const m = kvRe.exec(line);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      // Skip if label is clearly noise
      if (/^(https?|www\.|page|\d+)$/i.test(label)) continue;
      if (value.length < 1 || /^\s*$/.test(value)) continue;
      // Don't duplicate already-captured values
      if ([...out.additionalFields].some(f => f.label.toLowerCase() === label.toLowerCase())) continue;
      out.additionalFields.push({ label, value, snippet: line });
    }
  }

  return out;
}
