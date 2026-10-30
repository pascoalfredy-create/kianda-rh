import { describe, expect, it } from 'vitest';
import { canExportDocuments, cyclePrice, DEFAULT_TIERS, effectiveStatus, employeeLimit, kz, periodEnd, tierFor, trialEndDate, trialDaysRemaining } from '../src/index.js';

describe('licenças', () => {
  it('a avaliação tem sete datas de calendário, incluindo registo e último dia, mesmo ao mudar de mês/ano', () => {
    expect(trialEndDate('2026-10-30')).toBe('2026-11-05');
    expect(trialEndDate('2026-12-29')).toBe('2027-01-04');
    expect(trialEndDate('2028-02-26')).toBe('2028-03-03');
    const until = trialEndDate('2026-10-30');
    expect(trialDaysRemaining(until, '2026-10-30')).toBe(7);
    expect(trialDaysRemaining(until, '2026-11-05')).toBe(1);
    expect(trialDaysRemaining(until, '2026-11-06')).toBe(0);
    expect(effectiveStatus({ status: 'trial', trialEndsAt: until, paidUntil: null }, '2026-11-05')).toBe('trial');
    expect(effectiveStatus({ status: 'trial', trialEndsAt: until, paidUntil: null }, '2026-11-06')).toBe('suspended');
  });
  it('recusa datas inválidas em vez de transferir silenciosamente a avaliação para outro mês', () => {
    for (const day of ['2026-02-30', '2026-2-01', '2026-10-30T10:00:00Z', 'invalid']) expect(() => trialEndDate(day)).toThrow(RangeError);
    expect(() => trialDaysRemaining('2026-11-05', '2026-02-30')).toThrow(RangeError);
  });
  it('escalão pelo número de colaboradores', () => {
    expect(tierFor(0).key).toBe('t1');
    expect(tierFor(100).key).toBe('t1');
    expect(tierFor(101).key).toBe('t2');
    expect(tierFor(1000).key).toBe('t4');
    expect(tierFor(1001).key).toBe('t5');
    expect(tierFor(2000).key).toBe('t5');
  });
  it('preço por ciclo com desconto, arredondado ao kwanza', () => {
    const t1 = DEFAULT_TIERS[0]!;
    expect(cyclePrice(t1, 'monthly')!.totalMinor).toBe(kz(29_900));
    expect(cyclePrice(t1, 'semiannual')!.totalMinor).toBe(kz(161_460));
    expect(cyclePrice(t1, 'annual')).toEqual({ grossMinor: kz(358_800), discountMinor: kz(53_820), totalMinor: kz(304_980) });
    expect(cyclePrice(DEFAULT_TIERS[3]!, 'annual')!.totalMinor).toBe(kz(916_980));
    expect(cyclePrice(DEFAULT_TIERS[4]!, 'monthly')!.totalMinor).toBe(kz(99_999));
  });
  it('reproduz todos os montantes comerciais aprovados para o RH', () => {
    const expected = [[29900, 161460, 304980], [49900, 269460, 508980], [69900, 377460, 712980], [89900, 485460, 916980], [99999, 539995, 1019990]];
    DEFAULT_TIERS.forEach((tier, i) => expect((['monthly', 'semiannual', 'annual'] as const).map(c => cyclePrice(tier, c)!.totalMinor)).toEqual(expected[i]!.map(kz)));
  });
  it('a avaliação permite trabalhar mas só uma licença paga ou em tolerância permite exportar documentos', () => {
    for (const status of ['trial', 'suspended', 'cancelled'] as const) expect(canExportDocuments(status)).toBe(false);
    for (const status of ['active', 'past_due'] as const) expect(canExportDocuments(status)).toBe(true);
  });
  it('fim do período', () => {
    expect(periodEnd('2026-01-15', 1)).toBe('2026-02-14');
    expect(periodEnd('2026-01-31', 1)).toBe('2026-02-27');
    expect(periodEnd('2026-11-01', 12)).toBe('2027-10-31');
  });
  it('estado efectivo: experimental, activa, tolerância e só leitura', () => {
    const s = { status: 'trial' as const, trialEndsAt: '2026-11-25', paidUntil: null };
    expect(effectiveStatus(s, '2026-11-20')).toBe('trial');
    expect(effectiveStatus(s, '2026-11-26')).toBe('suspended');
    const p = { status: 'active' as const, trialEndsAt: '2026-11-25', paidUntil: '2026-12-31' };
    expect(effectiveStatus(p, '2026-12-31')).toBe('active');
    expect(effectiveStatus(p, '2027-01-05')).toBe('past_due');
    expect(effectiveStatus(p, '2027-01-09')).toBe('suspended');
    expect(effectiveStatus({ ...p, status: 'suspended' }, '2026-12-01')).toBe('suspended');
  });
  it('limite de colaboradores corresponde apenas à faixa contratada', () => {
    expect(DEFAULT_TIERS.map(employeeLimit)).toEqual([100, 250, 500, 1000, null]);
  });
});
