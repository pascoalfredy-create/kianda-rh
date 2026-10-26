import { describe, expect, it } from 'vitest';
import { accountLedger, accountMappingProblem, compareAccounts, trialBalance } from '../src/index.js';

const L = (date: string, account: string, d: number, c: number) => ({ date, account, debitMinor: d, creditMinor: c });
const lines = [
  L('2026-09-30', '72.2.1', 1000, 0), L('2026-09-30', '36.1.2', 0, 1000),
  L('2026-10-31', '72.2.1', 2000, 0), L('2026-10-31', '36.1.2', 0, 2000),
  L('2026-10-31', '36.1.2', 1000, 0), L('2026-10-31', '43.1', 0, 1000),
];

describe('balancete e razão', () => {
  it('saldo inicial, movimentos do período e saldo final; equilíbrio', () => {
    const tb = trialBalance(lines, '2026-10-01', '2026-10-31');
    expect(tb.rows.map((r) => [r.account, r.openingMinor, r.debitMinor, r.creditMinor, r.closingMinor])).toEqual([
      ['36.1.2', -1000, 1000, 2000, -2000], ['43.1', 0, 0, 1000, -1000], ['72.2.1', 1000, 2000, 0, 3000],
    ]);
    expect(tb.totals).toEqual({ debitMinor: 3000, creditMinor: 3000, balanced: true });
  });
  it('razão com saldo acumulado', () => {
    const r = accountLedger(lines, '36.1.2', '2026-10-01', '2026-10-31');
    expect(r.openingMinor).toBe(-1000);
    expect(r.movements.map((m) => m.balanceMinor)).toEqual([-3000, -2000]);
  });
  it('plano de contas: classe certa para cada função', () => {
    expect(accountMappingProblem('baseSalary', '72.2.1')).toBeNull();
    expect(accountMappingProblem('baseSalary', '62.1')).toMatch(/Classe 7/);
    expect(accountMappingProblem('bank', '43.1.2')).toBeNull();
    expect(accountMappingProblem('irtPayable', '34,3')).toMatch(/inválido/);
    expect(['72.2.10', '72.2.9', '36.1', '4'].sort(compareAccounts)).toEqual(['4', '36.1', '72.2.9', '72.2.10']);
  });
});
