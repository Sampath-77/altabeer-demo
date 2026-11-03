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

const CAR_MAKES = [
  "TOYOTA", "NISSAN", "MITSUBISHI", "LEXUS", "HYUNDAI", "KIA", "HONDA", "SUZUKI",
  "MERCEDES", "BMW", "AUDI", "FORD", "CHEVROLET", "MAZDA", "VOLKSWAGEN", "VW",
  "PORSCHE", "LAND ROVER", "RANGE ROVER", "JEEP", "MG", "GEELY", "CHANGAN",
  "CHERY", "GAC", "HAVAL", "BYD", "ISUZU", "VOLVO", "PEUGEOT", "RENAULT",
  "INFINITI", "DODGE", "GMC", "CADILLAC", "TESLA"
];

const COLORS = [
  "WHITE", "BLACK", "SILVER", "GREY", "GRAY", "RED", "BLUE", "GOLD", "YELLOW",
  "GREEN", "BROWN", "ORANGE", "BRONZE", "BEIGE", "MAROON", "PEARL"
];

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

const AUTH: [RegExp, string][] = [
  [/roads\s*(and|&)\s*transport\s*authority|\bRTA\b/i, "RTA"],
  [/dubai\s+police/i, "Dubai Police"],
  [/abu\s*dhabi\s+police/i, "Abu Dhabi Police"],
  [/sharjah\s+police/i, "Sharjah Police"],
  [/ajman\s+police/i, "Ajman Police"],
  [/\bsalik\b/i, "Salik"],
  [/ministry\s+of\s+interior/i, "Ministry of Interior"],
  [/federal\s+traffic\s+authority/i, "Federal Traffic Authority"],
  [/department\s*of\s*transportation(?:\s*abu\s*dhabi)?|\bdot\s*abu\s*dhabi\b|integrated\s*transport\s*centre|\bitc\b|\bdarb\b/i, "Department of Transportation Abu Dhabi"],
];

const SEP = String.raw`\s*[:#.\-–"']?\s*`;

