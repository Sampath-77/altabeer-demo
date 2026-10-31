"use client";
import { useState } from "react";
import { api } from "@/lib/client";

/** UI changes only after the backend confirms; errors are shown, never swallowed. */
export default function ShiftToggle({ open, onDone, onError, compact }: { open: boolean; onDone: () => void; onError: (m: string) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await api(open ? "/api/shifts/check-out" : "/api/shifts/check-in", { method: "POST" }); onDone(); }
    catch (e) { onError((e as Error).message); onDone(); } finally { setBusy(false); }
  }
  return <button className={`btn ${compact ? "sm" : open ? "red" : "green"}`} disabled={busy} onClick={go}>{busy ? "Please wait…" : open ? "Check Out" : "Check In"}</button>;
}
