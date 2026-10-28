import { describe, expect, it } from 'vitest';
import { canExportModeling, defaultModelingSector, FINANCIAL_SECTORS, MODELING_PLANS, modelingCapacity, modelingPlanPrice, modelingSectorSelection, kz } from '../src/index.js';

describe('comercialização do Integra', () => {
  it('conta projectos activos independentemente do efectivo do RH', () => {
    const limits = { projectLimit: 3, extraUsers: 0 };
    expect(modelingCapacity(limits, 2, 1).canCreateProject).toBe(true);
    expect(modelingCapacity(limits, 3, 1).canCreateProject).toBe(false);
  });
  it('plano ilimitado não substitui o limite de cinco utilizadores', () => {
    expect(modelingCapacity({ projectLimit: null, extraUsers: 0 }, 100001, 5)).toMatchObject({ projectLimit: null, canCreateProject: true, userLimit: 5, canAddUser: false });
  });
  it('reproduz os preços base publicados, incluindo a indisponibilidade mensal do ilimitado', () => {
    const expected = [[300000, 1620000, 2880000], [600000, 3240000, 5760000], [1200000, 6480000, 11520000], [null, 8100000, 14400000]];
    MODELING_PLANS.forEach((plan, i) => expect((['monthly', 'semiannual', 'annual'] as const).map(c => modelingPlanPrice(plan.key, c)?.totalMinor ?? null)).toEqual(expected[i]!.map(n => n === null ? null : kz(n))));
  });
  it('cobra apenas os lugares extra contratados, por cada mês do ciclo', () => {
    expect(modelingPlanPrice('pme', 'monthly', 2)).toMatchObject({ totalMinor: kz(370000), extraMinor: kz(70000) });
    expect(modelingPlanPrice('corporate', 'semiannual', 2)).toMatchObject({ totalMinor: kz(3660000), extraMinor: kz(420000), discountMinor: kz(360000) });
    expect(modelingPlanPrice('unlimited', 'annual', 1)).toMatchObject({ totalMinor: kz(14820000), extraMinor: kz(420000) });
    for (const n of [-1, 1.5, 100001]) expect(() => modelingPlanPrice('pme', 'monthly', n)).toThrow();
  });
  it('PME e Corporate escolhem sectores independentemente do número de projectos', () => {
    expect(modelingSectorSelection('pme', 'mineracao', ['servicos', 'mineracao'])).toEqual(['mineracao', 'servicos']);
    expect(modelingSectorSelection('corporate', 'mineracao', ['mineracao', 'servicos', 'comercio', 'agro'])).toHaveLength(4);
    for (const selected of [['mineracao'], ['mineracao', 'servicos', 'agro'], ['mineracao', 'mineracao'], ['servicos', 'agro'], ['mineracao', 'inexistente']]) expect(() => modelingSectorSelection('pme', 'mineracao', selected)).toThrow();
    expect(() => modelingSectorSelection('corporate', 'mineracao', FINANCIAL_SECTORS)).toThrow();
  });
  it('ambos os planos Grandes Empresas incluem todos os oito sectores', () => {
    for (const plan of ['enterprise10', 'unlimited']) expect(modelingSectorSelection(plan, 'mineracao', FINANCIAL_SECTORS)).toEqual(FINANCIAL_SECTORS);
    expect(defaultModelingSector('mining')).toBe('mineracao');
    expect(defaultModelingSector('telecom')).toBe('tecnologia');
    expect(defaultModelingSector('other')).toBe('servicos');
  });
  it('inclui no máximo cinco acessos; extras só quando contratados', () => {
    expect(modelingCapacity({ projectLimit: 1, extraUsers: 0 }, 0, 4).canAddUser).toBe(true);
    expect(modelingCapacity({ projectLimit: 1, extraUsers: 0 }, 0, 5).canAddUser).toBe(false);
    expect(modelingCapacity({ projectLimit: 1, extraUsers: 2 }, 0, 6).canAddUser).toBe(true);
    expect(modelingCapacity({ projectLimit: 1, extraUsers: 2 }, 0, 7).canAddUser).toBe(false);
  });
  it('recusa limites negativos, fraccionados e sem projectos', () => {
    for (const projectLimit of [-1, 0, 1.5]) expect(() => modelingCapacity({ projectLimit, extraUsers: 0 }, 0, 0)).toThrow();
    expect(() => modelingCapacity({ projectLimit: 1, extraUsers: -1 }, 0, 0)).toThrow();
  });
  it('clientes só exportam PDF, incluindo proprietários de empresas e outros administradores', () => {
    expect(canExportModeling('pdf', 'client', 'pascoal', false)).toBe(true);
    for (const format of ['xlsx', 'xls', 'csv', 'json', 'html']) expect(canExportModeling(format, 'client', 'pascoal', true)).toBe(false);
    expect(canExportModeling('xlsx', 'pascoal', undefined, true)).toBe(false);
    expect(canExportModeling('xlsx', 'pascoal', 'pascoal', false)).toBe(false);
    expect(canExportModeling('xlsx', 'pascoal', 'pascoal', true)).toBe(true);
  });
});
