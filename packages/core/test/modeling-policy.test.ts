import { describe, expect, it } from 'vitest';
import { canExportModeling, modelingCapacity } from '../src/index.js';

describe('comercialização do Integra', () => {
  it('conta projectos activos independentemente do efectivo do RH', () => {
    const limits = { projectLimit: 3, extraUsers: 0 };
    expect(modelingCapacity(limits, 2, 1).canCreateProject).toBe(true);
    expect(modelingCapacity(limits, 3, 1).canCreateProject).toBe(false);
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
