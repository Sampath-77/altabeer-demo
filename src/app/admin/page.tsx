"use client";
import AdminShell from "@/components/AdminShell";
import { useApi, fmtDateTime } from "@/lib/client";

interface FS { detectedToday: { count: number; amount: number }; awaitingReview: number; awaitingVerification: number; unresolved: { count: number; fineAmount: number; additionalPenalty: number; paid: number; outstanding: number }; overdue: number; approaching: number }

type Off = { available: false; reason: string };
interface D { generatedAt: string; drivers: { active: number; inactive: number; checkedIn: number; checkedOut: number; openOrOverdueShifts: number }; vehicles: { total: number; active: number }; vendors: { total: number };
  fines: Off; ocrAwaitingReview: Off; syncFailures: Off; definitions: Record<string, string> }
const Stat = ({ l, v, note, navy }: { l: string; v: number; note?: string; navy?: boolean }) => <div className={`stat ${navy ? "navy" : ""}`}><small>{l}</small><b>{v}</b>{note && <em>{note}</em>}</div>;
const Off = ({ l, o }: { l: string; o: Off }) => <div className="stat off"><small>{l}</small><b>Not connected yet</b><em>{o.reason}</em></div>;

export default function Overview() {
  const { data, error, loading } = useApi<D>("/api/admin/dashboard", 30_000);
  const fs = useApi<FS>("/api/admin/fines/stats", 30_000).data;
  const sync = useApi<{ odoo: { ok: boolean }; outbox: { dead: number; retrying: number; pending: number } }>("/api/admin/sync-status", 30_000).data;
  return (
    <AdminShell title="Overview" sub={data ? `Read live from the Al Tabeer ERP · last refreshed ${fmtDateTime(data.generatedAt)} · updates every 30 s` : "Loading from the ERP…"}>
      {error && <div className="err" role="alert">{error}</div>}
      {loading && !data && <div className="card empty">Loading…</div>}
      {data && <>
        <div className="cards">
          <Stat navy l="Active drivers" v={data.drivers.active} /><Stat l="Inactive drivers" v={data.drivers.inactive} />
          <Stat l="Checked in" v={data.drivers.checkedIn} note="Open shift right now" /><Stat l="Checked out" v={data.drivers.checkedOut} note="Active, no open shift" />
          <Stat l="Open or overdue shifts" v={data.drivers.openOrOverdueShifts} note="Open for over 16 hours" />
          <Stat l="Vehicles" v={data.vehicles.total} note={`${data.vehicles.active} active`} /><Stat l="Vendors" v={data.vendors.total} />
        </div>
        <div className="cards">
          {fs ? <>
            <Stat l="Fines recorded today" v={fs.detectedToday.count} note={`AED ${fs.detectedToday.amount.toFixed(2)} (by date entered, not violation date)`} />
            <Stat l="Unresolved fines" v={fs.unresolved.count} note={`Fine AED ${fs.unresolved.fineAmount.toFixed(2)} + penalties AED ${fs.unresolved.additionalPenalty.toFixed(2)}`} />
            <Stat navy l="Outstanding (AED)" v={fs.unresolved.outstanding} note={`After AED ${fs.unresolved.paid.toFixed(2)} verified payments`} />
            <Stat l="Overdue" v={fs.overdue} note="Verified deadline has passed" /><Stat l="Due within 7 days" v={fs.approaching} />
            <Stat l="OCR awaiting review" v={fs.awaitingReview} /><Stat l="Payments to verify" v={fs.awaitingVerification} /></> : <Off l="Fines and amounts" o={data.fines} />}
          {sync ? <a href="/admin/sync"><Stat l="ERP sync problems" v={sync.outbox.dead + sync.outbox.retrying} note={sync.odoo.ok ? `ERP reachable · ${sync.outbox.pending} waiting` : "ERP unreachable"} /></a> : <Off l="Sync failures" o={data.syncFailures} />}
        </div>
        <div className="defs"><b>How these are counted</b>{Object.values(data.definitions).map(d => <span key={d}>{d}</span>)}</div>
      </>}
    </AdminShell>
  );
}
