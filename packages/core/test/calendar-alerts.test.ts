import { describe, expect, it } from 'vitest';
import { contractAlerts, getPack } from '../src/index.js';

describe('alertas de contrato (LGT, arts. 17.º e 18.º)', () => {
  const pack = getPack('AO', 2026);
  it('termo: prazo do aviso de não renovação, e prazo já ultrapassado', () => {
    expect(contractAlerts({ startDate: '2026-01-01', endDate: '2026-12-31', type: 'fixed-term' }, '2026-11-09', pack)[0]!.message).toBe('Contrato termina em 52 dia(s): se não for renovar, avise até 01/12/2026 (30 dias, art. 17.º da LGT)');
    expect(contractAlerts({ startDate: '2026-01-01', endDate: '2026-11-30', type: 'fixed-term' }, '2026-11-09', pack)[0]!.message).toContain('já passou o prazo do aviso');
  });
  it('período experimental também nos contratos a termo (30 dias)', () => {
    expect(contractAlerts({ startDate: '2026-11-01', endDate: '2027-10-31', type: 'fixed-term' }, '2026-11-09', pack)).toEqual([expect.objectContaining({ kind: 'probation', daysLeft: 22 })]);
  });
});
