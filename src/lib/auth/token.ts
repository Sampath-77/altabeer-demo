import { createHmac, timingSafeEqual } from "crypto";
export type RoleName = "DRIVER" | "ADMIN";
export interface Claims { sub: string; role: RoleName; iat: number; exp: number }

const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const mac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function signToken(c: { sub: string; role: RoleName }, ttlSec: number, secret: string, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const body = `${enc({ alg: "HS256", typ: "JWT" })}.${enc({ ...c, iat, exp: iat + ttlSec })}`;
  return `${body}.${mac(body, secret)}`;
}
export function verifyToken(token: string, secret: string, nowMs = Date.now()): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(parts[2]), b = Buffer.from(mac(body, secret));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Claims;
    return c.exp * 1000 > nowMs ? c : null;
  } catch { return null; }
}
