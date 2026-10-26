import { describe, expect, it } from 'vitest';
import { AO_2026, csvMoney, kz, payrollObligations, toCsv } from '../src/index.js';

describe('obrigações do processamento', () => {
  const base = { period: '2026-10', pack: AO_2026, netMinor: kz(3_351_844.5), irtMinor: kz(697_355.5), inssEmployeeMinor: kz(115_800), inssEmployerMinor: kz(308_800) };
  it('prazos: salários a 31/10, INSS a 10/11, IRT a 30/11', () => {
    const o = payrollObligations({ ...base, paid: {}, today: '2026-11-05' });
    expect(o.map((x) => [x.kind, x.dueDate, x.status])).toEqual([
      ['salaries', '2026-10-31', 'overdue'], ['inss', '2026-11-10', 'due_soon'], ['irt', '2026-11-30', 'open'],
    ]);
    expect(o[1]!.amountMinor).toBe(kz(424_600));
  });
  it('pago é pago, mesmo depois do prazo', () => {
    const o = payrollObligations({ ...base, paid: { salaries: '2026-10-30' }, today: '2026-12-01' });
    expect(o[0]!.status).toBe('paid');
    expect(o[2]!.status).toBe('overdue');
  });
  it('CSV para Excel em português', () => {
    expect(csvMoney(kz(1234.5))).toBe('1234,50');
    expect(csvMoney(-5)).toBe('-0,05');
    const c = toCsv(['Nome', 'Valor'], [['Ana; "Zé"', csvMoney(100)]]);
    expect(c).toBe('﻿Nome;Valor\r\n"Ana; ""Zé""";1,00\r\n');
  });
});
