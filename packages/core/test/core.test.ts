import { describe, expect, it } from 'vitest';
import {
  AO_2026, PackNotFoundError, businessDays, calculatePayroll, complianceAlerts, contractAlerts, finalSettlement,
  getPack, irtGroupA, isValidAngolanBI, isValidAngolanIban, kz, payrollDeadlines, payrollJournal, reconcile, solveBaseForNet,
} from '../src/index.js';
import { AO_2026 as PACK } from '../src/packs/ao-2026.js';

describe('IRT Grupo A 2026 (Lei 14/25)', () => {
  it('isenta até 150 000 Kz', () => {
    expect(irtGroupA(kz(150_000), PACK).amountMinor).toBe(0);
  });
  it('aplica parcela fixa no 2.º escalão', () => {
    expect(irtGroupA(kz(150_001), PACK)).toEqual({ amountMinor: kz(12_500.16), bracket: 2 });
  });
  it('calcula o 4.º escalão: 407 400 Kz → 69 656 Kz', () => {
    expect(irtGroupA(kz(407_400), PACK)).toEqual({ amountMinor: kz(69_656), bracket: 4 });
  });
  it('último escalão a 25%', () => {
    expect(irtGroupA(kz(12_000_000), PACK).amountMinor).toBe(kz(2_342_250 + 500_000));
  });
});

describe('processamento salarial', () => {
  it('trabalhadora com 420 000 Kz de base e subsídios isentos', () => {
    const r = calculatePayroll({ period: '2026-10', baseMinor: kz(420_000), mealMinor: kz(30_000), transportMinor: kz(25_000) });
    expect(r.grossMinor).toBe(kz(475_000));
    expect(r.inssEmployeeMinor).toBe(kz(12_600));
    expect(r.irtTaxableMinor).toBe(kz(407_400));
    expect(r.irtMinor).toBe(kz(69_656));
    expect(r.netMinor).toBe(kz(392_744));
    expect(r.inssEmployerMinor).toBe(kz(33_600));
    expect(r.packVersion).toBe('AO-2026.1');
  });
  it('tributa só o excesso dos subsídios acima de 30 000 Kz', () => {
    const r = calculatePayroll({ period: '2026-10', baseMinor: kz(1_850_000), mealMinor: kz(45_000), transportMinor: kz(40_000) });
    expect(r.irtTaxableMinor).toBe(kz(1_850_000 + 15_000 + 10_000 - 55_500));
  });
  it('subsídio de férias fora da base do INSS e de Natal dentro (parâmetros do pacote)', () => {
    const f = calculatePayroll({ period: '2026-06', baseMinor: kz(200_000), holidaySubsidy: true });
    expect(f.inssBaseMinor).toBe(kz(200_000));
    const n = calculatePayroll({ period: '2026-12', baseMinor: kz(200_000), christmasSubsidy: true });
    expect(n.inssBaseMinor).toBe(kz(300_000));
  });
  it('recusa um ano sem pacote publicado em vez de reutilizar o anterior', () => {
    expect(() => calculatePayroll({ period: '2027-01', baseMinor: kz(100_000) })).toThrow(PackNotFoundError);
    expect(() => getPack('AO', 2027)).toThrow(/2027/);
  });
  it('encontra o base para um líquido pretendido', () => {
    const r = solveBaseForNet(kz(392_744), { period: '2026-10', mealMinor: kz(30_000), transportMinor: kz(25_000) });
    expect(r.netMinor).toBeGreaterThanOrEqual(kz(392_744));
    expect(r.netMinor - kz(392_744)).toBeLessThan(100);
  });
  it('alerta salário abaixo do mínimo nacional', () => {
    expect(complianceAlerts({ baseMinor: kz(95_000) }, AO_2026)).toHaveLength(1);
    expect(complianceAlerts({ baseMinor: kz(95_000), internship: true }, AO_2026)).toHaveLength(0);
  });
});

