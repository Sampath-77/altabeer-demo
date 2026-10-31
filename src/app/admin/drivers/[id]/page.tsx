"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminShell from "@/components/AdminShell";
import { useApi, fmtDateTime, fmtDuration } from "@/lib/client";

interface D { driver: { id: number; name: string; active: boolean; jobTitle?: string }; openShift: { checkIn: string } | null; assignment: { plate: string; model: string | null; since: string } | null;
  shifts: { id: number; checkIn: string; checkOut: string | null; durationMinutes: number }[]; generatedAt: string }
export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useApi<D>(`/api/admin/drivers/${id}`, 30_000);
  return (
    <AdminShell title={data?.driver.name ?? "Driver"} sub={data ? `${data.driver.jobTitle ?? "No job title"} · employee ID ${data.driver.id} · ${data.driver.active ? "Active" : "Inactive"}` : undefined}>
      <p><Link href="/admin/drivers">← Back to monitoring</Link></p>
      {error && <div className="err" role="alert">{error}</div>}
      {data && <>
        <div className="cards">
          <div className="stat"><small>Current shift</small><b style={{ fontSize: 18 }}>{data.openShift ? `Since ${fmtDateTime(data.openShift.checkIn)}` : "Checked out"}</b></div>
          <div className="stat"><small>Assigned vehicle</small><b style={{ fontSize: 18 }}>{data.assignment ? `${data.assignment.plate}${data.assignment.model ? ` · ${data.assignment.model}` : ""}` : "None"}</b>{data.assignment && <em>Since {fmtDateTime(data.assignment.since)}</em>}</div>
        </div>
        <h2>Shift history</h2>
        <div className="tbl"><table><thead><tr><th>Check-in</th><th>Check-out</th><th>Duration</th></tr></thead><tbody>
          {data.shifts.length === 0 && <tr><td colSpan={3}>No shifts recorded.</td></tr>}
          {data.shifts.map(s => <tr key={s.id}><td>{fmtDateTime(s.checkIn)}</td><td>{s.checkOut ? fmtDateTime(s.checkOut) : <span className="tag g">Open</span>}</td><td>{fmtDuration(s.durationMinutes)}</td></tr>)}
        </tbody></table></div>
        <p className="foot">Attendance corrections and fine history are not available yet.</p>
      </>}
    </AdminShell>
  );
}
