import { describe, expect, it } from 'vitest';
import { moduleAccess, moduleForPath, type ModuleGrant } from '../src/index.js';

describe('módulos independentes', () => {
  const grant: ModuleGrant = { enabled: true, status: 'active', trialEndsAt: null, paidUntil: '2026-10-31' };
  it('Modelagem não é concedida sem adesão ou com o módulo desligado', () => {
    expect(moduleAccess(null, '2026-10-28').canRead).toBe(false);
    expect(moduleAccess({ ...grant, enabled: false }, '2026-10-28').canWrite).toBe(false);
  });
  it('preserva consulta e expira escrita depois da tolerância', () => {
    expect(moduleAccess(grant, '2026-10-28')).toMatchObject({ canRead: true, canWrite: true });
    expect(moduleAccess(grant, '2026-11-07').canWrite).toBe(true);
    expect(moduleAccess(grant, '2026-11-08')).toMatchObject({ canRead: true, canWrite: false });
  });
  it('cancelamento e suspensão prevalecem sobre a data paga', () => {
    for (const status of ['suspended', 'cancelled'] as const) expect(moduleAccess({ ...grant, status }, '2026-10-28').canWrite).toBe(false);
  });
  it('experimental exige prazo e expira sem tolerância adicional', () => {
    expect(moduleAccess({ ...grant, status: 'trial', paidUntil: null }, '2026-10-28').canWrite).toBe(false);
    expect(moduleAccess({ ...grant, status: 'trial', paidUntil: null, trialEndsAt: '2026-10-28' }, '2026-10-28').canWrite).toBe(true);
  });
  it('separa Modelagem, domínios RH e serviços comuns com limites exactos', () => {
    for (const path of ['/v1/modeling', '/v1/modeling/models/123']) expect(moduleForPath(path)).toBe('modeling');
    for (const path of ['/v1/payroll-runs', '/v1/payslips', '/v1/reviews', '/v1/sector', '/v1/files', '/v1/billing-extra', '/v1/modeling-extra', '/v1/access-extra']) expect(moduleForPath(path)).toBe('hr');
    for (const path of ['/v1/auth/me', '/v1/users', '/v1/access', '/v1/access/invites', '/v1/modules', '/v1/company/settings', '/v1/company/logo', '/v1/platform/companies', '/v1/billing']) expect(moduleForPath(path)).toBeNull();
  });
});