function after(lines: string[], labels: string): { value: string; line: string } | undefined {
  const re = new RegExp(`(?:^|\\b)(?:${labels})${SEP}(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = re.exec(line);
    if (m) {
      const sameLine = m[1].trim();
      if (sameLine && !/^[:\-#–"'\s]+$/.test(sameLine)) return { value: sameLine, line };
      // Look ahead up to 3 lines if value is wrapped or in next column
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (/^[A-Za-z\s]{3,25}:/.test(next) && !/^(AED|USD|\d+)/i.test(next)) break;
        return { value: next, line: `${line} ${next}` };
      }
    }
  }
}

const num = (s: string): number => {
  const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(s);
  return m ? Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")) : NaN;
};

/** Parses a Dubai-time date (dd/mm/yyyy [HH:mm], textual e.g. "25 Sep 2026, 5:03 pm") to a UTC ISO string. dd/mm order is assumed (UAE convention). */
export function parseDubaiDate(s: string): { iso: string; hasTime: boolean } | null {
  if (!s) return null;
  const clean = s.trim();

  // Pattern 1: Textual month e.g. "25 Sep 2026, 5:03 pm" or "25-Sep-2026 17:03"
  const mText = /(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s,]+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?/i.exec(clean);
  if (mText) {
    const d = Number(mText[1]);
    const mo = MONTHS[mText[2].toLowerCase()];
    const y = Number(mText[3]);
    let h = mText[4] ? Number(mText[4]) : 0;
    const mi = mText[5] ? Number(mText[5]) : 0;
    const ampm = mText[7]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;

    if (mo && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      const probe = new Date(Date.UTC(y, mo - 1, d));
      if (probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d) {
        const t = new Date(Date.UTC(y, mo - 1, d, h - 4, mi));
        return { iso: t.toISOString(), hasTime: mText[4] !== undefined };
      }
    }
  }

  // Pattern 2: Numeric dd/mm/yyyy or dd-mm-yyyy [HH:mm [am/pm]]
  const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?)?/i.exec(clean);
  if (m) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    let h = Number(m[4] ?? 0);
    const mi = Number(m[5] ?? 0);
    const ampm = m[7]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;

    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59) {
      const probe = new Date(Date.UTC(y, mo - 1, d));
      if (probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d) {
        const t = new Date(Date.UTC(y, mo - 1, d, h - 4, mi));
        return { iso: t.toISOString(), hasTime: m[4] !== undefined };
      }
    }
  }

  // Pattern 3: ISO yyyy-mm-dd
  const mIso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(clean);
  if (mIso) {
    const [y, mo, d, h, mi] = [Number(mIso[1]), Number(mIso[2]), Number(mIso[3]), Number(mIso[4] ?? 0), Number(mIso[5] ?? 0)];
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const t = new Date(Date.UTC(y, mo - 1, d, h - 4, mi));
      return { iso: t.toISOString(), hasTime: mIso[4] !== undefined };
    }
  }

  return null;
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
  if (ref) {
    let val = ref.value;
    if (!/\d{4,}/.test(val)) {
      const idx = lines.findIndex(l => l.includes(ref.line.split(" ")[0]));
      if (idx !== -1) {
        for (let j = idx; j < Math.min(lines.length, idx + 4); j++) {
          const dig = /^\d{6,14}$/.exec(lines[j]);
          if (dig) { val = dig[0]; ref.line += " " + lines[j]; break; }
        }
      }
    }
    const refTok = /[A-Z0-9][A-Z0-9\-\/]{4,}/i.exec(val);
    if (refTok) set("fineReference", { value: refTok[0].toUpperCase(), snippet: ref.line });
  }

  // Standalone fine number fallback
  if (!out.fineReference) {
    for (let i = 0; i < lines.length; i++) {
      if (/fine\s*number|ticket\s*no|notice\s*no/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
          const m = /^\d{7,14}$/.exec(lines[j]);
          if (m) {
            set("fineReference", { value: m[0], snippet: `${lines[i]} ${lines[j]}` });
            break;
          }
        }
        if (out.fineReference) break;
      }
    }
  }

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

  // Standalone plate detection: look for emirate followed by code/number
  if (!out.plateRaw) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const p = parsePlate(l);
      if (p.number && p.emirate) {
        set("plateRaw", { value: l, snippet: l });
        set("plateEmirate", { value: p.emirate, snippet: l });
        if (p.code) set("plateCode", { value: p.code, snippet: l });
        break;
      } else if (p.emirate && !p.number && i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        const combined = `${l} ${next}`;
        const pComb = parsePlate(combined);
        if (pComb.number) {
          set("plateRaw", { value: combined, snippet: `${l} ${next}` });
          set("plateEmirate", { value: p.emirate, snippet: l });
          if (pComb.code) set("plateCode", { value: pComb.code, snippet: next });
          break;
        }
      }
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

  // Known car makes fallback if vehicleMakeModel not found
  if (!out.vehicleMakeModel) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const upper = l.toUpperCase();
      for (const make of CAR_MAKES) {
        if (upper.startsWith(make) || new RegExp(`\\b${make}\\b`).test(upper)) {
          set("vehicleMakeModel", { value: l.replace(/,$/, "").trim(), snippet: l });
          if (!out.vehicleColour) {
            for (const col of COLORS) {
              if (new RegExp(`\\b${col}\\b`, "i").test(l)) {
                set("vehicleColour", { value: col.charAt(0) + col.slice(1).toLowerCase(), snippet: l });
                break;
              }
              if (i + 1 < lines.length && new RegExp(`\\b${col}\\b`, "i").test(lines[i + 1])) {
                set("vehicleColour", { value: col.charAt(0) + col.slice(1).toLowerCase(), snippet: lines[i + 1] });
                break;
              }
            }
          }
          break;
        }
      }
      if (out.vehicleMakeModel) break;
    }
  }

  // ── Violation ──
  const desc = after(lines, "details|violation(?:\\s*description)?|offen[cs]e(?:\\s*description)?|fine\\s*description|description|reason");
  if (desc && !/^\d+$/.test(desc.value)) {
    let fullDesc = desc.value;
    const idx = lines.findIndex(l => l.includes(desc.line.split(" ")[0]));
    if (idx !== -1 && idx + 2 < lines.length) {
      const l1 = lines[idx + 1] || "";
      const l2 = lines[idx + 2] || "";
      if (!l1.includes(":") && !l2.includes(":") && l1.length > 2) {
        fullDesc = [l1, l2].filter(Boolean).join(" - ");
      }
    }
    set("description", { value: fullDesc, snippet: desc.line });
    if (/toll|salik|darb|بوابات|تعرفة/i.test(fullDesc) && !out.violationCategory) {
      set("violationCategory", { value: "Toll / Darb Violation", snippet: fullDesc });
    }
  }

  const vcat = after(lines, "violation\\s*category|offen[cs]e\\s*category|offence\\s*group");
  if (vcat) set("violationCategory", { value: vcat.value, snippet: vcat.line });

  const vcode = after(lines, "violation\\s*code|offen[cs]e\\s*code|traffic\\s*code|article");
  if (vcode) set("violationCode", { value: vcode.value, snippet: vcode.line });

  const vd = after(lines, "date\\s*(?:and|&)?\\s*time(?:\\s*of\\s*(?:issuing|violation|offen[cs]e))?|date\\s*of\\s*(?:violation|offen[cs]e|issue|issuing)|violation\\s*date(?:\\s*(?:&|and)\\s*time)?|offen[cs]e\\s*date|incident\\s*date|issue\\s*date");
  const vp = vd && parseDubaiDate(vd.value);
  if (vd && vp) {
    set("violationAt", { value: vp.iso, snippet: vd.line });
  } else if (vd) {
    let found = false;
    for (const l of lines) {
      const p = parseDubaiDate(l);
      if (p) { set("violationAt", { value: p.iso, snippet: l }); found = true; break; }
    }
    if (!found) out.warnings.push("DATE_UNPARSEABLE");
  } else {
    for (const l of lines) {
      const p = parseDubaiDate(l);
      if (p) { set("violationAt", { value: p.iso, snippet: l }); break; }
    }
  }

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
  const amt = after(lines, "fine\\s*amount|violation\\s*amount|fine\\s*value|amount\\s*due|original\\s*amount|base\\s*amount|amount");
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
  for (const [re, name] of AUTH) {
    const l = lines.find(x => re.test(x));
    if (l) {
      set("authority", { value: name, snippet: l });
      if (!out.issuingAuthority) set("issuingAuthority", { value: name, snippet: l });
      break;
    }
  }

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
      // Skip if label is clearly noise or too short
      if (label.length <= 2) continue;
      if (/^(https?|www\.|page|\d+)$/i.test(label)) continue;
      if (value.length < 1 || /^\s*$/.test(value)) continue;
      // Don't duplicate already-captured values
      if ([...out.additionalFields].some(f => f.label.toLowerCase() === label.toLowerCase())) continue;
      out.additionalFields.push({ label, value, snippet: line });
    }
  }

  return out;
}
