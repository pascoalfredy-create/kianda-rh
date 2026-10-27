import { luandaDate } from '@kianda/core';
import {
  accessLinks, and, auditLogs, candidateEvents, candidates, documentRequests, employeeDocuments, employees, eq, getDb, profileChangeRequests, users,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { exportCompany } from '../services/privacy.js';

/**
 * Protecção de dados (Lei n.º 22/11): exportação completa da empresa, minimização dos dados de ex-colaboradores
 * e eliminação de candidatos. A eliminação de uma empresa inteira é feita pela consola da plataforma.
 */
export function privacyRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/company/export', '/v1/privacy/*']) app.use(p, requireCompany);

  /** Portabilidade: todos os dados da empresa num ficheiro JSON (sem segredos de acesso). Só o proprietário. */
  app.get('/v1/company/export', requireRole(), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const data = await exportCompany(db, actor.companyId);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'export', entity: 'company', entityId: actor.companyId, after: { counts: data.counts } });
    return new Response(JSON.stringify(data, null, 1), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="kianda-export-${luandaDate(new Date())}.json"` },
    });
  });

  /**
   * Ex-colaborador: elimina os dados pessoais que a lei não obriga a conservar (contactos, morada, IBAN, contacto de
   * emergência, documentos digitalizados, pedidos do portal, acesso). Ficam nome, n.º, BI, NIF, n.º INSS, contratos,
   * processamentos e lançamentos — necessários para as obrigações fiscais, de segurança social e contabilísticas.
   */
  app.post('/v1/privacy/employees/:id/minimize', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ confirm: z.string().trim() }).parse(await body(c));
    const db = getDb();
    const [e] = await db.select().from(employees).where(and(eq(employees.id, c.req.param('id')), eq(employees.companyId, actor.companyId)));
    if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
    if (e.status !== 'terminated') throw new DomainError('nao_cessado', 'Só é possível eliminar dados de ex-colaboradores (contrato cessado)');
    if (e.dataMinimizedAt) throw new DomainError('ja_eliminado', 'Os dados deste ex-colaborador já foram eliminados');
    if (b.confirm !== e.number) throw new DomainError('confirmacao', `Para confirmar, escreva o n.º do colaborador (${e.number})`, 422);
    const now = new Date();
    await db.update(employees).set({
      email: null, phone: null, address: null, iban: null, bank: null, birthDate: null, maritalStatus: null, gender: null, nationality: null,
      emergencyContactName: null, emergencyContactPhone: null, dataMinimizedAt: now, updatedAt: now,
    }).where(eq(employees.id, e.id));
    const docs = await db.delete(employeeDocuments).where(eq(employeeDocuments.employeeId, e.id)).returning({ id: employeeDocuments.id });
    await db.delete(profileChangeRequests).where(eq(profileChangeRequests.employeeId, e.id));
    await db.delete(documentRequests).where(eq(documentRequests.employeeId, e.id));
    await db.delete(accessLinks).where(eq(accessLinks.employeeId, e.id));
    // O utilizador fica como registo histórico (autor de acções), sem forma de entrar nem contactos.
    await db.update(users).set({ email: null, phone: null, pinHash: null, passwordHash: '!', totpSecret: null, totpEnabledAt: null, disabledAt: now })
      .where(and(eq(users.companyId, actor.companyId), eq(users.employeeId, e.id)));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'minimize_personal_data', entity: 'employee', entityId: e.id, after: { documentsDeleted: docs.length } });
    return c.json({ ok: true, kept: ['nome', 'n.º', 'BI', 'NIF', 'n.º INSS', 'contratos', 'processamentos', 'lançamentos'] });
  });

  /** Candidato: eliminação total (sem obrigação legal de conservar), excepto se já foi contratado. */
  app.delete('/v1/privacy/candidates/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [cand] = await db.select().from(candidates).where(and(eq(candidates.id, c.req.param('id')), eq(candidates.companyId, actor.companyId)));
    if (!cand) throw new DomainError('nao_encontrado', 'Candidato inexistente', 404);
    if (cand.employeeId) throw new DomainError('contratado', 'O candidato foi contratado: os dados estão na ficha do colaborador');
    await db.delete(candidateEvents).where(eq(candidateEvents.candidateId, cand.id));
    await db.delete(candidates).where(eq(candidates.id, cand.id));
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'delete_candidate', entity: 'candidate', entityId: cand.id });
    return c.json({ ok: true });
  });

  return app;
}
