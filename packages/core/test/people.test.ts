import { describe, expect, it } from 'vitest';
import { buildOrgTree, compensationAt, compensationHistory, compensationChangeBps, createsCycle, documentAlerts, kz } from '../src/index.js';

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
  it('salário em USD compara dólares, sem tratar o câmbio de referência como aumento', () => {
    const usd = { ...changes[0]!, salaryCurrency: 'USD', baseForeignMinor: kz(3000) };
    expect(compensationChangeBps(usd, { ...usd, baseMinor: usd.baseMinor * 2 })).toBe(0);
    expect(compensationChangeBps(usd, { ...usd, baseMinor: usd.baseMinor * 2, baseForeignMinor: kz(3300) })).toBe(1000);
    expect(compensationHistory([usd, { ...usd, effectiveDate: '2026-12-01', baseMinor: usd.baseMinor * 2 }])[1]!.changeBps).toBe(0);
  });
  it('não apresenta uma percentagem enganadora ao mudar de moeda ou sem base comparável', () => {
    expect(compensationChangeBps(changes[0]!, { ...changes[1]!, salaryCurrency: 'USD', baseForeignMinor: kz(3000) })).toBeNull();
    expect(compensationChangeBps({ baseMinor: 0 }, { baseMinor: 20000000 })).toBeNull();
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
