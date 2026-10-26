import {
  BUILTIN_TEMPLATES, compensationAt, DOCUMENT_FIELDS, formatKz, kzInWords, longDatePt, luandaDate, packOrLatest, renderTemplate, unknownFields,
} from '@kianda/core';
import {
  and, asc, auditLogs, companies, compensationChanges, contracts, departments, desc, documentTemplates, employees, eq, getDb, issuedDocuments, like,
  payrollLines, payrollRuns, sql, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';

const STAFF = ['owner', 'hr_admin', 'payroll', 'finance'];
const CONTRACT_TYPE: Record<string, string> = {
  indefinite: 'contrato de trabalho por tempo indeterminado', fixed_term: 'contrato de trabalho por tempo determinado', internship: 'contrato de estágio',
};

/** Modelos da empresa: os do Kianda (versão do pacote) com a última versão activa adaptada por cima. */
export async function templatesFor(db: Db, companyId: string) {
  const pack = packOrLatest('AO', Number(luandaDate(new Date()).slice(0, 4)));
  const custom = await db.select().from(documentTemplates).where(and(eq(documentTemplates.companyId, companyId), eq(documentTemplates.active, true))).orderBy(desc(documentTemplates.version));
  return BUILTIN_TEMPLATES.map((t) => {
    const c = custom.find((x) => x.key === t.key);
    return c
      ? { ...t, title: c.title, body: c.body, source: 'empresa' as const, version: `Empresa v${c.version}`, basedOn: c.basedOn, kiandaVersion: pack.version }
      : { ...t, source: 'kianda' as const, version: pack.version, basedOn: null, kiandaVersion: pack.version };
  });
}

/** Valores dos campos para um colaborador, hoje. */
async function fieldData(db: Db, companyId: string, employeeId: string) {
  const [row] = await db.select({ e: employees, dept: departments.name }).from(employees).leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employees.id, employeeId), eq(employees.companyId, companyId)));
  if (!row) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  const { e } = row;
  const [co] = await db.select().from(companies).where(eq(companies.id, companyId));
  const today = luandaDate(new Date());
  const cs = await db.select().from(contracts).where(eq(contracts.employeeId, e.id)).orderBy(asc(contracts.startDate));
  const current = [...cs].reverse().find((c) => c.startDate <= today) ?? cs[cs.length - 1];
  const changes = await db.select().from(compensationChanges).where(eq(compensationChanges.employeeId, e.id));
  const change = compensationAt(changes, today);
  const pay = change ?? current;
  const lines = await db.select({ net: payrollLines.netMinor, period: payrollRuns.period }).from(payrollLines).innerJoin(payrollRuns, eq(payrollRuns.id, payrollLines.runId))
    .where(and(eq(payrollLines.employeeId, e.id), eq(payrollRuns.status, 'closed'))).orderBy(desc(payrollRuns.period)).limit(3);
  const pack = packOrLatest('AO', Number(today.slice(0, 4)));
  const city = co?.address?.split(',').map((x) => x.trim()).filter(Boolean).at(-1) ?? 'Luanda';
  const total = pay ? pay.baseMinor + pay.mealMinor + pay.transportMinor : 0;
  const d = (v?: string | null) => (v ? longDatePt(v) : null);
  const data: Record<string, string | null> = {
    'empresa.nome': co?.name ?? null, 'empresa.nif': co?.nif ?? null, 'empresa.morada': co?.address ?? null, 'empresa.cidade': city,
    'empresa.jornada_horas': co ? String(co.workdayMinutes / 60).replace('.', ',') : null,
    'colaborador.nome': e.name, 'colaborador.numero': e.number, 'colaborador.bi': e.biNumber, 'colaborador.nif': e.nif, 'colaborador.inss': e.inssNumber,
    'colaborador.funcao': e.jobTitle, 'colaborador.departamento': row.dept, 'colaborador.morada': e.address, 'colaborador.nacionalidade': e.nationality,
    'colaborador.data_nascimento': d(e.birthDate),
    'contrato.tipo': current ? CONTRACT_TYPE[current.type] ?? current.type : null, 'contrato.admissao': d(cs[0]?.startDate), 'contrato.inicio': d(current?.startDate),
    'contrato.fim': d(current?.endDate), 'contrato.fundamento': current?.termJustification ?? null, 'contrato.cessacao': d(current?.terminatedAt),
    'remuneracao.base': pay ? formatKz(pay.baseMinor) : null, 'remuneracao.base_extenso': pay ? kzInWords(pay.baseMinor) : null,
    'remuneracao.alimentacao': pay?.mealMinor ? formatKz(pay.mealMinor) : null, 'remuneracao.transporte': pay?.transportMinor ? formatKz(pay.transportMinor) : null,
    'remuneracao.total': pay ? formatKz(total) : null, 'remuneracao.total_extenso': pay ? kzInWords(total) : null,
    'remuneracao.desde': d(change?.effectiveDate ?? current?.startDate),
    'rendimentos.liquido_medio_3m': lines.length ? formatKz(Math.round(lines.reduce((s, l) => s + l.net, 0) / lines.length)) : null,
    'rendimentos.meses': lines.length ? lines.map((l) => `${l.period.slice(5)}/${l.period.slice(0, 4)}`).reverse().join(', ') : null,
    'pacote.periodo_experimental': String(pack.labour.probationDaysIndefinite), 'pacote.periodo_experimental_termo': String(pack.labour.probationDaysFixedTerm),
    'pacote.dias_ferias': String(pack.labour.vacationWorkingDays), 'pacote.horas_semanais': String(pack.labour.weeklyHours), 'pacote.versao': pack.version,
    'data.hoje': longDatePt(today),
  };
  return { data, employee: e };
}

