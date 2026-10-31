"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Clock, Receipt, AlertTriangle, Wallet, ClipboardList } from "lucide-react";

const items = [["/", "Home", Home], ["/shifts", "Shifts", Clock], ["/daily-report", "Report", ClipboardList], ["/expenses", "Expenses", Receipt], ["/payslip", "Payslip", Wallet]] as const;
export default function Nav() {
  const p = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {items.map(([href, label, Icon]) => (
        <Link key={href} href={href} aria-current={p === href ? "page" : undefined}><Icon size={22} />{label}</Link>
      ))}
    </nav>
  );
}
