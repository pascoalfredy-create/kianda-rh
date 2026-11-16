import { describe, expect, it } from 'vitest';
import { absenceEffectivenessCode, effectivenessDayCode, effectivenessTotals } from '../src/index.js';

const day = (date: string, kind: 'workday' | 'rest' | 'holiday' | 'absence' | 'inactive', workedMinutes = 0) => ({
  date,
  kind,
  workedMinutes,
});
const clock = { today: '2026-11-16', clockInUse: true };
const noClock = { today: '2026-11-16', clockInUse: false };

describe('mapa de efectividade', () => {
  it('ausências aprovadas: cada tipo no seu código', () => {
    expect(absenceEffectivenessCode('vacation')).toBe('Fé');
    expect(absenceEffectivenessCode('sick')).toBe('D');
    expect(absenceEffectivenessCode('unjustified')).toBe('FI');
    for (const t of ['justified', 'marriage', 'bereavement', 'training'])
      expect(absenceEffectivenessCode(t)).toBe('FJ');
    for (const t of ['maternity', 'paternity', 'unpaid_leave']) expect(absenceEffectivenessCode(t)).toBe('L');
  });
  it('dias úteis: presença com marcação; sem marcação «SR» com ponto, presença presumida sem ponto', () => {
    expect(effectivenessDayCode(day('2026-11-10', 'workday', 480), undefined, clock)).toBe('P');
    expect(effectivenessDayCode(day('2026-11-10', 'workday'), undefined, clock)).toBe('SR');
    expect(effectivenessDayCode(day('2026-11-10', 'workday'), undefined, noClock)).toBe('P');
    expect(effectivenessDayCode(day('2026-11-16', 'workday'), undefined, clock)).toBe('');
    expect(effectivenessDayCode(day('2026-11-17', 'workday'), undefined, noClock)).toBe('');
  });
  it('descanso, feriados, ausências e fora do contrato', () => {
    expect(effectivenessDayCode(day('2026-11-14', 'rest'), undefined, clock)).toBe('·');
    expect(effectivenessDayCode(day('2026-11-14', 'rest', 240), undefined, clock)).toBe('P');
    expect(effectivenessDayCode(day('2026-11-11', 'holiday'), undefined, clock)).toBe('Fr');
    expect(effectivenessDayCode(day('2026-11-11', 'holiday', 300), undefined, clock)).toBe('P');
    expect(effectivenessDayCode(day('2026-11-12', 'absence', 60), 'unjustified', clock)).toBe('FI');
    expect(effectivenessDayCode(day('2026-11-03', 'inactive', 60), undefined, clock)).toBe('');
  });
  it('totais por código', () => {
    expect(effectivenessTotals(['P', 'P', 'FI', 'FJ', 'Fé', 'Fé', 'D', 'L', 'Fr', '·', 'SR', ''])).toEqual({
      worked: 2,
      unjustified: 1,
      justified: 1,
      vacation: 2,
      sick: 1,
      leave: 1,
      noRecord: 1,
    });
  });
});