const inputsBody = z.record(z.string().regex(/^pedido\.\w+$/), z.string().trim().max(300)).default({});

async function compose(db: Db, companyId: string, employeeId: string, templateKey: string, inputs: Record<string, string>) {
  const t = (await templatesFor(db, companyId)).find((x) => x.key === templateKey);
  if (!t) throw new DomainError('nao_encontrado', 'Modelo inexistente', 404);
  const { data, employee } = await fieldData(db, companyId, employeeId);
  const r = renderTemplate(t.body, { ...data, ...inputs });
  const labels = new Map([...DOCUMENT_FIELDS.map((f) => [f.key, f.label] as const), ...t.inputs.map((i) => [i.key, i.label] as const)]);
  const requiredMissing = t.inputs.filter((i) => i.required && !inputs[i.key]?.trim()).map((i) => i.key);
  const missing = [...new Set([...r.missing, ...requiredMissing])];
  return { template: t, employee, text: r.text, missing, missingLabels: missing.map((k) => labels.get(k) ?? k) };
}

/** Código de verificação: 12 caracteres sem ambiguidades (sem 0/O, 1/I). */
function verificationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('').replace(/(.{4})(?!$)/g, '$1-');
}

const canSeeDoc = (actor: Actor, employeeId: string) => STAFF.includes(actor.role) || actor.employeeId === employeeId;

