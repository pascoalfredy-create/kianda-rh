'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Me } from '@/lib/api';
import { navActive, navigation, type NavItem } from '@/lib/navigation';
import { ROLE_LABEL, type EmployeeRow } from '@/lib/types';
import { LogoutButton } from '@/app/(app)/logout-button';
import { ClockCard } from './clock-card';
import { RhIcon } from './rh-icon';

export function AppShell({ me, counts, children }: { me: Me; counts: { absences: number; expenses: number }; children: React.ReactNode }) {
  const path = usePathname();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState(false);
  const groups = navigation(me, counts);
  const activeGroup = groups.find(g => g.items.some(item => navActive(item.href, path, new URLSearchParams(search.toString()))))?.label ?? groups[0]?.label ?? '';
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => ({ [activeGroup]: true }));
  const side = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); setNotices(false); }, [path, search]);
  useEffect(() => { setExpanded(previous => previous[activeGroup] ? previous : { ...previous, [activeGroup]: true }); }, [activeGroup]);
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    side.current?.querySelector<HTMLButtonElement>('.nav-group-toggle')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); toggle.current?.focus(); }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(side.current?.querySelectorAll<HTMLElement>('a,button') ?? []).filter(node => node.getClientRects().length > 0);
      if (!nodes?.length) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = before; document.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="app rh-app">
    {open && <button className="side-shade" aria-label="Fechar menu" onClick={() => { setOpen(false); toggle.current?.focus(); }} />}
    <aside ref={side} id="rh-side" className={`side ${open ? 'side-open' : ''}`} aria-label="Navegação principal">
      <div className="logo"><div className="mark">K</div><div><b>Kianda RH</b><small>Gestão de Pessoas · Angola</small></div></div>
      <div className="company-card"><small>Empresa</small><b>{me.company?.name ?? '—'}</b><small>NIF {me.company?.nif ?? '—'}</small></div>
      <nav>{groups.map((g, index) => <div key={g.label} className="nav-group">
        <button className="nav-group-toggle" aria-expanded={!!expanded[g.label]} aria-controls={`rh-nav-${index}`} onClick={() => setExpanded(previous => ({ ...previous, [g.label]: !previous[g.label] }))}>
          <span>{g.label}</span><span className="nav-chevron" aria-hidden="true">⌄</span>
        </button>
        <div id={`rh-nav-${index}`} hidden={!expanded[g.label]}>{g.items.map(item => <NavigationItem key={item.href} item={item} active={navActive(item.href, path, new URLSearchParams(search.toString()))} onNavigate={() => setOpen(false)} />)}</div>
      </div>)}</nav>
      <div className="who"><b>{me.user.name}</b><small>{ROLE_LABEL[me.user.role] ?? me.user.role}</small><Link href="/conta">A minha conta</Link><LogoutButton /></div>
      <div className="side-foot">LGT (Lei 12/23) · IRT, OGE 2026 (Lei 14/25) · INSS<br />Kianda RH</div>
    </aside>
    <div className="rh-main">
      <header className="rh-top no-print">
        <button ref={toggle} className="mobile-menu" aria-label={open ? 'Fechar menu' : 'Abrir menu'} aria-expanded={open} aria-controls="rh-side" onClick={() => setOpen(!open)}>☰</button>
        {me.modules.hr.canAccess && me.user.role !== 'employee' ? <EmployeeSearch pathname={path} /> : <span className="top-company">{me.company?.name}</span>}
        <div className="top-clock">{me.modules.hr.canAccess && me.user.employeeId ? <ClockCard inline /> : <LuandaClock />}</div>
        <span className="top-role">{ROLE_LABEL[me.user.role]}</span>
        <div className="top-notices"><button className="notice-button" aria-label="Notificações" aria-expanded={notices} onClick={() => setNotices(!notices)}><RhIcon name="bell" size={19} />{counts.absences + counts.expenses > 0 && <i />}</button>
          {notices && <div className="notice-popover"><b>Pedidos por tratar</b>{counts.absences > 0 && <Link href="/ausencias">{counts.absences} pedido(s) de ausência</Link>}{counts.expenses > 0 && <Link href="/despesas?v=approve">{counts.expenses} nota(s) de despesas</Link>}{!counts.absences && !counts.expenses && <span className="muted">Sem pedidos pendentes.</span>}</div>}
        </div>
      </header>
      <main id="conteudo" className="content">{children}</main>
    </div>
  </div>;
}

function NavigationItem({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const [intent, setIntent] = useState(false);
  const content = <><RhIcon name={item.icon} /><span>{item.label}</span>{!!item.badge && <span className="nav-count">{item.badge}</span>}{item.locked && <span className="nav-lock" title="Sem acesso"><RhIcon name="lock" size={12} /><span className="sr-only">Sem acesso</span></span>}</>;
  const shared = { onClick: onNavigate, className: `${active ? 'nav-on' : ''} ${item.locked ? 'nav-locked' : ''}`, 'aria-current': active ? 'page' as const : undefined };
  // O Integra é um documento independente, pelo que não deve receber pedidos RSC do Next.
  return item.href === '/modelagem' ? <a href={item.href} {...shared}>{content}</a>
    : <Link href={item.href} prefetch={intent} onMouseEnter={() => setIntent(true)} onFocus={() => setIntent(true)} onTouchStart={() => setIntent(true)} {...shared}>{content}</Link>;
}

function LuandaClock() {
  const [now, setNow] = useState('');
  useEffect(() => { const tick = () => setNow(new Date().toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Luanda' })); tick(); const t = setInterval(tick, 60_000); return () => clearInterval(t); }, []);
  return <time className="luanda-clock">{now}<small>Luanda</small></time>;
}

function EmployeeSearch({ pathname }: { pathname: string }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setQuery(''); }, [pathname]);
  useEffect(() => {
    if (query.trim().length < 2) { setRows([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true); setError('');
      try {
        const response = await fetch('/api/v1/employees', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível pesquisar.');
        setRows(await response.json() as EmployeeRow[]);
      } catch (e) { if (!controller.signal.aborted) { setRows([]); setError((e as Error).message); } }
      finally { if (!controller.signal.aborted) setBusy(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query]);
  const term = query.trim().toLocaleLowerCase('pt-PT');
  const found = rows.filter(e => [e.name, e.number, e.nif ?? '', e.jobTitle, e.department ?? ''].some(x => x.toLocaleLowerCase('pt-PT').includes(term))).slice(0, 7);
  return <div className="rh-search"><RhIcon name="search" size={18} /><input aria-label="Pesquisar colaboradores" placeholder="Pesquisar colaboradores, NIF, cargo…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
    {term.length >= 2 && <div className="search-results">{busy ? <span className="muted">A pesquisar…</span> : error ? <span role="alert">{error}</span> : found.length ? found.map(e => <Link key={e.id} href={`/colaboradores/${e.id}`} onClick={() => setQuery('')}><b>{e.name}</b><small>{e.number} · {e.jobTitle}</small></Link>) : <span className="muted">Sem resultados</span>}</div>}
  </div>;
}
