"use client";
import { useCallback, useEffect, useState } from "react";

export class ApiError extends Error { constructor(public code: string, msg: string, public status: number) { super(msg); } }
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const go = () => fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  let r: Response;
  try { r = await go(); } catch { throw new ApiError("NETWORK", "No connection. Check your internet and try again.", 0); }
  if (r.status === 401 && !path.startsWith("/api/auth/")) {
    const rr = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
    if (rr?.ok) r = await go();
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && typeof window !== "undefined" && location.pathname !== "/login") location.href = "/login";
    throw new ApiError(j?.error?.code ?? "ERROR", j?.error?.message ?? "Request failed.", r.status);
  }
  return j as T;
}
export function useApi<T>(path: string, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { load(); if (!pollMs) return; const t = setInterval(load, pollMs); return () => clearInterval(t); }, [load, pollMs]);
  return { data, error, loading, reload: load };
}
const TZ = "Asia/Dubai";
export const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
export const fmtDuration = (m: number | null) => (m == null ? "" : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
