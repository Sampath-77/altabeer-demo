"use client";
import { useState } from "react";
import Shell from "@/components/Shell";
import { api, useApi, fmtDate, fmtTime } from "@/lib/client";

interface N { id: string; title: string; body: string; readAt: string | null; createdAt: string }
export default function Notifications() {
  const { data, error, loading, reload } = useApi<{ notifications: N[]; unread: number }>("/api/driver/notifications");
  const [err, setErr] = useState<string | null>(null);
  async function read(id: string) { try { await api(`/api/driver/notifications/${id}/read`, { method: "POST" }); reload(); } catch (e) { setErr((e as Error).message); } }
  return (
    <Shell title="Notifications" subtitle="Updates about your shifts, receipts and fines">
      {(error || err) && <div className="err" role="alert">{err ?? error}</div>}
      {loading ? <div className="card empty">Loading…</div> : !data?.notifications.length ? (
        <div className="card empty"><b>You are all caught up</b>New updates will appear here</div>
      ) : (
        <div className="hist">{data.notifications.map(n => (
          <button key={n.id} className="card" style={{ textAlign: "left", opacity: n.readAt ? 0.65 : 1 }} onClick={() => !n.readAt && read(n.id)}>
            <b>{n.title}</b><div style={{ fontSize: 14 }}>{n.body}</div><small style={{ color: "var(--mute)" }}>{fmtDate(n.createdAt)}, {fmtTime(n.createdAt)}{n.readAt ? "" : " · tap to mark read"}</small>
          </button>
        ))}</div>
      )}
    </Shell>
  );
}
