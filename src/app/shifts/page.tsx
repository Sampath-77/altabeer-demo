"use client";
import { useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import Shell from "@/components/Shell";
import ShiftToggle from "@/components/ShiftToggle";
import { useApi, fmtTime, fmtDate, fmtDuration } from "@/lib/client";

interface Cur { open: boolean; shift?: { checkIn: string; durationMinutes: number }; staleWarning?: string }
interface Sh { id: number; checkIn: string; checkOut: string | null; durationMinutes: number | null }

export default function Shifts() {
  const cur = useApi<Cur>("/api/shifts/current");
  const hist = useApi<{ shifts: Sh[] }>("/api/shifts?limit=20");
  const [err, setErr] = useState<string | null>(null);
  const open = cur.data?.open ?? false;
  const done = () => { cur.reload(); hist.reload(); };
  const closed = hist.data?.shifts.filter(s => s.checkOut) ?? [];
  return (
    <Shell title="Shift Management" subtitle="Track your check-in, check-out and shift history">
      {(err || cur.error) && <div className="err" role="alert">{err ?? cur.error}</div>}
      {cur.data?.staleWarning && <div className="warn">{cur.data.staleWarning}</div>}
      <div className="card row" style={{ alignItems: "center" }}>
        <div>
          <b>{open ? "You are currently CHECKED IN" : "You are currently CHECKED OUT"}</b>
          <small>{open && cur.data?.shift ? `Since ${fmtDate(cur.data.shift.checkIn)}, ${fmtTime(cur.data.shift.checkIn)} · ${fmtDuration(cur.data.shift.durationMinutes)}` : "Tap Check In below to start a shift"}</small>
        </div>
        {open ? <LogOut aria-hidden /> : <LogIn aria-hidden />}
      </div>
      <div style={{ margin: "16px 0 6px" }}>{cur.data && <ShiftToggle open={open} onDone={done} onError={m => setErr(m)} />}</div>
      <p className="foot" style={{ marginTop: 0 }}>{open ? "Ends the shift recorded in the Al Tabeer ERP" : "Starts a shift recorded in the Al Tabeer ERP"}</p>
      <h2>Recent Shifts</h2>
      {hist.error ? <div className="err">{hist.error}</div> : closed.length === 0 ? (
        <div className="card empty"><b>No completed shifts yet</b>Your closed shifts will appear here</div>
      ) : (
        <div className="hist">{closed.map(s => (
          <div className="card row" key={s.id}><div><b>{fmtDate(s.checkIn)}</b><small>{fmtTime(s.checkIn)} – {fmtTime(s.checkOut!)}</small></div><b>{fmtDuration(s.durationMinutes)}</b></div>
        ))}</div>
      )}
    </Shell>
  );
}
