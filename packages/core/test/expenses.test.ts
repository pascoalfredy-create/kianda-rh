import { describe, expect, it } from 'vitest';
import { claimProblems, claimTotals, expenseApprovalJournal, lineAmount } from '../src/index.js';

const today = '2026-10-26';
const rates = { national: 2_000_000, international: null };
const hotel = { kind: 'expense' as const, date: '2026-10-20', description: 'Hotel Lobito', category: 'lodging' as const, amountMinor: 4_500_000, documentRef: 'FT 2026/118' };
const diem = { kind: 'per_diem' as const, date: '2026-10-20', description: 'Deslocação ao Lobito', zone: 'national' as const, days: 2.5, rateMinor: 2_000_000 };

describe('notas de despesas', () => {
  it('ajudas de custo = dias × diária; totais por tipo', () => {
    expect(lineAmount(diem)).toBe(5_000_000);
    expect(claimTotals([hotel, diem])).toEqual({ expensesMinor: 4_500_000, perDiemMinor: 5_000_000, totalMinor: 9_500_000 });
  });
  it('valida documento, datas, meio dia e diária máxima da empresa', () => {
    expect(claimProblems([hotel, diem], { today, rates })).toEqual([]);
    expect(claimProblems([], { today, rates })).toEqual(['A nota não tem linhas']);
    const p = claimProblems([
      { ...hotel, documentRef: '' }, { ...hotel, date: '2026-11-01' }, { ...diem, days: 1.3 }, { ...diem, rateMinor: 2_500_000 }, { ...hotel, date: '2026-01-01' },
    ], { today, rates });
    expect(p).toEqual([
      'Linha 1: indique o n.º do recibo ou factura', 'Linha 2: data futura', 'Linha 3: dias em múltiplos de meio dia',
      'Linha 4: diária acima da fixada pela empresa', 'Linha 5: despesa com mais de 120 dias',
    ]);
  });
  it('lançamento da aprovação: classe 7 contra 36.9', () => {
    const e = expenseApprovalJournal('2026-10-26', 'ND-2026-0001', 'Lobito', [hotel, diem], 'LOG');
    expect(e.lines.map((l) => [l.account, l.debitMinor, l.creditMinor])).toEqual([['75.2', 4_500_000, 0], ['72.8', 5_000_000, 0], ['36.9', 0, 9_500_000]]);
  });
});
