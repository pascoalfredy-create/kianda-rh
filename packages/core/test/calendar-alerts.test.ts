import { describe, expect, it } from 'vitest';
import { contractAlerts, getPack } from '../src/index.js';

describe('alertas de contrato (LGT, arts. 17.º e 18.º)', () => {
  const pack = getPack('AO', 2026);
  it('termo: prazo do aviso de não renovação, e prazo já ultrapassado', () => {
    expect(contractAlerts({ startDate: '2026-01-01', endDate: '2026-12-31', type: 'fixed-term' }, '2026-11-09', pack)[0]!.message).toBe('Contrato termina em 52 dia(s): se não for renovar, avise até 01/12/2026 (30 dias)');
    expect(contractAlerts({ startDate: '2026-01-01', endDate: '2026-11-30', type: 'fixed-term' }, '2026-11-09', pack)[0]!.message).toContain('já passou o prazo do aviso');
  });
  it('período experimental também nos contratos a termo (30 dias)', () => {
    expect(contractAlerts({ startDate: '2026-11-01', endDate: '2027-10-31', type: 'fixed-term' }, '2026-11-09', pack)).toEqual([expect.objectContaining({ kind: 'probation', daysLeft: 22 })]);
  });
});

import { vacationEntitlement } from '../src/index.js';
describe('férias (LGT, arts. 204.º e 205.º)', () => {
  const pack = getPack('AO', 2026);
  it('sem termo: 22 dias; ano da admissão 2/mês com mínimo 6', () => {
    expect(vacationEntitlement('2024-03-01', 2026, pack)).toBe(22);
    expect(vacationEntitlement('2026-10-15', 2026, pack)).toBe(6);
    expect(vacationEntitlement('2026-03-01', 2026, pack)).toBe(20);
  });
  it('termo até 1 ano: 2 dias por mês completo no ano, sem mínimo, mesmo depois do ano da admissão', () => {
    expect(vacationEntitlement('2025-06-01', 2026, pack, { type: 'fixed_term', startDate: '2026-06-01', endDate: '2027-05-31' })).toBe(14);
    expect(vacationEntitlement('2026-10-01', 2026, pack, { type: 'fixed_term', startDate: '2026-10-01', endDate: '2027-03-31' })).toBe(6);
    expect(vacationEntitlement('2024-01-01', 2026, pack, { type: 'fixed_term', startDate: '2024-01-01', endDate: '2026-12-31' })).toBe(22);
  });
});

describe('férias com licença sem remuneração (arts. 204.º, n.º 3, e 216.º)', () => {
  const pack = getPack('AO', 2026);
  it('até 30 dias conta como trabalho; acima disso 2 dias por mês completo, mínimo 6', () => {
    expect(vacationEntitlement('2024-01-01', 2026, pack, null, [{ startDate: '2026-03-01', endDate: '2026-03-30' }])).toBe(22);
    expect(vacationEntitlement('2024-01-01', 2026, pack, null, [{ startDate: '2026-03-01', endDate: '2026-04-30' }])).toBe(20);
    expect(vacationEntitlement('2024-01-01', 2026, pack, null, [{ startDate: '2026-02-15', endDate: '2026-11-15' }])).toBe(6);
  });
});
