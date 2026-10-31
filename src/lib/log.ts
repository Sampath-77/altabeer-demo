const SECRET = /pass(word)?|secret|token|authorization|api[-_]?key|cookie|signature|credential/i;
export function redact(v: unknown, depth = 0): unknown {
  if (v === null || typeof v !== "object") return v; if (depth > 5) return "[deep]";
  if (Array.isArray(v)) return v.map(x => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET.test(k) ? "[redacted]" : redact(x, depth + 1)]));
}
/** One JSON line per event, secrets redacted by key name. */
export function log(level: "info" | "warn" | "error", msg: string, ctx: Record<string, unknown> = {}) { (level === "error" ? console.error : console.log)(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact(ctx) as object) })); }
