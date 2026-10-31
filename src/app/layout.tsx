import "./globals.css";
import type { Viewport } from "next";
export const metadata = { title: "Al Tabeer Driver" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1a2748" };
export default function Root({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
