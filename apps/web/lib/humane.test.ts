import { describe, expect, it } from 'vitest';
import { dateRange, daysBetween, greeting, joinPt, longDate, luandaNow, nextWorkingDay, plural, relativeDay, shortDate } from './humane';

describe('texto à medida de pessoas', () => {
  it('saúda pela hora de Luanda', () => {
    expect(luandaNow(new Date('2026-11-03T23:30:00Z'))).toMatchObject({ date: '2026-11-04', hour: 0 });
    expect([greeting(8), greeting(13), greeting(20)]).toEqual(['Bom dia', 'Boa tarde', 'Boa noite']);
  });
  it('datas por extenso, curtas e relativas', () => {
    expect(longDate('2026-11-03')).toBe('terça, 3 de Novembro');
    expect(longDate('2027-01-01', '2026-11-03')).toBe('sexta, 1 de Janeiro de 2027');
    expect(shortDate('2026-12-10')).toBe('10 de Dez.');
    expect(daysBetween('2026-11-03', '2026-12-10')).toBe(37);
    expect(['2026-11-03', '2026-11-04', '2026-11-06', '2026-11-20', '2026-11-01'].map(d => relativeDay(d, '2026-11-03'))).toEqual(['hoje', 'amanhã', 'sexta', 'daqui a 17 dias', 'há 2 dias']);
    expect(dateRange('2026-11-16', '2026-11-20')).toBe('de segunda 16 a sexta 20 de Novembro');
    expect(dateRange('2026-11-30', '2026-12-04')).toBe('de segunda 30 de Novembro a sexta 4 de Dezembro');
    expect(dateRange('2026-11-11', '2026-11-11')).toBe('quarta, 11 de Novembro');
  });
  it('dia de regresso salta fins-de-semana e feriados; plurais e listas', () => {
    expect(nextWorkingDay('2026-11-13')).toBe('2026-11-16');
    expect(nextWorkingDay('2026-11-10', new Set(['2026-11-11']))).toBe('2026-11-12');
    expect([plural(1, 'pedido', 'pedidos'), plural(3, 'pedido', 'pedidos'), plural(0, 'pedido', 'pedidos', 'nenhum pedido')]).toEqual(['um pedido', '3 pedidos', 'nenhum pedido']);
    expect(joinPt(['a', 'b', 'c'])).toBe('a, b e c');
    expect(joinPt(['a'])).toBe('a');
  });
});
