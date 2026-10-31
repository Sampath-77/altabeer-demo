import { randomInt } from "crypto";
export const validateLoginId = (s: string) => (/^[A-Za-z0-9._-]{3,64}$/.test(s) ? null : "Login ID must be 3-64 characters: letters, digits, dot, dash or underscore.");
export function validatePassword(p: string, loginId = ""): string | null {
  if (p.length < 12) return "Password must be at least 12 characters.";
  if (p.length > 128) return "Password is too long.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Password needs letters and digits.";
  if (loginId && p.toLowerCase().includes(loginId.toLowerCase())) return "Password must not contain the login ID.";
  return null;
}
export function generatePassword(len = 16): string { const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let p = ""; do { p = Array.from({ length: len }, () => a[randomInt(a.length)]).join(""); } while (validatePassword(p)); return p; }
