import { describe, expect, it } from 'vitest';
import { buildOrgTree, compensationAt, compensationHistory, createsCycle, documentAlerts, kz } from '../src/index.js';

const changes = [
  { effectiveDate: '2023-01-16', baseMinor: kz(300_000), mealMinor: kz(30_000), transportMinor: kz(25_000), reason: 'admissão' },
  { effectiveDate: '2025-01-01', baseMinor: kz(360_000), mealMinor: kz(30_000), transportMinor: kz(25_000), reason: 'actualização anual' },
  { effectiveDate: '2026-12-01', baseMinor: kz(400_000), mealMinor: kz(30_000), transportMinor: kz(25_000), reason: 'promoção' },
];

describe('remuneração em vigor', () => {
  it('escolhe a última alteração com efeito até à data', () => {
    expect(compensationAt(changes, '2026-10-31')?.baseMinor).toBe(kz(360_000));
    expect(compensationAt(changes, '2026-12-31')?.baseMinor).toBe(kz(400_000));
    expect(compensationAt(changes, '2026-12-01')?.baseMinor).toBe(kz(400_000));
  });
  it('não há remuneração antes da admissão', () => {
    expect(compensationAt(changes, '2022-12-31')).toBeNull();
  });
  it('histórico calcula a variação face à anterior', () => {
    const h = compensationHistory([...changes].reverse());
    expect(h.map((x) => x.changeBps)).toEqual([null, 2000, 1111]);
  });
});

describe('documentos', () => {
  it('alerta para caducados e a caducar, ordenados por urgência', () => {
    const a = documentAlerts([
      { id: 'a', type: 'bi', number: '004512398LA041', expiryDate: '2026-12-01' },
      { id: 'b', type: 'driving_licence', number: 'LD-1', expiryDate: '2026-10-01' },
      { id: 'c', type: 'passport', number: 'N123', expiryDate: '2030-01-01' },
      { id: 'd', type: 'other', number: 'x' },
    ], '2026-10-26');
    expect(a.map((x) => [x.documentId, x.kind])).toEqual([['b', 'expired'], ['a', 'expiring']]);
    expect(a[0]!.message).toBe('Carta de Condução: caducou há 25 dia(s)');
  });
});

describe('hierarquia', () => {
  const nodes = [
    { id: 'ceo', managerId: null, name: 'A' },
    { id: 'cfo', managerId: 'ceo', name: 'B' },
    { id: 'acc', managerId: 'cfo', name: 'C' },
    { id: 'hr', managerId: 'ceo', name: 'D' },
  ];
  it('detecta ciclos', () => {
    expect(createsCycle(nodes, 'ceo', 'acc')).toBe(true);
    expect(createsCycle(nodes, 'cfo', 'cfo')).toBe(true);
    expect(createsCycle(nodes, 'acc', 'hr')).toBe(false);
    expect(createsCycle(nodes, 'acc', null)).toBe(false);
  });
  it('constrói a árvore com chefias desconhecidas como raiz', () => {
    const t = buildOrgTree([...nodes, { id: 'x', managerId: 'outra-empresa', name: 'E' }], (n) => n.name);
    expect(t.map((n) => n.id)).toEqual(['ceo', 'x']);
    expect(t[0]!.reports.map((n) => n.id)).toEqual(['cfo', 'hr']);
    expect(t[0]!.reports[0]!.reports[0]!.id).toBe('acc');
  });
});
