/** Normalised matching key. Originals are always stored alongside; emirate/code must also match. */
export function normalizePlate(raw: string): string {
  return raw
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
