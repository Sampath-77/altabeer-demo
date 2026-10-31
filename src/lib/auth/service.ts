import { createHash, randomBytes } from "crypto";
import { verifyPassword } from "./password";
import { signToken, type RoleName } from "./token";

export interface UserRec { odooEmployeeId?: number | null; id: string; loginId: string; passwordHash: string; role: RoleName; status: "ACTIVE" | "DISABLED"; failedLogins: number; lockedUntil: Date | null }
export interface RefreshRec { id: string; userId: string; expiresAt: Date; revokedAt: Date | null }
export interface AuthRepo {
  findByLoginId(loginId: string): Promise<UserRec | null>;
  findById(id: string): Promise<UserRec | null>;
  setFailures(id: string, count: number, lockedUntil: Date | null): Promise<void>;
  createRefresh(r: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  findRefresh(tokenHash: string): Promise<RefreshRec | null>;
  revokeRefresh(id: string): Promise<void>;
  revokeAllForUser(userId: string): Promise<void>;
}
export interface AuthConfig { secret: string; accessTtlSec: number; refreshTtlSec: number; maxFailures: number; lockMs: number }
export class AuthError extends Error {
  extra?: Record<string, unknown>;
  constructor(public code: string, public status: number, msg?: string, extra?: Record<string, unknown>) {
    super(msg ?? code);
    if (extra) this.extra = extra;
  }
}
export interface Session { accessToken: string; refreshToken: string; user: { id: string; loginId: string; role: RoleName } }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
// Hash of a throwaway password so unknown-user logins cost the same as real ones.
const DUMMY = "scrypt$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86);

async function issue(repo: AuthRepo, cfg: AuthConfig, u: UserRec, now: number): Promise<Session> {
  const refreshToken = randomBytes(32).toString("base64url");
  await repo.createRefresh({ userId: u.id, tokenHash: sha(refreshToken), expiresAt: new Date(now + cfg.refreshTtlSec * 1000) });
  return { accessToken: signToken({ sub: u.id, role: u.role }, cfg.accessTtlSec, cfg.secret, now), refreshToken, user: { id: u.id, loginId: u.loginId, role: u.role } };
}

/** `gate` runs after the account checks and before tokens are issued (e.g. confirm the employee is still active in the ERP). */
export type Gate = (u: UserRec) => Promise<void>;
export async function login(repo: AuthRepo, cfg: AuthConfig, loginId: string, password: string, now = Date.now(), gate?: Gate): Promise<Session> {
  const u = await repo.findByLoginId(loginId);
  if (u?.lockedUntil && u.lockedUntil.getTime() > now) throw new AuthError("ACCOUNT_LOCKED", 423, "Too many failed attempts. Try again later.");
  const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY);
  if (!u || !ok) {
    if (u) {
      const n = u.failedLogins + 1;
      await repo.setFailures(u.id, n >= cfg.maxFailures ? 0 : n, n >= cfg.maxFailures ? new Date(now + cfg.lockMs) : null);
    }
    throw new AuthError("INVALID_CREDENTIALS", 401, "Invalid login ID or password.");
  }
  if (u.status !== "ACTIVE") throw new AuthError("ACCOUNT_DISABLED", 403, "This account is disabled. Contact Al Tabeer operations.");
  if (gate) await gate(u);
  if (u.failedLogins) await repo.setFailures(u.id, 0, null);
  return issue(repo, cfg, u, now);
}

/** Rotating refresh tokens; presenting an already-revoked token revokes every session for that user (theft signal). */
export async function refresh(repo: AuthRepo, cfg: AuthConfig, token: string, now = Date.now(), gate?: Gate): Promise<Session> {
  const rec = await repo.findRefresh(sha(token));
  if (!rec) throw new AuthError("INVALID_SESSION", 401);
  if (rec.revokedAt) { await repo.revokeAllForUser(rec.userId); throw new AuthError("INVALID_SESSION", 401); }
  if (rec.expiresAt.getTime() <= now) throw new AuthError("SESSION_EXPIRED", 401);
  const u = await repo.findById(rec.userId);
  if (!u || u.status !== "ACTIVE") { await repo.revokeAllForUser(rec.userId); throw new AuthError("ACCOUNT_DISABLED", 403); }
  if (gate) { try { await gate(u); } catch (e) { if (e instanceof AuthError && e.status === 403) await repo.revokeAllForUser(u.id); throw e; } }
  await repo.revokeRefresh(rec.id);
  return issue(repo, cfg, u, now);
}

export async function logout(repo: AuthRepo, token: string | undefined): Promise<void> {
  if (!token) return;
  const rec = await repo.findRefresh(sha(token));
  if (rec && !rec.revokedAt) await repo.revokeRefresh(rec.id);
}
