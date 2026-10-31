import Nav from "./Nav";
export default function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="app"><header className="hdr"><h1>{title}</h1><p>{subtitle}</p></header><main>{children}</main><Nav /></div>;
}
