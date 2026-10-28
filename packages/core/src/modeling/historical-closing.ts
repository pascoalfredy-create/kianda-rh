import type { HistoricalAccount } from './historical.js';
import { FinancialModelError } from './types.js';

export const CLOSING_INCOME_KEYS = ['vendas', 'prest', 'oProv', 'cev', 'pes', 'amort', 'oCus', 'pFin', 'cFin', 'pNop', 'cNop', 'pExt', 'cExt', 'imp'] as const;
type IncomeKey = typeof CLOSING_INCOME_KEYS[number];
/** Desenvolvimento decimal PGC, incluindo zeros de apresentação usados por alguns ERP (82.07). */
function suffix(code: string) { return code.replace(/\D/g, '').slice(2).replace(/^0+/, ''); }
function add(a: number,b: number) { const value=a+b;if(!Number.isSafeInteger(value))throw new FinancialModelError([{path:'balancete',message:'Montante fora do intervalo seguro.'}]);return value; }
/** 82.19 é irmã de 82.1 (transferência / vendas), apesar do prefixo compacto comum. */
export function historicalAccountDescends(child: string,parent: string): boolean {
  if(child===parent||!child.startsWith(parent))return false;
  if(parent.startsWith('82')&&suffix(parent)==='1'&&suffix(child).startsWith('19'))return false;
  return true;
}
export function isClosingTransfer(line: HistoricalAccount): boolean {
  const tail = suffix(line.code);
  return line.g === '82' ? tail.startsWith('19') : ['83', '84', '85', '86', '87', '88'].includes(line.g) && tail.startsWith('9');
}
export function historicalClosingIncome(lines: HistoricalAccount[]) {
  const amounts = Object.fromEntries(CLOSING_INCOME_KEYS.map(k => [k, 0])) as Record<IncomeKey, number>;
  const unknown: string[] = [];
  for (const line of lines) {
    if (!['82', '83', '84', '85', '86', '87'].includes(line.g) || line.v === 0 || isClosingTransfer(line)) continue;
    const tail = suffix(line.code); let key: IncomeKey | undefined, sign = 1;
    if (line.g === '82') {
      key = ({ '1': 'vendas', '2': 'prest', '3': 'oProv', '4': 'oProv', '5': 'oProv', '6': 'cev', '7': 'pes', '8': 'amort', '9': 'oCus' } as Record<string, IncomeKey>)[tail[0] || ''];
      if (tail[0] && Number(tail[0]) <= 5) sign = -1;
    } else if (['83', '84', '85', '86'].includes(line.g)) {
      const pair = line.g === '83' || line.g === '84' ? ['pFin', 'cFin'] : line.g === '85' ? ['pNop', 'cNop'] : ['pExt', 'cExt'];
      if (tail.startsWith('1')) { key = pair[0] as IncomeKey; sign = -1; }
      if (tail.startsWith('2')) key = pair[1] as IncomeKey;
    } else if (line.g === '87' && (tail === '' || /^[12]/.test(tail))) key = 'imp';
    if (key) amounts[key] = add(amounts[key],Math.round(line.v * 100) * sign);
    else unknown.push(line.code);
  }
  const incomeBalance = -lines.filter(l => /^[67]/.test(l.g) || ['82', '83', '84', '85', '86', '87', '88'].includes(l.g)).reduce((sum, l) => add(sum,Math.round(l.v * 100)), 0);
  const retainedTransfer = lines.filter(l => l.g === '88' && isClosingTransfer(l)).reduce((sum, l) => add(sum,Math.round(l.v * 100)), 0);
  return { amounts, unknown, incomeBalance, retainedTransfer, active: lines.some(l => ['82', '83', '84', '85', '86', '88'].includes(l.g) && l.v !== 0) };
}
