import { parsePlate } from "./plate";

export interface Field<T> { value: T; snippet: string }
export interface Extracted {
  fineReference?: Field<string>; plateRaw?: Field<string>; plateEmirate?: Field<string>; plateCode?: Field<string>;
  amount?: Field<number>; additionalPenalty?: Field<number>; violationAt?: Field<string>; deadline?: Field<string>;
  authority?: Field<string>; description?: Field<string>; vehicleMakeModel?: Field<string>; warnings: string[];
}
const AUTH: [RegExp, string][] = [[/roads\s*(and|&)\s*transport\s*authority|\bRTA\b/i, "RTA"], [/dubai\s+police/i, "Dubai Police"], [/abu\s*dhabi\s+police/i, "Abu Dhabi Police"], [/sharjah\s+police/i, "Sharjah Police"], [/ajman\s+police/i, "Ajman Police"], [/\bsalik\b/i, "Salik"]];
const SEP = String.raw`\s*[:#.\-–]?\s*`;
function after(lines: string[], labels: string): { value: string; line: string } | undefined {
  const re = new RegExp(`(?:^|\\b)(?:${labels})${SEP}(.+)$`, "i");
  for (const line of lines) { const m = re.exec(line); if (m && m[1].trim()) return { value: m[1].trim(), line }; }
}
const num = (s: string) => { const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(s); return m ? Number(m[1].replace(/,/g, "") + (m[2] ? "." + m[2] : "")) : NaN; };

/** Parses a Dubai-time date (dd/mm/yyyy [HH:mm]) to a UTC ISO string. dd/mm order is assumed (UAE convention). */
export function parseDubaiDate(s: string): { iso: string; hasTime: boolean } | null {
  const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  const [d, mo, y, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null; // rejects 31/02
  const t = new Date(Date.UTC(y, mo - 1, d, h - 4, mi));
  return { iso: t.toISOString(), hasTime: m[4] !== undefined };
}

/** Heuristic, label-based extraction. Tuned on assumptions, not on real notices: treat every value as a suggestion for admin review. */
export function extractFine(text: string): Extracted {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out: Extracted = { warnings: [] };
  const set = <K extends keyof Extracted>(k: K, v: Extracted[K]) => { out[k] = v; };

  const ref = after(lines, "fine\\s*(?:no|number|ref(?:erence)?)|ticket\\s*(?:no|number)|violation\\s*(?:no|number)|notice\\s*(?:no|number)|reference\\s*(?:no|number)?");
  const refTok = ref && /[A-Z0-9][A-Z0-9\-\/]{4,}/i.exec(ref.value);
  if (ref && refTok) set("fineReference", { value: refTok[0].toUpperCase(), snippet: ref.line });

  const plate = after(lines, "plate\\s*(?:no|number)?|vehicle\\s*(?:no|number)|registration(?:\\s*(?:no|number))?|car\\s*no");
  if (plate) {
    const p = parsePlate(plate.value);
    if (p.number) { set("plateRaw", { value: plate.value, snippet: plate.line }); if (p.code) set("plateCode", { value: p.code, snippet: plate.line }); if (p.emirate) set("plateEmirate", { value: p.emirate, snippet: plate.line }); }
  }
  const src = after(lines, "plate\\s*source|emirate"); if (src && !out.plateEmirate) { const e = parsePlate(src.value).emirate; if (e) set("plateEmirate", { value: e, snippet: src.line }); }
  const cat = after(lines, "plate\\s*(?:code|category)"); if (cat && !out.plateCode) { const c = /^[A-Z0-9]{1,2}\b/i.exec(cat.value); if (c) set("plateCode", { value: c[0].toUpperCase(), snippet: cat.line }); }

  const amt = after(lines, "fine\\s*amount|violation\\s*amount|fine\\s*value|amount\\s*due|total\\s*amount|amount");
  if (amt && Number.isFinite(num(amt.value))) set("amount", { value: num(amt.value), snippet: amt.line });
  const distinct = new Set(lines.filter(l => /\b(AED|DHS?|DH)\b/i.test(l)).map(l => num(l)).filter(Number.isFinite));
  if (!out.amount && distinct.size === 1) { const l = lines.find(x => /\b(AED|DHS?|DH)\b/i.test(x))!; set("amount", { value: num(l), snippet: l }); }
  else if (!out.amount && distinct.size > 1) out.warnings.push("AMOUNT_AMBIGUOUS");
  const pen = after(lines, "late\\s*fee|delay\\s*(?:fine|fee)|additional\\s*(?:fine|penalty)|penalty"); if (pen && Number.isFinite(num(pen.value))) set("additionalPenalty", { value: num(pen.value), snippet: pen.line });

  const vd = after(lines, "violation\\s*date(?:\\s*(?:&|and)\\s*time)?|date\\s*of\\s*(?:violation|offen[cs]e)|offen[cs]e\\s*date|date\\s*(?:&|and)\\s*time");
  const vp = vd && parseDubaiDate(vd.value); if (vd && vp) set("violationAt", { value: vp.iso, snippet: vd.line }); else if (vd) out.warnings.push("DATE_UNPARSEABLE");
  const dl = after(lines, "due\\s*date|pay\\s*(?:before|by)|payment\\s*(?:deadline|due)|last\\s*(?:date|day)|deadline");
  const dp = dl && parseDubaiDate(dl.value); if (dl && dp) set("deadline", { value: dp.hasTime ? dp.iso : new Date(Date.parse(dp.iso) + (23 * 60 + 59) * 60_000).toISOString(), snippet: dl.line }); // date-only deadline = end of that Dubai day

  for (const [re, name] of AUTH) { const l = lines.find(x => re.test(x)); if (l) { set("authority", { value: name, snippet: l }); break; } }
  const desc = after(lines, "violation(?:\\s*description)?|offen[cs]e|fine\\s*description|description"); if (desc && !/^\d/.test(desc.value)) set("description", { value: desc.value, snippet: desc.line });
  const mm = after(lines, "vehicle\\s*(?:make|model)|make\\s*(?:&|and)?\\s*model|make|model"); if (mm) set("vehicleMakeModel", { value: mm.value, snippet: mm.line });
  return out;
}
