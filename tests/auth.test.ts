import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signToken, verifyToken } from "@/lib/auth/token";
import { login, refresh, logout, AuthError, type AuthRepo, type UserRec, type RefreshRec, type AuthConfig } from "@/lib/auth/service";
import { requireRole, assertOwnerOrAdmin, authenticate } from "@/lib/auth/guard";
import { allow } from "@/lib/ratelimit";

const SECRET = "x".repeat(40);
const cfg: AuthConfig = { secret: SECRET, accessTtlSec: 900, refreshTtlSec: 86400, maxFailures: 3, lockMs: 60_000 };

async function setup(over: Partial<UserRec> = {}) {
  const users = new Map<string, UserRec>();
  const refreshes = new Map<string, RefreshRec & { hash: string }>();
  const u: UserRec = { id: "u1", loginId: "drv001", passwordHash: await hashPassword("correct-horse"), role: "DRIVER", status: "ACTIVE", failedLogins: 0, lockedUntil: null, ...over };
  users.set(u.id, u);
  let n = 0;
  const repo: AuthRepo = {
    findByLoginId: async l => [...users.values()].find(x => x.loginId === l) ?? null,
    findById: async id => users.get(id) ?? null,
    setFailures: async (id, c, l) => { Object.assign(users.get(id)!, { failedLogins: c, lockedUntil: l }); },
    createRefresh: async r => { refreshes.set(r.tokenHash, { id: `r${++n}`, hash: r.tokenHash, userId: r.userId, expiresAt: r.expiresAt, revokedAt: null }); },
    findRefresh: async h => refreshes.get(h) ?? null,
    revokeRefresh: async id => { for (const r of refreshes.values()) if (r.id === id) r.revokedAt = new Date(); },
    revokeAllForUser: async uid => { for (const r of refreshes.values()) if (r.userId === uid) r.revokedAt = new Date(); },
  };
  return { repo, users, refreshes };
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: AuthError) => e.code);

describe("passwords & tokens", () => {
  it("verifies correct and rejects wrong password", async () => {
    const h = await hashPassword("pw");
    expect(await verifyPassword("pw", h)).toBe(true);
    expect(await verifyPassword("nope", h)).toBe(false);
  });
  it("rejects tampered and expired tokens", () => {
    const t = signToken({ sub: "a", role: "DRIVER" }, 60, SECRET, 0);
    expect(verifyToken(t, SECRET, 30_000)?.sub).toBe("a");
    expect(verifyToken(t, SECRET, 61_000)).toBeNull();
    expect(verifyToken(t.slice(0, -2) + "xx", SECRET, 1000)).toBeNull();
    expect(verifyToken(t, "y".repeat(40), 1000)).toBeNull();
  });
});

describe("login", () => {
  it("succeeds with valid credentials", async () => {
    const { repo } = await setup();
    const s = await login(repo, cfg, "drv001", "correct-horse");
    expect(s.user.role).toBe("DRIVER");
    expect(verifyToken(s.accessToken, SECRET)?.sub).toBe("u1");
  });
  it("gives the same error for wrong password and unknown user", async () => {
    const { repo } = await setup();
    expect(await code(login(repo, cfg, "drv001", "bad"))).toBe("INVALID_CREDENTIALS");
    expect(await code(login(repo, cfg, "ghost", "bad"))).toBe("INVALID_CREDENTIALS");
  });
  it("rejects disabled accounts", async () => {
    const { repo } = await setup({ status: "DISABLED" });
    expect(await code(login(repo, cfg, "drv001", "correct-horse"))).toBe("ACCOUNT_DISABLED");
  });
  it("locks after repeated failures, even for the right password", async () => {
    const { repo } = await setup();
    for (let i = 0; i < 3; i++) await code(login(repo, cfg, "drv001", "bad", 1000));
    expect(await code(login(repo, cfg, "drv001", "correct-horse", 2000))).toBe("ACCOUNT_LOCKED");
    expect(await code(login(repo, cfg, "drv001", "correct-horse", 1000 + 61_000))).toBe("ok");
  });
});

describe("refresh & logout", () => {
  it("rotates refresh tokens and detects reuse", async () => {
    const { repo } = await setup();
    const s1 = await login(repo, cfg, "drv001", "correct-horse");
    const s2 = await refresh(repo, cfg, s1.refreshToken);
    expect(s2.refreshToken).not.toBe(s1.refreshToken);
    expect(await code(refresh(repo, cfg, s1.refreshToken))).toBe("INVALID_SESSION"); // reuse
    expect(await code(refresh(repo, cfg, s2.refreshToken))).toBe("INVALID_SESSION"); // family revoked
  });
  it("rejects expired refresh and revokes on logout", async () => {
    const { repo } = await setup();
    const s = await login(repo, cfg, "drv001", "correct-horse", 0);
    expect(await code(refresh(repo, cfg, s.refreshToken, 90_000_000))).toBe("SESSION_EXPIRED");
    const s2 = await login(repo, cfg, "drv001", "correct-horse");
    await logout(repo, s2.refreshToken);
    expect(await code(refresh(repo, cfg, s2.refreshToken))).toBe("INVALID_SESSION");
  });
  it("refuses refresh once the account is disabled", async () => {
    const { repo, users } = await setup();
    const s = await login(repo, cfg, "drv001", "correct-horse");
    users.get("u1")!.status = "DISABLED";
    expect(await code(refresh(repo, cfg, s.refreshToken))).toBe("ACCOUNT_DISABLED");
  });
});

describe("authorization", () => {
  const req = (tok?: string) => new Request("http://x/api", { headers: tok ? { cookie: `at=${tok}` } : {} });
  it("requires a valid session", () => {
    expect(() => authenticate(req(), SECRET)).toThrow(AuthError);
    expect(() => authenticate(req("garbage"), SECRET)).toThrow(AuthError);
    const tok = signToken({ sub: "u1", role: "DRIVER" }, 60, SECRET);
    expect(authenticate(req(tok), SECRET).sub).toBe("u1");
  });
  it("blocks drivers from admin routes", () => {
    const d = authenticate(req(signToken({ sub: "u1", role: "DRIVER" }, 60, SECRET)), SECRET);
    expect(() => requireRole(d, "ADMIN")).toThrow(/access/);
    expect(requireRole(d, "DRIVER", "ADMIN")).toBe(d);
  });
  it("blocks a driver from another driver's records but allows admin", () => {
    const d = { sub: "u1", role: "DRIVER" as const, iat: 0, exp: 9e9 };
    const a = { sub: "adm", role: "ADMIN" as const, iat: 0, exp: 9e9 };
    expect(() => assertOwnerOrAdmin(d, "u2")).toThrow(AuthError);
    expect(() => assertOwnerOrAdmin(d, "u1")).not.toThrow();
    expect(() => assertOwnerOrAdmin(a, "u2")).not.toThrow();
  });
});

describe("rate limiter", () => {
  it("blocks over the limit within the window and recovers", () => {
    expect([1, 2, 3].map(i => allow("k", 2, 1000, i))).toEqual([true, true, false]);
    expect(allow("k", 2, 1000, 5000)).toBe(true);
  });
});
