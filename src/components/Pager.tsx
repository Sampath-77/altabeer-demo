export default function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pager"><span>{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
    <button disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></div>;
}
