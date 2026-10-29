import { describe, expect, it } from 'vitest';
import { personnelCashFlow, personnelMonths, type CashObligation } from '../src/personnel-cash.js';

describe('tesouraria de pessoal por datas de pagamento', () => {
  const debt = (kind: CashObligation['kind'], dueDate: string, amountMinor: number, paid = false): CashObligation => ({ kind, dueDate, amountMinor, paid, estimated: false });
  it('atravessa o ano e mantém seis meses consecutivos', () => {
    expect(personnelMonths('2026-10')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    expect(() => personnelMonths('2026-13')).toThrow();
  });
  it('leva os impostos ao mês do vencimento e transporta os saldos', () => {
    const r = personnelCashFlow({ from: '2026-10', openingMinor: 100000, receipts: { '2026-11': 30000 }, obligations: [debt('salaries', '2026-10-31', 80000), debt('inss', '2026-11-10', 10000), debt('irt', '2026-11-30', 5000)] });
    expect(r.months[0]).toMatchObject({ salariesMinor: 80000, inssMinor: 0, irtMinor: 0, closingMinor: 20000 });
    expect(r.months[1]).toMatchObject({ openingMinor: 20000, receiptsMinor: 30000, closingMinor: 35000 });
    expect(r.months[2]!.openingMinor).toBe(35000);
    expect(r.closingMinor).toBe(35000);
  });
  it('não repete o que já foi pago; atrasados por pagar entram só no primeiro mês', () => {
    const r = personnelCashFlow({ from: '2026-10', openingMinor: 100, receipts: {}, obligations: [debt('salaries', '2026-08-31', 1000, true), debt('irt', '2026-09-30', 40), debt('expenses', '2026-10-01', 80), debt('inss', '2027-04-10', 900)] });
    expect(r.months[0]).toMatchObject({ overdueMinor: 40, salariesMinor: 0, expensesMinor: 80, closingMinor: -20 });
    expect(r.months.slice(1).every(m => m.overdueMinor === 0 && m.closingMinor === -20)).toBe(true);
    expect(r.minimumMinor).toBe(-20);
  });
  it('assinala meses com estimativas e mantém uma empresa sem pessoal em saldo constante', () => {
    const empty = personnelCashFlow({ from: '2026-12', openingMinor: -123, receipts: {}, obligations: [] });
    expect(empty.months.every(m => m.closingMinor === -123 && !m.estimated)).toBe(true);
    const estimated = personnelCashFlow({ from: '2026-12', openingMinor: 0, receipts: {}, obligations: [{ ...debt('salaries', '2027-01-31', 5), estimated: true }] });
    expect(estimated.months[0]!.estimated).toBe(false); expect(estimated.months[1]!.estimated).toBe(true);
  });
  it('recusa fracções de cêntimo e saldos que excedem inteiros seguros', () => {
    expect(() => personnelCashFlow({ from: '2026-10', openingMinor: 1.5, receipts: {}, obligations: [] })).toThrow();
    expect(() => personnelCashFlow({ from: '2026-10', openingMinor: Number.MAX_SAFE_INTEGER, receipts: { '2026-10': 1 }, obligations: [] })).toThrow();
  });
});
