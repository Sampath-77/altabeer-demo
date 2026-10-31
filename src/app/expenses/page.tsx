"use client";
import { useRef, useState } from "react";
import { Camera, Fuel, CircleParking, CheckCircle2 } from "lucide-react";
import Shell from "@/components/Shell";
import { useApi, fmtDate } from "@/lib/client";

interface Exp { id: number; category: string; amount: number; vendor?: string; date: string; status: string }
const LABEL: Record<string, string> = { draft: "Draft", submitted: "Pending approval", approved: "Approved", paid: "Reimbursed", refused: "Rejected", unknown: "Status unknown" };
const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^\w-]/g, "");

function upload(form: FormData, key: string, onProgress: (p: number) => void): Promise<{ ok: boolean; message?: string }> {
  return new Promise(res => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/expenses"); x.setRequestHeader("Idempotency-Key", key);
    x.upload.onprogress = e => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    x.onload = () => { let m: string | undefined; try { m = JSON.parse(x.responseText)?.error?.message; } catch {} res({ ok: x.status >= 200 && x.status < 300, message: m ?? (x.status === 401 ? "Your session expired. Sign in again." : undefined) }); };
    x.onerror = () => res({ ok: false, message: "No connection. Check your internet and tap Submit Receipt again." });
    x.send(form);
  });
}

export default function Expenses() {
  const list = useApi<{ expenses: Exp[] }>("/api/expenses");
  const [cat, setCat] = useState<"fuel" | "parking">("fuel");
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState(""); const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false); const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null); const [done, setDone] = useState(false);
  const key = useRef(newKey()); // reused across retries so a repeat never duplicates the expense
  const pick = useRef<HTMLInputElement>(null);

  async function submit() {
    setErr(null); setDone(false);
    if (!file) return setErr("Attach a photo or PDF of the receipt.");
    if (!(Number(amount) > 0)) return setErr("Enter an amount greater than 0.");
    if (!vendor.trim()) return setErr(cat === "fuel" ? "Enter the station or vendor." : "Enter the parking location.");
    const f = new FormData(); f.set("category", cat); f.set("amount", amount); f.set("vendor", vendor); f.set("receipt", file);
    setBusy(true); setPct(0);
    const r = await upload(f, key.current, setPct); setBusy(false);
    if (!r.ok) return setErr(r.message ?? "Submission failed. Your entries are kept. Try again.");
    setDone(true); setFile(null); setAmount(""); setVendor(""); key.current = newKey(); list.reload();
  }
  const fuel = cat === "fuel";
  return (
    <Shell title="Submit Expense" subtitle="Upload fuel and parking receipts for reimbursement">
      <div className="qa" style={{ gridTemplateColumns: "1fr 1fr", marginBottom: 14 }} role="tablist">
        {(["fuel", "parking"] as const).map(c => (
          <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className="btn" style={{ background: cat === c ? "var(--orange)" : "#f3f4f6", color: cat === c ? "#fff" : "var(--mute)", boxShadow: "none", display: "flex", gap: 8, justifyContent: "center" }}>
            {c === "fuel" ? <Fuel size={18} /> : <CircleParking size={18} />}{c === "fuel" ? "Fuel" : "Parking"}
          </button>
        ))}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      {done && <div className="warn" style={{ background: "#f0fdf4", color: "#166534", borderColor: "#bbf7d0" }} role="status">Receipt submitted. It is now waiting for approval.</div>}
      <input ref={pick} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
      <button className="card empty" style={{ width: "100%", borderStyle: "dashed", borderWidth: 2 }} onClick={() => pick.current?.click()}>
        <Camera color="#f97316" size={28} />
        <b>{file ? file.name : "Tap to photograph receipt"}</b>{file ? `${(file.size / 1024).toFixed(0)} KB · tap to change` : "or choose a photo or PDF"}
      </button>
      <label className="field" style={{ marginTop: 14 }}>Amount (AED)<input inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="field">{fuel ? "Station / Vendor" : "Location / Vendor"}<input placeholder={fuel ? "e.g. ENOC Al Quoz" : "e.g. Dubai Mall Parking"} value={vendor} onChange={e => setVendor(e.target.value)} /></label>
      <button className="btn" disabled={busy} onClick={submit}>{busy ? (pct < 100 ? `Uploading… ${pct}%` : "Saving to the ERP…") : <><CheckCircle2 size={18} style={{ verticalAlign: -3 }} /> Submit Receipt</>}</button>
      <h2>Recent Receipts</h2>
      {list.error ? <div className="err">{list.error}</div> : !list.data?.expenses.length ? (
        <div className="card empty"><b>No receipts submitted yet</b>Your submitted receipts will appear here</div>
      ) : (
        <div className="hist">{list.data.expenses.map(e => (
          <div className="card row" key={e.id}><div><b>{e.category === "fuel" ? "Fuel" : e.category === "parking" ? "Parking" : "Expense"} · {e.vendor}</b><small>{fmtDate(e.date + "T12:00:00Z")} · {LABEL[e.status]}</small></div><b>AED {e.amount.toFixed(2)}</b></div>
        ))}</div>
      )}
    </Shell>
  );
}
