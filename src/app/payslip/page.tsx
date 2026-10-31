"use client";
import { useState } from "react";
import Shell from "@/components/Shell";
import { useApi } from "@/lib/client";

interface P { id: number; name: string; dateFrom: string; dateTo: string; net: number | null; lines: { name: string; category: string; amount: number }[] }
const month = (iso: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso));

export default function Payslip() {
  const { data, error, loading } = useApi<{ payslips: P[] }>("/api/payslips");
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Shell title="Payslip" subtitle="View your salary breakdown and deductions">
      {error ? <div className="err" role="alert">{error}</div> : loading ? <div className="card empty">Loading…</div> : !data?.payslips.length ? (
        <div className="card empty"><b>No payslips available yet</b>Your monthly payslips will appear here once generated in the ERP.</div>
      ) : (
        <div className="hist">{data.payslips.map(p => (
          <div className="card" key={p.id}>
            <button className="row" style={{ width: "100%", background: "none", border: 0, padding: 0, textAlign: "left" }} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <div><b>{month(p.dateFrom)}</b><small>Net salary</small></div><b>{p.net == null ? "—" : `AED ${p.net.toFixed(2)}`}</b>
            </button>
            {open === p.id && (p.lines.length ? p.lines.map((l, i) => <div className="row" key={i} style={{ marginTop: 10, fontSize: 14 }}><span>{l.name}<small>{l.category}</small></span><span>{l.amount < 0 ? "−" : ""}AED {Math.abs(l.amount).toFixed(2)}</span></div>) : <p className="foot">No breakdown lines are available for this payslip.</p>)}
          </div>
        ))}</div>
      )}
    </Shell>
  );
}