export function documentRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/document-templates', '/v1/document-templates/*', '/v1/documents', '/v1/documents/*']) app.use(p, requireCompany);

  app.get('/v1/document-templates', requireRole('hr_admin'), async (c) => c.json({ templates: await templatesFor(getDb(), c.get('actor').companyId), fields: DOCUMENT_FIELDS }));

  app.get('/v1/document-templates/:key/versions', requireRole('hr_admin'), async (c) => {
    const rows = await getDb().select().from(documentTemplates).where(and(eq(documentTemplates.companyId, c.get('actor').companyId), eq(documentTemplates.key, c.req.param('key')))).orderBy(desc(documentTemplates.version));
    return c.json(rows);
  });

  /** Adaptar um modelo: grava nova versão (as anteriores ficam no histórico). */
  app.put('/v1/document-templates/:key', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const key = c.req.param('key');
    const builtin = BUILTIN_TEMPLATES.find((t) => t.key === key);
    if (!builtin) throw new DomainError('nao_encontrado', 'Modelo inexistente', 404);
    const b = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(20).max(30_000) }).parse(await body(c));
    const unknown = unknownFields(b.body);
    if (unknown.length) throw new DomainError('campos_desconhecidos', `Campos desconhecidos: ${unknown.map((u) => `{{${u}}}`).join(', ')}`, 400);
    const db = getDb();
    const [last] = await db.select({ v: sql<number>`coalesce(max(${documentTemplates.version}), 0)::int` }).from(documentTemplates).where(and(eq(documentTemplates.companyId, actor.companyId), eq(documentTemplates.key, key)));
    const pack = packOrLatest('AO', Number(luandaDate(new Date()).slice(0, 4)));
    const row = await db.transaction(async (tx) => {
      await tx.update(documentTemplates).set({ active: false }).where(and(eq(documentTemplates.companyId, actor.companyId), eq(documentTemplates.key, key)));
      const [x] = await tx.insert(documentTemplates).values({ companyId: actor.companyId, key, version: (last?.v ?? 0) + 1, title: b.title, body: b.body, basedOn: pack.version, createdBy: actor.actorId }).returning();
      await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'update', entity: 'document_template', entityId: x!.id, after: { key, version: x!.version } });
      return x!;
    });
    return c.json(row);
  });

  /** Voltar ao modelo do Kianda (as versões da empresa ficam no histórico). */
  app.post('/v1/document-templates/:key/reset', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    await getDb().update(documentTemplates).set({ active: false }).where(and(eq(documentTemplates.companyId, actor.companyId), eq(documentTemplates.key, c.req.param('key'))));
    return c.json({ ok: true });
  });

  app.post('/v1/documents/preview', requireRole('hr_admin'), async (c) => {
    const b = z.object({ employeeId: z.string(), templateKey: z.string(), inputs: inputsBody }).parse(await body(c));
    const r = await compose(getDb(), c.get('actor').companyId, b.employeeId, b.templateKey, b.inputs);
    return c.json({ title: r.template.title, version: r.template.version, text: r.text, missing: r.missing, missingLabels: r.missingLabels });
  });

  app.post('/v1/documents', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ employeeId: z.string(), templateKey: z.string(), inputs: inputsBody }).parse(await body(c));
    const db = getDb();
    const r = await compose(db, actor.companyId, b.employeeId, b.templateKey, b.inputs);
    if (r.missing.length) throw new DomainError('campos_em_falta', `Complete antes de emitir: ${r.missingLabels.join(', ')}`, 400);
    const year = luandaDate(new Date()).slice(0, 4);
    for (let attempt = 0; ; attempt++) {
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(issuedDocuments).where(and(eq(issuedDocuments.companyId, actor.companyId), like(issuedDocuments.number, `DOC-${year}-%`)));
      try {
        const [doc] = await db.insert(issuedDocuments).values({
          companyId: actor.companyId, employeeId: b.employeeId, number: `DOC-${year}-${String((n?.n ?? 0) + 1).padStart(4, '0')}`,
          templateKey: r.template.key, templateVersion: r.template.version, title: r.template.title, body: r.text, inputs: b.inputs,
          verificationCode: verificationCode(), issuedBy: actor.actorId,
        }).returning();
        await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'issue', entity: 'issued_document', entityId: doc!.id, after: { number: doc!.number, template: r.template.key, employeeId: b.employeeId } });
        return c.json(doc, 201);
      } catch (err) {
        if (attempt < 2 && String((err as { cause?: { code?: string } }).cause?.code ?? (err as { code?: string }).code) === '23505') continue;
        throw err;
      }
    }
  });

  app.get('/v1/documents', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const q = c.req.query('employeeId');
    const employeeId = STAFF.includes(actor.role) ? q : actor.employeeId;
    if (!STAFF.includes(actor.role) && !employeeId) return c.json([]);
    const where = [eq(issuedDocuments.companyId, actor.companyId)];
    if (employeeId) where.push(eq(issuedDocuments.employeeId, employeeId));
    const rows = await db.select({ d: issuedDocuments, name: employees.name, number: employees.number }).from(issuedDocuments).innerJoin(employees, eq(employees.id, issuedDocuments.employeeId))
      .where(and(...where)).orderBy(desc(issuedDocuments.issuedAt)).limit(300);
    return c.json(rows.map(({ d, name, number }) => ({ id: d.id, number: d.number, title: d.title, templateKey: d.templateKey, templateVersion: d.templateVersion, employeeId: d.employeeId, employeeName: name, employeeNumber: number, issuedAt: d.issuedAt, revokedAt: d.revokedAt })));
  });

  app.get('/v1/documents/:id', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [row] = await db.select({ d: issuedDocuments, name: employees.name }).from(issuedDocuments).innerJoin(employees, eq(employees.id, issuedDocuments.employeeId))
      .where(and(eq(issuedDocuments.id, c.req.param('id')), eq(issuedDocuments.companyId, actor.companyId)));
    if (!row || !canSeeDoc(actor, row.d.employeeId)) throw new DomainError('nao_encontrado', 'Documento inexistente', 404);
    return c.json({ ...row.d, employeeName: row.name });
  });

  app.post('/v1/documents/:id/revoke', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo') }).parse(await body(c));
    const db = getDb();
    const [d] = await db.update(issuedDocuments).set({ revokedAt: new Date(), revokedBy: actor.actorId, revokeNote: note })
      .where(and(eq(issuedDocuments.id, c.req.param('id')), eq(issuedDocuments.companyId, actor.companyId), sql`${issuedDocuments.revokedAt} is null`)).returning();
    if (!d) throw new DomainError('nao_encontrado', 'Documento inexistente ou já anulado', 404);
    await db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'revoke', entity: 'issued_document', entityId: d.id, after: { note } });
    return c.json(d);
  });

  return app;
}

/** Verificação pública (sem sessão): confirma emissão e validade, sem revelar o conteúdo. */
export function documentVerificationRoutes() {
  const app = new Hono<AppEnv>();
  app.get('/v1/public/documents/:code', async (c) => {
    const code = c.req.param('code').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?!$)/g, '$1-');
    const db = getDb();
    const [row] = await db.select({ d: issuedDocuments, name: employees.name, company: companies.name, nif: companies.nif }).from(issuedDocuments)
      .innerJoin(employees, eq(employees.id, issuedDocuments.employeeId)).innerJoin(companies, eq(companies.id, issuedDocuments.companyId))
      .where(eq(issuedDocuments.verificationCode, code));
    if (!row) return c.json({ valid: false, message: 'Código não encontrado' }, 404);
    return c.json({
      valid: !row.d.revokedAt, revoked: Boolean(row.d.revokedAt), number: row.d.number, title: row.d.title, company: row.company, companyNif: row.nif,
      employee: row.name, issuedAt: row.d.issuedAt,
    });
  });
  return app;
}
