export function RhBars({ rows, money }: { rows: { name: string; value: number; label: string }[]; money?: boolean }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return rows.length ? <div className={`rh-bars ${money ? 'money' : ''}`}>{rows.map(r => <div className="rh-bar-row" key={r.name}><span>{r.name}</span><div className="rh-bar-track"><i style={{ width: `${Math.max(0, r.value / max * 100)}%` }} /></div><b>{r.label}</b></div>)}</div> : <div className="empty">Sem dados</div>;
}
