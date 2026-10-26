import { describe, expect, it } from 'vitest';
import { AO_2026, calculatePayroll, kz, payrollJournal, seniority, terminationProposal } from '../src/index.js';

const base = { pack: AO_2026, vacationUnusedDays: 0, holidaySubsidyPaidThisYear: true, christmasSubsidyPaidThisYear: true };
const code = (p: ReturnType<typeof terminationProposal>, c: string) => p.items.find((i) => i.code === c)?.amountMinor ?? 0;

describe('cessação do contrato', () => {
  it('antiguidade em anos, meses e dias (último dia inclusive)', () => {
    expect(seniority('2018-03-01', '2026-10-31')).toMatchObject({ years: 8, months: 8, days: 0 });
    expect(seniority('2026-01-15', '2026-03-14')).toMatchObject({ years: 0, months: 2, days: 0 });
  });

  it('despedimento por causas objectivas: compensação 5 anos × base + 50% nos restantes; aviso em falta pago', () => {
    const p = terminationProposal({ ...base, reason: 'objective_dismissal', hireDate: '2018-03-01', effectiveDate: '2026-10-31', noticeDate: '2026-10-15', baseMinor: kz(300_000), vacationUnusedDays: 10, holidaySubsidyPaidThisYear: false, christmasSubsidyPaidThisYear: false });
    expect(p.notice).toEqual({ requiredDays: 30, givenDays: 16, missingDays: 14, by: 'employer' });
    expect(code(p, 'COMP')).toBe(kz(1_950_000));
    expect(code(p, 'AVISO')).toBe(kz(140_000));
    expect(code(p, 'FERNG')).toBe(13_636_364);
    expect(code(p, 'FERPROP')).toBe(27_272_727);
    expect(code(p, 'SUBFERPROP')).toBe(13_636_364);
    expect(code(p, 'SUBFER')).toBe(kz(150_000));
    expect(code(p, 'SUBNAT')).toBe(Math.round(kz(150_000) * 304 / 365));
    expect(p.items.find((i) => i.code === 'COMP')).toMatchObject({ inInss: false, inIrt: false });
  });

  it('demissão sem aviso: desconta 30 dias; com aviso completo, nada', () => {
    const p = terminationProposal({ ...base, reason: 'resignation', hireDate: '2022-01-01', effectiveDate: '2026-10-31', noticeDate: null, baseMinor: kz(300_000) });
    expect(p.items.find((i) => i.code === 'AVISODESC')).toMatchObject({ kind: 'deduction', amountMinor: kz(300_000) });
    expect(code(p, 'COMP')).toBe(0);
    const ok = terminationProposal({ ...base, reason: 'resignation', hireDate: '2022-01-01', effectiveDate: '2026-10-31', noticeDate: '2026-10-01', baseMinor: kz(300_000) });
    expect(code(ok, 'AVISODESC')).toBe(0);
  });

  it('mútuo acordo: até à referência legal isento; o excesso tributado em IRT', () => {
    const p = terminationProposal({ ...base, reason: 'mutual_agreement', hireDate: '2023-06-01', effectiveDate: '2026-10-31', baseMinor: kz(400_000), agreedCompensationMinor: kz(1_500_000) });
    expect(p.items.find((i) => i.code === 'COMP')).toMatchObject({ amountMinor: kz(1_200_000), inIrt: false });
    expect(p.items.find((i) => i.code === 'COMPEXC')).toMatchObject({ amountMinor: kz(300_000), inIrt: true, inInss: false });
  });

  it('caducidade do contrato a termo sem aviso: 30 dias de compensação; período experimental sem compensação nem férias proporcionais', () => {
    const f = terminationProposal({ ...base, reason: 'fixed_term_expiry', hireDate: '2025-11-01', effectiveDate: '2026-10-31', baseMinor: kz(200_000) });
    expect(code(f, 'AVISO')).toBe(kz(200_000));
    const p = terminationProposal({ ...base, reason: 'probation', hireDate: '2026-09-01', effectiveDate: '2026-10-15', baseMinor: kz(200_000), holidaySubsidyPaidThisYear: false });
    expect(p.items.map((i) => i.code)).toEqual(['SUBFER']);
    expect(code(p, 'SUBFER')).toBe(Math.round(kz(100_000) * 2 / 22));
  });

  it('processamento do mês de saída: base proporcional aos dias, falta de aviso descontada, lançamento equilibrado', () => {
    const r = calculatePayroll({ period: '2026-10', baseMinor: kz(300_000), mealMinor: kz(30_000), workedDays: 15, noticeDeductionMinor: kz(50_000),
      otherEarnings: [{ code: 'COMP', name: 'Compensação', amountMinor: kz(600_000), inInss: false, inIrt: false }] });
    expect(r.lines.find((l) => l.code === 'BASE')).toMatchObject({ name: 'Vencimento base (15 dia(s))', amountMinor: kz(150_000) });
    expect(r.lines.find((l) => l.code === 'ALIM')?.amountMinor).toBe(kz(15_000));
    expect(r.inssBaseMinor).toBe(kz(150_000));
    expect(r.netMinor).toBe(r.grossMinor - r.inssEmployeeMinor - r.irtMinor - kz(50_000));
    const e = payrollJournal('2026-10', {
      byCostCenter: [{ costCenter: 'X', baseMinor: kz(150_000), allowancesMinor: kz(15_000), overtimeAndBonusMinor: 0, holidayChristmasMinor: 0, employerInssMinor: r.inssEmployerMinor, terminationMinor: kz(600_000) }],
      irtMinor: r.irtMinor, inssEmployeeMinor: r.inssEmployeeMinor, inssEmployerMinor: r.inssEmployerMinor, advancesMinor: 0, noticeIncomeMinor: kz(50_000), netMinor: r.netMinor,
    });
    expect(e.lines.find((l) => l.account === '72.8')?.debitMinor).toBe(kz(600_000));
    expect(e.lines.find((l) => l.account === '63')?.creditMinor).toBe(kz(50_000));
  });
});
