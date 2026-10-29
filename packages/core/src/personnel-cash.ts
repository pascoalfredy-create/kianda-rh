import { assertMinor } from './money.js';

export function personnelMonths(from: string, count = 6) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) throw new RangeError('Período inválido');
  const [year, month] = from.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => new Date(Date.UTC(year, month - 1 + i, 1)).toISOString().slice(0, 7));
}
export interface CashObligation { dueDate: string; amountMinor: number; kind: 'salaries' | 'irt' | 'inss' | 'expenses'; paid: boolean; estimated: boolean }
/** Caixa por datas de pagamento: não soma custos, não repete obrigações pagas; atrasados entram na primeira coluna. */
export function personnelCashFlow(input: { from: string; openingMinor: number; receipts: Record<string, number>; obligations: CashObligation[] }) {
  if (!Number.isSafeInteger(input.openingMinor)) throw new RangeError('Saldo inicial inválido');
  const periods = personnelMonths(input.from);
  let balance = input.openingMinor;
  const rows = periods.map(period => {
    const receiptsMinor = assertMinor(input.receipts[period] ?? 0, 'recebimentos');
    const due = input.obligations.filter(o => !o.paid && (o.dueDate.slice(0, 7) === period || period === periods[0] && o.dueDate.slice(0, 7) < period));
    const total = (kind: CashObligation['kind']) => due.filter(o => o.kind === kind).reduce((s, o) => s + assertMinor(o.amountMinor, 'obrigação'), 0);
    const openingMinor = balance, salariesMinor = total('salaries'), irtMinor = total('irt'), inssMinor = total('inss'), expensesMinor = total('expenses');
    balance += receiptsMinor - salariesMinor - irtMinor - inssMinor - expensesMinor;
    if (!Number.isSafeInteger(balance)) throw new RangeError('Saldo fora do limite suportado');
    return { period, openingMinor, receiptsMinor, salariesMinor, irtMinor, inssMinor, expensesMinor, closingMinor: balance, estimated: due.some(o => o.estimated), overdueMinor: due.filter(o => o.dueDate.slice(0, 7) < period).reduce((s, o) => s + o.amountMinor, 0) };
  });
  return { months: rows, minimumMinor: Math.min(...rows.map(r => r.closingMinor)), closingMinor: balance };
}
