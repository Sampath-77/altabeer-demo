import type { OdooVehicle } from "../odoo/types";

const EMIRATES: [string, string][] = [
  ["ABU DHABI", "ABU DHABI"], ["ABUDHABI", "ABU DHABI"],
  ["DUBAI", "DUBAI"], ["DUBRI", "DUBAI"], ["DUBAL", "DUBAI"], ["DUBA1", "DUBAI"], ["DUBI", "DUBAI"],
  ["SHARJAH", "SHARJAH"], ["AJMAN", "AJMAN"], ["UMM AL QUWAIN", "UAQ"], ["UAQ", "UAQ"],
  ["RAS AL KHAIMAH", "RAK"], ["RAK", "RAK"], ["FUJAIRAH", "FUJAIRAH"]
];
export interface PlateParts { emirate?: string; code?: string; number?: string }

/** Splits "Dubai A 4827", "A-4827", "A4827" into parts. Numeric codes (Abu Dhabi) need a separator: "12 34567". */
export function parsePlate(raw: string): PlateParts {
  let t = raw.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  let emirate: string | undefined;
  for (const [needle, name] of EMIRATES) { const re = new RegExp(`(^| )${needle}( |$)`); if (re.test(t)) { emirate = name; t = t.replace(re, " ").trim(); break; } }
  const tok = t.split(" ").filter(Boolean);
  if (!tok.length) return { emirate };
  if (tok.length >= 2) return { emirate, code: tok.slice(0, -1).join(""), number: tok[tok.length - 1] };
  const m = /^([A-Z]*)(\d+)$/.exec(tok[0]);
  return m ? { emirate, code: m[1] || undefined, number: m[2] } : { emirate };
}
/** Normalised key for display/search. Originals are always kept alongside. */
export const plateKey = (p: PlateParts) => `${p.code ?? ""}${p.number ?? ""}`;

export interface PlateMatch { status: "MATCHED" | "AMBIGUOUS" | "UNMATCHED"; vehicles: OdooVehicle[]; reason?: "PLATE_INCOMPLETE" | "MULTIPLE_VEHICLES" | "NO_VEHICLE" }
/** Never auto-matches on a partial plate: a single confident match needs number AND code (when the vehicle has one) AND emirate (when both known). */
export function matchPlate(notice: PlateParts, vehicles: OdooVehicle[]): PlateMatch {
  if (!notice.number) return { status: "UNMATCHED", vehicles: [], reason: "NO_VEHICLE" };
  const cands = vehicles.filter(v => { const p = parsePlate(v.plate); return p.number === notice.number && (!notice.emirate || !p.emirate || p.emirate === notice.emirate); });
  if (!cands.length) return { status: "UNMATCHED", vehicles: [], reason: "NO_VEHICLE" };
  const full = cands.filter(v => { const p = parsePlate(v.plate); return (p.code ?? "") === (notice.code ?? "") ; });
  if (notice.code && full.length === 1) return { status: "MATCHED", vehicles: full };
  if (notice.code && full.length > 1) return { status: "AMBIGUOUS", vehicles: full, reason: "MULTIPLE_VEHICLES" };
  return { status: "AMBIGUOUS", vehicles: cands, reason: notice.code ? "NO_VEHICLE" : "PLATE_INCOMPLETE" };
}
