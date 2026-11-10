import { luandaDate, sha256Hex } from '@kianda/core';
import { and, companies, gte, ne, siteVisits, sql, type Db } from '@kianda/db';

/** Robôs e pré-visualizações de links não contam como visitas. */
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|headless|lighthouse|pingdom|curl|wget|python|axios|node-fetch/i;

export interface VisitInput { path: string; referrer?: string | null; source?: string | null }

/** Caminho normalizado e curto: sem query, sem barra final, só caracteres de URL simples. */
export function normalisePath(p: string): string {
  const clean = (p.split(/[?#]/)[0] ?? '/').toLowerCase().replace(/\/+$/, '') || '/';
  return /^\/[a-z0-9\-/]{0,80}$/.test(clean) ? clean : '/';
}

/** Só o domínio de origem, e só se for de fora do Kianda. */
export function referrerHost(r: string | null | undefined, ownHost: string | null): string | null {
  if (!r) return null;
  try {
    const h = new URL(r).hostname.toLowerCase().replace(/^www\./, '').replace(/^(m|l|lm)\.facebook\.com$/, 'facebook.com');
    if (!h || (ownHost && h === ownHost.toLowerCase())) return null;
    return h.slice(0, 120);
  } catch { return null; }
}

export function deviceOf(ua: string): 'mobile' | 'desktop' {
  return /mobi|android|iphone|ipad|ipod/i.test(ua) ? 'mobile' : 'desktop';
}

/**
 * Regista uma visita. Sem cookies e sem guardar IP: o visitante é um hash de (dia, IP, navegador, segredo),
 * por isso a mesma pessoa conta uma vez por página e por dia, e não é possível segui-la de um dia para o outro.
 */
export async function recordVisit(db: Db, v: VisitInput, ctx: { ip: string; ua: string; country: string | null; ownHost: string | null; secret: string; now?: Date }) {
  if (!ctx.ua || BOT.test(ctx.ua)) return { counted: false as const };
  const day = luandaDate(ctx.now ?? new Date());
  const visitor = await sha256Hex(`${day}|${ctx.ip}|${ctx.ua}|${ctx.secret}`);
  const country = ctx.country && /^[A-Z]{2}$/.test(ctx.country) && ctx.country !== 'XX' ? ctx.country : null;
  const source = v.source ? v.source.toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, 40) || null : null;
  await db.insert(siteVisits).values({
    day, path: normalisePath(v.path), visitor, referrer: referrerHost(v.referrer, ctx.ownHost), source, country, device: deviceOf(ctx.ua),
  }).onConflictDoNothing();
  return { counted: true as const };
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Resumo para a consola da plataforma: visitas por dia, origens, países, páginas e o funil até à criação de conta. */
export async function visitsSummary(db: Db, days: number, now = new Date()) {
  const today = luandaDate(now), from = addDays(today, -(days - 1)), prevFrom = addDays(from, -days);
  const inRange = gte(siteVisits.day, from);
  const people = sql<number>`count(distinct (${siteVisits.day}, ${siteVisits.visitor}))::int`;
  const [daily, pages, refs, countries, devices, sources, [prev], signupRows] = await Promise.all([
    db.select({ day: siteVisits.day, visitors: sql<number>`count(distinct ${siteVisits.visitor})::int`, views: sql<number>`count(*)::int` }).from(siteVisits).where(inRange).groupBy(siteVisits.day),
    db.select({ key: siteVisits.path, n: people }).from(siteVisits).where(inRange).groupBy(siteVisits.path).orderBy(sql`2 desc`).limit(8),
    db.select({ key: siteVisits.referrer, n: people }).from(siteVisits).where(inRange).groupBy(siteVisits.referrer).orderBy(sql`2 desc`).limit(8),
    db.select({ key: siteVisits.country, n: people }).from(siteVisits).where(inRange).groupBy(siteVisits.country).orderBy(sql`2 desc`).limit(8),
    db.select({ key: siteVisits.device, n: people }).from(siteVisits).where(inRange).groupBy(siteVisits.device),
    db.select({ key: siteVisits.source, n: people }).from(siteVisits).where(and(inRange, sql`${siteVisits.source} is not null`)).groupBy(siteVisits.source).orderBy(sql`2 desc`).limit(8),
    db.select({ n: people }).from(siteVisits).where(and(gte(siteVisits.day, prevFrom), sql`${siteVisits.day} < ${from}`)),
    db.select({ day: sql<string>`(${companies.createdAt} at time zone 'Africa/Luanda')::date::text` }).from(companies)
      .where(and(ne(companies.nif, 'PLATAFORMA'), sql`(${companies.createdAt} at time zone 'Africa/Luanda')::date >= ${from}`)),
  ]);
  const byDay = new Map(daily.map(d => [String(d.day), d]));
  const signupsByDay = new Map<string, number>();
  for (const s of signupRows) signupsByDay.set(s.day, (signupsByDay.get(s.day) ?? 0) + 1);
  const series = Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i), d = byDay.get(day);
    return { day, visitors: d?.visitors ?? 0, views: d?.views ?? 0, signups: signupsByDay.get(day) ?? 0 };
  });
  const sum = (k: 'visitors' | 'views' | 'signups', n: number) => series.slice(-n).reduce((s, x) => s + x[k], 0);
  const visitors = sum('visitors', days), signups = sum('signups', days);
  return {
    days, from, to: today,
    totals: {
      today: series.at(-1)!.visitors, last7: sum('visitors', Math.min(7, days)), visitors, views: sum('views', days), previous: prev?.n ?? 0,
      signups, conversion: visitors ? Math.round((signups / visitors) * 1000) / 10 : null,
    },
    series,
    pages: pages.map(x => ({ key: x.key, n: x.n })),
    referrers: refs.map(x => ({ key: x.key ?? 'directo', n: x.n })),
    countries: countries.map(x => ({ key: x.key ?? 'desconhecido', n: x.n })),
    devices: devices.map(x => ({ key: x.key, n: x.n })),
    sources: sources.map(x => ({ key: x.key!, n: x.n })),
  };
}
