import ExcelJS from "exceljs";
import type { Table, Cell } from "./reports";

const sanitize = (v: Cell): string | number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
};

export async function tableToXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Al Tabeer Admin";
  wb.created = new Date();

  const ws = wb.addWorksheet(t.title.slice(0, 31));
  ws.columns = t.columns.map(c => ({ header: c.label, width: Math.max(c.label.length + 4, 16) }));
  const hdr = ws.getRow(1);
  hdr.eachCell(cell => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  hdr.height = 24;
  ws.views = [{ state: "frozen", ySplit: 1 }];

  t.rows.forEach(r => ws.addRow(t.columns.map(c => sanitize(r[c.key] ?? null))));

  if (t.summary) {
    ws.addRow([]);
    ws.addRow(["Summary"]).font = { bold: true };
    Object.entries(t.summary).forEach(([k, v]) => ws.addRow([k, sanitize(v)]));
  }
  if (t.note) {
    ws.addRow([]);
    ws.addRow(["Note:", t.note]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
