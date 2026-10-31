/** In-memory sliding window. Per-instance only; swap for Redis when running more than one instance. */
const hits = new Map<string, number[]>();
export function allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const arr = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
