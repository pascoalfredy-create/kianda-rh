import { describe, expect, it } from 'vitest';
import { cyclePrice, DEFAULT_TIERS, effectiveStatus, employeeLimit, kz, periodEnd, tierFor } from '../src/index.js';

describe('licenças', () => {
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
    expect(cyclePrice(t1, 'monthly')!.totalMinor).toBe(kz(99_999));
    expect(cyclePrice(t1, 'semiannual')!.totalMinor).toBe(kz(540_000));
    expect(cyclePrice(t1, 'annual')).toEqual({ grossMinor: kz(1_199_988), discountMinor: kz(239_998), totalMinor: kz(959_990) });
    expect(cyclePrice(DEFAULT_TIERS[3]!, 'annual')!.totalMinor).toBe(kz(3_648_000));
    expect(cyclePrice(DEFAULT_TIERS[4]!, 'monthly')!.totalMinor).toBe(kz(450_000));
  });
  it('reproduz todos os montantes comerciais aprovados para o RH', () => {
    const expected = [[99999, 540000, 959990], [200000, 1080000, 1920000], [280000, 1512000, 2688000], [380000, 2052000, 3648000], [450000, 2430000, 4320000]];
    DEFAULT_TIERS.forEach((tier, i) => expect((['monthly', 'semiannual', 'annual'] as const).map(c => cyclePrice(tier, c)!.totalMinor)).toEqual(expected[i]!.map(kz)));
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
  it('limite de colaboradores com extras', () => {
    expect(employeeLimit(DEFAULT_TIERS[0]!, 5)).toBe(105);
    expect(employeeLimit(DEFAULT_TIERS[4]!, 0)).toBeNull();
  });
});
