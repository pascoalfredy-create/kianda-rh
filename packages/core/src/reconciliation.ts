import type { Minor } from './money.js';

export interface BankLine { id: string; date: string; description: string; amountMinor: Minor }

export interface Obligation {
  key: string;
  kind: 'salaries' | 'irt' | 'inss' | 'advance' | 'expense';
  label: string;
  amountMinor: Minor;
  dueDate: string;
  /** Período de referência AAAA-MM (quando aplicável). */
  period?: string;
  keywords: string[];
}

export interface MatchResult { lineId: string; obligationKey: string | null; score: number; status: 'matched' | 'suggested' | 'unmatched' }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** Pontuação: valor exacto (obrigatório) + palavras-chave + referência ao período + proximidade do prazo. */
export function scoreMatch(line: BankLine, o: Obligation, toleranceMinor = 100): number {
  if (line.amountMinor >= 0) return 0;
  if (Math.abs(Math.abs(line.amountMinor) - o.amountMinor) > toleranceMinor) return 0;
  const d = norm(line.description);
  let s = 50;
  if (o.keywords.some((k) => d.includes(norm(k)))) s += 40;
  if (o.period) {
    const [y, m] = o.period.split('-') as [string, string];
    const refs = [`${m}/${y}`, `${m}-${y}`, `${m}/${y.slice(2)}`];
    if (refs.some((r) => d.includes(r))) s += 30;
    else if (/\b(0[1-9]|1[0-2])[/-](20)?\d{2}\b/.test(d)) s -= 30;
  }
  const days = Math.abs((Date.parse(line.date) - Date.parse(o.dueDate)) / 86_400_000);
  return s - Math.min(9, days / 30);
}

/** Associa cada movimento a débito à melhor obrigação ainda livre. ≥85 automático; ≥40 sugestão. */
export function reconcile(lines: BankLine[], obligations: Obligation[]): MatchResult[] {
  const used = new Set<string>();
  return lines.map((l) => {
    let best: Obligation | null = null;
    let bs = 0;
    for (const o of obligations) {
      if (used.has(o.key)) continue;
      const s = scoreMatch(l, o);
      if (s > bs) { bs = s; best = o; }
    }
    if (best && bs >= 85) { used.add(best.key); return { lineId: l.id, obligationKey: best.key, score: bs, status: 'matched' as const }; }
    if (best && bs >= 40) return { lineId: l.id, obligationKey: best.key, score: bs, status: 'suggested' as const };
    return { lineId: l.id, obligationKey: null, score: 0, status: 'unmatched' as const };
  });
}
