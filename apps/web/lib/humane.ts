/**
 * Texto à medida de pessoas: saudações pela hora de Luanda, datas por extenso e relativas, plurais.
 * Funções puras (sem fuso do servidor): as datas chegam em AAAA-MM-DD já em hora de Luanda.
 */
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SHORT = ['Jan.', 'Fev.', 'Mar.', 'Abr.', 'Maio', 'Jun.', 'Jul.', 'Ago.', 'Set.', 'Out.', 'Nov.', 'Dez.'];
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const DAY = 86_400_000;
const parse = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Data e hora de Luanda agora: { date: AAAA-MM-DD, hour }. */
export function luandaNow(now = new Date()) {
  const l = new Date(now.getTime() + 3_600_000);
  return { date: l.toISOString().slice(0, 10), hour: l.getUTCHours(), time: l.toISOString().slice(11, 16) };
}
export const greeting = (hour: number) => (hour < 12 ? 'Bom dia' : hour < 19 ? 'Boa tarde' : 'Boa noite');
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const monthName = (period: string) => MONTHS[Number(period.slice(5, 7)) - 1]!;
export const weekday = (d: string) => WEEKDAYS[parse(d).getUTCDay()]!;

/** «terça, 3 de Novembro» (ano só quando não é o corrente). */
export function longDate(d: string, today?: string) {
  const x = parse(d);
  const year = today && today.slice(0, 4) !== d.slice(0, 4) ? ` de ${x.getUTCFullYear()}` : '';
  return `${weekday(d)}, ${x.getUTCDate()} de ${MONTHS[x.getUTCMonth()]}${year}`;
}
/** «16 de Nov.» */
export const shortDate = (d: string) => { const x = parse(d); return `${x.getUTCDate()} de ${SHORT[x.getUTCMonth()]}`; };
export const daysBetween = (from: string, to: string) => Math.round((parse(to).getTime() - parse(from).getTime()) / DAY);

/** «hoje», «amanhã», «sexta», «daqui a 12 dias», «ontem», «há 3 dias». */
export function relativeDay(d: string, today: string) {
  const n = daysBetween(today, d);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  if (n > 1 && n < 7) return weekday(d);
  return n > 0 ? `daqui a ${n} dias` : `há ${-n} dias`;
}

/** Intervalo por extenso: «de segunda 16 a sexta 20 de Novembro», «a 3 de Dezembro» quando muda o mês. */
export function dateRange(from: string, to: string) {
  const a = parse(from), b = parse(to);
  if (from === to) return `${weekday(from)}, ${a.getUTCDate()} de ${MONTHS[a.getUTCMonth()]}`;
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  return `de ${weekday(from)} ${a.getUTCDate()}${sameMonth ? '' : ` de ${MONTHS[a.getUTCMonth()]}`} a ${weekday(to)} ${b.getUTCDate()} de ${MONTHS[b.getUTCMonth()]}`;
}

/** Próximo dia útil depois de uma data (fins-de-semana e feriados excluídos): o dia de regresso. */
export function nextWorkingDay(d: string, holidays: ReadonlySet<string> = new Set()) {
  let x = parse(d).getTime() + DAY;
  for (let i = 0; i < 14; i++, x += DAY) {
    const iso = new Date(x).toISOString().slice(0, 10), w = new Date(x).getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(iso)) return iso;
  }
  return new Date(x).toISOString().slice(0, 10);
}

/** «1 pedido», «3 pedidos», «nenhum pedido». */
export const plural = (n: number, one: string, many: string, zero?: string) => (n === 0 && zero ? zero : `${n === 1 ? 'um' : n} ${n === 1 ? one : many}`);
export const capitalise = cap;
/** Junta frases curtas: «A, B e C». */
export function joinPt(parts: string[]) {
  const p = parts.filter(Boolean);
  return p.length <= 1 ? (p[0] ?? '') : `${p.slice(0, -1).join(', ')} e ${p.at(-1)}`;
}
