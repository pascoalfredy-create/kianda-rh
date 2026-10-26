/**
 * Feriados nacionais de Angola gerados para qualquer ano: datas fixas + Carnaval e Sexta-feira Santa (móveis, a partir da Páscoa).
 * Permite planear férias e ausências de anos cujo pacote fiscal (OGE) ainda não foi publicado.
 * Pontes e alterações pontuais decretadas devem ser acrescentadas no pacote do ano (ver toValidate).
 */
import type { Holiday } from './packs/types.js';

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export function angolaHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: Holiday[] = [
    { date: `${year}-01-01`, name: 'Dia do Ano Novo' },
    { date: `${year}-02-04`, name: 'Dia do Início da Luta Armada' },
    { date: shift(easter, -47), name: 'Carnaval' },
    { date: `${year}-03-08`, name: 'Dia Internacional da Mulher' },
    { date: `${year}-03-23`, name: 'Dia da Libertação da África Austral' },
    { date: shift(easter, -2), name: 'Sexta-feira Santa' },
    { date: `${year}-04-04`, name: 'Dia da Paz e Reconciliação' },
    { date: `${year}-05-01`, name: 'Dia Internacional do Trabalhador' },
    { date: `${year}-09-17`, name: 'Dia do Fundador da Nação e do Herói Nacional' },
    { date: `${year}-11-02`, name: 'Dia dos Finados' },
    { date: `${year}-11-11`, name: 'Dia da Independência Nacional' },
    { date: `${year}-12-25`, name: 'Dia de Natal e da Família' },
  ];
  return list.sort((x, y) => x.date.localeCompare(y.date));
}