describe('calendário laboral', () => {
  it('desconta fins-de-semana e o feriado de 2 de Novembro', () => {
    expect(businessDays('2026-10-26', '2026-11-06', [AO_2026])).toBe(9);
  });
  it('calcula os prazos de INSS e IRT', () => {
    expect(payrollDeadlines('2026-10', AO_2026)).toEqual({ inss: '2026-11-10', irt: '2026-11-30' });
  });
  it('alerta fim de contrato a termo e período experimental', () => {
    expect(contractAlerts({ startDate: '2025-11-10', endDate: '2026-11-09', type: 'fixed-term' }, '2026-10-26', AO_2026)[0]?.daysLeft).toBe(14);
    expect(contractAlerts({ startDate: '2026-10-01', type: 'indefinite' }, '2026-10-26', AO_2026)[0]?.kind).toBe('probation');
  });
});

describe('validações', () => {
  it('BI angolano', () => {
    expect(isValidAngolanBI('004512398LA041')).toBe(true);
    expect(isValidAngolanBI('4512398LA041')).toBe(false);
  });
  it('IBAN angolano com dígitos de controlo', () => {
    expect(isValidAngolanIban('AO06 0040 0000 5521 8890 1015 5')).toBe(true);
    expect(isValidAngolanIban('AO06 0040 0000 5521 8890 1015 6')).toBe(false);
  });
});

describe('cessação e PGC', () => {
  it('fecho de contas com proporcionais', () => {
    const s = finalSettlement({ terminationDate: '2026-11-30', baseMinor: kz(165_000), monthlyAllowancesMinor: kz(55_000), unusedVacationDays: 22, compensationMinor: kz(165_000) }, AO_2026);
    expect(s.lines.find((l) => l.code === 'SUBNAT')?.amountMinor).toBe(kz(75_625));
    expect(s.totalMinor).toBe(kz(220_000 + 165_000 + 75_625 + 75_625 + 165_000));
  });
  it('lançamento do processamento equilibrado (classe 7 contra 34 e 36)', () => {
    const r = calculatePayroll({ period: '2026-10', baseMinor: kz(420_000), mealMinor: kz(30_000), transportMinor: kz(25_000) });
    const e = payrollJournal('2026-10', {
      byCostCenter: [{ costCenter: 'Finanças', baseMinor: kz(420_000), allowancesMinor: kz(55_000), overtimeAndBonusMinor: 0, holidayChristmasMinor: 0, employerInssMinor: r.inssEmployerMinor }],
      irtMinor: r.irtMinor, inssEmployeeMinor: r.inssEmployeeMinor, inssEmployerMinor: r.inssEmployerMinor, advancesMinor: 0, netMinor: r.netMinor,
    });
    const d = e.lines.reduce((a, l) => a + l.debitMinor, 0);
    const c = e.lines.reduce((a, l) => a + l.creditMinor, 0);
    expect(d).toBe(c);
    expect(e.lines.every((l) => l.debitMinor === 0 || l.account.startsWith('72'))).toBe(true);
  });
});

describe('conciliação bancária', () => {
  it('distingue o IRT de Setembro do de Agosto pelo período no descritivo', () => {
    const obligations = [
      { key: 'irt:2026-08', kind: 'irt' as const, label: 'IRT Agosto', amountMinor: kz(2_580_263.91), dueDate: '2026-09-30', period: '2026-08', keywords: ['AGT', 'IRT'] },
      { key: 'irt:2026-09', kind: 'irt' as const, label: 'IRT Setembro', amountMinor: kz(2_580_263.91), dueDate: '2026-10-31', period: '2026-09', keywords: ['AGT', 'IRT'] },
    ];
    const [m] = reconcile([{ id: 'l1', date: '2026-10-23', description: 'PAG IMPOSTOS AGT IRT GRUPO A 09/2026', amountMinor: -kz(2_580_263.91) }], obligations);
    expect(m).toMatchObject({ obligationKey: 'irt:2026-09', status: 'matched' });
  });
  it('sem palavras-chave fica como sugestão', () => {
    const [m] = reconcile([{ id: 'l2', date: '2026-10-20', description: 'TRF ORDEM 0055 000778812', amountMinor: -kz(48_500) }],
      [{ key: 'exp:1', kind: 'expense', label: 'Reembolso', amountMinor: kz(48_500), dueDate: '2026-10-09', keywords: ['REEMB', 'TAVARES'] }]);
    expect(m?.status).toBe('suggested');
  });
});
