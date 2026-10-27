import {
  addDays, ALLOWANCE_CALC, ALLOWANCE_PRESETS, lastDayOfMonth, complianceChecks, describeSchedule, labourRules, luandaDate, SCHEDULE_PRESETS, scheduleStats, SECTORS, sectorProfile,
  type AllowanceCalc,
} from '@kianda/core';
import {
  allowanceTypes, and, asc, auditLogs, companies, eq, employeeAllowances, employeeDocuments, employees, getDb, gte, inArray, lte, ne, payrollRuns, workSchedules,
  type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { applySectorPreset, asSchedule } from '../services/sector.js';

const weeklyHours = () => labourRules('AO', Number(luandaDate(new Date()).slice(0, 4))).labour.weeklyHours;
const toMinor = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));
const toBps = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100));

const scheduleBody = z.object({
  name: z.string().trim().min(3, 'Dê um nome ao regime').max(80),
  kind: z.enum(['weekly', 'cycle']),
  pattern: z.array(z.number().int().min(0).max(1440)).min(2).max(120),
  anchorDate: z.iso.date().optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
  active: z.boolean().optional(),
}).refine((b) => b.kind !== 'weekly' || b.pattern.length === 7, { message: 'O regime semanal tem 7 dias (segunda a domingo)', path: ['pattern'] })
  .refine((b) => b.pattern.some((m) => m > 0), { message: 'O regime não tem nenhum dia de trabalho', path: ['pattern'] });

const allowanceBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{2,9}$/, 'Código com 3 a 10 letras/números (ex.: SUBRISCO)'),
  label: z.string().trim().min(3).max(80),
  calc: z.enum(Object.keys(ALLOWANCE_CALC) as [AllowanceCalc]),
  value: z.number().nonnegative().max(1e9).optional().nullable(),
  pct: z.number().positive().max(200).optional().nullable(),
  inInss: z.boolean().default(true),
  inIrt: z.boolean().default(true),
  note: z.string().trim().max(300).optional().nullable(),
  active: z.boolean().optional(),
}).refine((b) => (b.calc === 'base_pct' ? !!b.pct : b.value !== null && b.value !== undefined && b.value > 0), { message: 'Indique o valor (ou a percentagem do salário base)', path: ['value'] });

// Códigos do Kianda que não podem ser usados por subsídios da empresa (colidem com o recibo e o lançamento).
const RESERVED = new Set(['BASE', 'ALIM', 'TRANSP', 'HE', 'SUBFER', 'SUBNAT', 'FALTAS', 'INSS', 'IRT', 'INSS_EMP', 'ADIANT', 'OUTDESC', 'AVISODESC', 'BONUS', 'OUTABON', 'FERNG', 'FERPROP', 'SUBFERPROP', 'COMP', 'COMPEXC', 'AVISO']);

const audit = (db: Pick<Db, 'insert'>, actor: Actor, action: string, entity: string, id: string, before: unknown, after: unknown) =>
  db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity, entityId: id, before: before as object, after: after as object });

async function loadEmployee(db: Db, actor: Actor, id: string) {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, actor.companyId)));
  if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  return e;
}

/** O dia de um período fechado não pode deixar de ter o subsídio que foi processado. */
async function closedPeriodsWithin(db: Db, companyId: string, from: string, to: string | null) {
  return db.select({ period: payrollRuns.period }).from(payrollRuns).where(and(
    eq(payrollRuns.companyId, companyId), eq(payrollRuns.status, 'closed'),
    gte(payrollRuns.period, from.slice(0, 7)), ...(to ? [lte(payrollRuns.period, to.slice(0, 7))] : []),
  ));
}

export function sectorRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/sector', '/v1/sector/*', '/v1/schedules', '/v1/schedules/*', '/v1/allowance-types', '/v1/allowance-types/*', '/v1/work-regime/*', '/v1/employee-allowances/*', '/v1/compliance']) {
    app.use(p, requireCompany);
  }
  const VIEW = requireRole('hr_admin', 'payroll', 'finance');
  const EDIT = requireRole('hr_admin', 'payroll');

  // ───────── Sector e pré-configuração ─────────
  app.get('/v1/sector', VIEW, async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [co] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, actor.companyId));
    const schedules = await db.select().from(workSchedules).where(eq(workSchedules.companyId, actor.companyId)).orderBy(asc(workSchedules.name));
    const types = await db.select().from(allowanceTypes).where(eq(allowanceTypes.companyId, actor.companyId)).orderBy(asc(allowanceTypes.label));
    const staff = await db.select({ id: employees.id, scheduleId: employees.scheduleId }).from(employees)
      .where(and(eq(employees.companyId, actor.companyId), ne(employees.status, 'terminated')));
    const today = luandaDate(new Date());
    const assigned = await db.select({ typeId: employeeAllowances.typeId, employeeId: employeeAllowances.employeeId, endDate: employeeAllowances.endDate })
      .from(employeeAllowances).where(eq(employeeAllowances.companyId, actor.companyId));
    const limit = weeklyHours();
    const profile = sectorProfile(co?.sector);
    const sector = co?.sector ?? null;
    return c.json({
      sector, sectorLabel: sector ? SECTORS[sector as keyof typeof SECTORS] ?? sector : null, sectors: SECTORS, weeklyHours: limit,
      profile: {
        ...profile,
        schedules: profile.schedules.map((k) => {
          const s = SCHEDULE_PRESETS[k]!;
          return { ...s, description: describeSchedule(s), stats: scheduleStats(s, limit), applied: schedules.some((x) => x.name === s.name) };
        }),
        allowances: profile.allowances.map((k) => ({ ...ALLOWANCE_PRESETS[k]!, applied: types.some((t) => t.code === ALLOWANCE_PRESETS[k]!.code) })),
      },
      presets: { schedules: Object.values(SCHEDULE_PRESETS).map((s) => ({ key: s.key, name: s.name })), allowances: Object.values(ALLOWANCE_PRESETS).map((a) => ({ key: a.key, label: a.label, code: a.code })) },
      schedules: schedules.map((s) => ({ ...s, description: describeSchedule(asSchedule(s)), stats: scheduleStats(asSchedule(s), limit), employees: staff.filter((e) => e.scheduleId === s.id).length })),
      allowanceTypes: types.map((t) => ({ ...t, employees: new Set(assigned.filter((a) => a.typeId === t.id && (!a.endDate || a.endDate >= today)).map((a) => a.employeeId)).size })),
      withoutSchedule: staff.filter((e) => !e.scheduleId).length,
    });
  });

  app.put('/v1/sector', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ sector: z.enum(Object.keys(SECTORS) as [keyof typeof SECTORS]) }).parse(await body(c));
    const db = getDb();
    const [before] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, actor.companyId));
    await db.update(companies).set({ sector: b.sector }).where(eq(companies.id, actor.companyId));
    await audit(db, actor, 'update_sector', 'company', actor.companyId, before, b);
    return c.json({ ok: true });
  });

  app.post('/v1/sector/apply', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = z.object({ schedules: z.array(z.string()).max(20).optional(), allowances: z.array(z.string()).max(20).optional() }).parse(await body(c));
    const db = getDb();
    const [co] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, actor.companyId));
    const r = await db.transaction((tx) => applySectorPreset(tx, actor.companyId, co?.sector ?? null, actor.actorId, b));
    return c.json(r);
  });

  // ───────── Regimes de horário ─────────
  app.post('/v1/schedules', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = scheduleBody.parse(await body(c));
    const db = getDb();
    const [dup] = await db.select({ id: workSchedules.id }).from(workSchedules).where(and(eq(workSchedules.companyId, actor.companyId), eq(workSchedules.name, b.name)));
    if (dup) throw new DomainError('nome_repetido', 'Já existe um regime com esse nome');
    const [row] = await db.insert(workSchedules).values({ companyId: actor.companyId, name: b.name, kind: b.kind, pattern: b.pattern, anchorDate: b.anchorDate ?? null, note: b.note ?? null }).returning();
    await audit(db, actor, 'create', 'work_schedule', row!.id, null, row);
    return c.json(row, 201);
  });

  app.patch('/v1/schedules/:id', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = scheduleBody.parse(await body(c));
    const db = getDb();
    const [before] = await db.select().from(workSchedules).where(and(eq(workSchedules.id, c.req.param('id')), eq(workSchedules.companyId, actor.companyId)));
    if (!before) throw new DomainError('nao_encontrado', 'Regime inexistente', 404);
    const [dup] = await db.select({ id: workSchedules.id }).from(workSchedules).where(and(eq(workSchedules.companyId, actor.companyId), eq(workSchedules.name, b.name), ne(workSchedules.id, before.id)));
    if (dup) throw new DomainError('nome_repetido', 'Já existe um regime com esse nome');
    if (b.active === false) {
      const [used] = await db.select({ id: employees.id }).from(employees).where(and(eq(employees.scheduleId, before.id), ne(employees.status, 'terminated'))).limit(1);
      if (used) throw new DomainError('regime_em_uso', 'Há colaboradores com este regime — atribua-lhes outro antes de o desactivar');
    }
    const [row] = await db.update(workSchedules).set({ name: b.name, kind: b.kind, pattern: b.pattern, anchorDate: b.anchorDate ?? null, note: b.note ?? null, active: b.active ?? before.active })
      .where(eq(workSchedules.id, before.id)).returning();
    await audit(db, actor, 'update', 'work_schedule', before.id, before, row);
    return c.json(row);
  });

  // ───────── Subsídios (catálogo) ─────────
  const typeValues = (b: z.infer<typeof allowanceBody>) => ({
    code: b.code, label: b.label, calc: b.calc, valueMinor: b.calc === 'base_pct' ? null : toMinor(b.value), bps: b.calc === 'base_pct' ? toBps(b.pct) : null,
    inInss: b.inInss, inIrt: b.inIrt, note: b.note ?? null,
  });

  app.post('/v1/allowance-types', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = allowanceBody.parse(await body(c));
    if (RESERVED.has(b.code)) throw new DomainError('codigo_reservado', `O código ${b.code} é usado pelo Kianda — escolha outro`, 422);
    const db = getDb();
    const [dup] = await db.select({ id: allowanceTypes.id }).from(allowanceTypes).where(and(eq(allowanceTypes.companyId, actor.companyId), eq(allowanceTypes.code, b.code)));
    if (dup) throw new DomainError('codigo_repetido', 'Já existe um subsídio com esse código');
    const [row] = await db.insert(allowanceTypes).values({ companyId: actor.companyId, ...typeValues(b) }).returning();
    await audit(db, actor, 'create', 'allowance_type', row!.id, null, row);
    return c.json(row, 201);
  });

  app.patch('/v1/allowance-types/:id', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = allowanceBody.parse(await body(c));
    const db = getDb();
    const [before] = await db.select().from(allowanceTypes).where(and(eq(allowanceTypes.id, c.req.param('id')), eq(allowanceTypes.companyId, actor.companyId)));
    if (!before) throw new DomainError('nao_encontrado', 'Subsídio inexistente', 404);
    // O código fica no histórico dos recibos: não muda depois de criado.
    if (b.code !== before.code) throw new DomainError('codigo_fixo', 'O código do subsídio não pode ser alterado (já pode constar de recibos)', 422);
    const [row] = await db.update(allowanceTypes).set({ ...typeValues(b), active: b.active ?? before.active }).where(eq(allowanceTypes.id, before.id)).returning();
    await audit(db, actor, 'update', 'allowance_type', before.id, before, row);
    return c.json(row);
  });

  // ───────── Regime e subsídios de um colaborador ─────────
  app.get('/v1/work-regime/:employeeId', VIEW, async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const e = await loadEmployee(db, actor, c.req.param('employeeId'));
    const schedules = await db.select().from(workSchedules).where(eq(workSchedules.companyId, actor.companyId)).orderBy(asc(workSchedules.name));
    const types = await db.select().from(allowanceTypes).where(eq(allowanceTypes.companyId, actor.companyId)).orderBy(asc(allowanceTypes.label));
    const mine = await db.select().from(employeeAllowances).where(eq(employeeAllowances.employeeId, e.id)).orderBy(asc(employeeAllowances.startDate));
    const current = schedules.find((s) => s.id === e.scheduleId) ?? null;
    return c.json({
      scheduleId: e.scheduleId, scheduleAnchor: e.scheduleAnchor,
      schedule: current ? { ...current, description: describeSchedule(asSchedule(current)) } : null,
      schedules: schedules.filter((s) => s.active || s.id === e.scheduleId).map((s) => ({ id: s.id, name: s.name, kind: s.kind, anchorDate: s.anchorDate, description: describeSchedule(asSchedule(s)) })),
      types: types.filter((t) => t.active),
      allowances: mine.map((a) => ({ ...a, type: types.find((t) => t.id === a.typeId) ?? null })),
    });
  });

  app.put('/v1/work-regime/:employeeId', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = z.object({ scheduleId: z.string().nullable(), scheduleAnchor: z.iso.date().optional().nullable() }).parse(await body(c));
    const db = getDb();
    const e = await loadEmployee(db, actor, c.req.param('employeeId'));
    if (b.scheduleId) {
      const [s] = await db.select().from(workSchedules).where(and(eq(workSchedules.id, b.scheduleId), eq(workSchedules.companyId, actor.companyId)));
      if (!s) throw new DomainError('nao_encontrado', 'Regime inexistente', 404);
      if (!s.active) throw new DomainError('regime_inactivo', 'Esse regime está desactivado');
      if (s.kind === 'cycle' && !s.anchorDate && !b.scheduleAnchor) throw new DomainError('sem_inicio_ciclo', 'Indique a data de início do ciclo deste colaborador (primeiro dia de trabalho da rotação)', 422);
    }
    const after = { scheduleId: b.scheduleId, scheduleAnchor: b.scheduleId ? b.scheduleAnchor ?? null : null };
    await db.update(employees).set({ ...after, updatedAt: new Date() }).where(eq(employees.id, e.id));
    await audit(db, actor, 'update_schedule', 'employee', e.id, { scheduleId: e.scheduleId, scheduleAnchor: e.scheduleAnchor }, after);
    return c.json({ ok: true });
  });

  const assignBody = z.object({
    typeId: z.string(),
    value: z.number().nonnegative().max(1e9).optional().nullable(),
    pct: z.number().positive().max(200).optional().nullable(),
    startDate: z.iso.date(),
    endDate: z.iso.date().optional().nullable(),
  }).refine((b) => !b.endDate || b.endDate >= b.startDate, { message: 'O fim é anterior ao início', path: ['endDate'] });

  app.post('/v1/work-regime/:employeeId/allowances', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = assignBody.parse(await body(c));
    const db = getDb();
    const e = await loadEmployee(db, actor, c.req.param('employeeId'));
    const [t] = await db.select().from(allowanceTypes).where(and(eq(allowanceTypes.id, b.typeId), eq(allowanceTypes.companyId, actor.companyId)));
    if (!t || !t.active) throw new DomainError('nao_encontrado', 'Subsídio inexistente ou desactivado', 404);
    const closed = await closedPeriodsWithin(db, actor.companyId, b.startDate, b.endDate ?? null);
    if (closed.length) throw new DomainError('periodo_fechado', `O processamento de ${closed.map((p) => p.period).sort()[0]} já está fechado — o subsídio só pode começar num mês por fechar`);
    const overlap = (await db.select().from(employeeAllowances).where(and(eq(employeeAllowances.employeeId, e.id), eq(employeeAllowances.typeId, t.id))))
      .some((a) => (!a.endDate || a.endDate >= b.startDate) && (!b.endDate || a.startDate <= b.endDate));
    if (overlap) throw new DomainError('sobreposicao', `${t.label} já está atribuído neste período — termine a atribuição anterior primeiro`);
    const [row] = await db.insert(employeeAllowances).values({
      companyId: actor.companyId, employeeId: e.id, typeId: t.id, startDate: b.startDate, endDate: b.endDate ?? null, createdBy: actor.actorId,
      valueMinor: t.calc === 'base_pct' ? null : toMinor(b.value), bps: t.calc === 'base_pct' ? toBps(b.pct) : null,
    }).returning();
    await audit(db, actor, 'assign_allowance', 'employee', e.id, null, row);
    return c.json(row, 201);
  });

  app.patch('/v1/employee-allowances/:id', EDIT, async (c) => {
    const actor = c.get('actor');
    const b = z.object({ endDate: z.iso.date().nullable() }).parse(await body(c));
    const db = getDb();
    const [a] = await db.select().from(employeeAllowances).where(and(eq(employeeAllowances.id, c.req.param('id')), eq(employeeAllowances.companyId, actor.companyId)));
    if (!a) throw new DomainError('nao_encontrado', 'Atribuição inexistente', 404);
    if (b.endDate && b.endDate < a.startDate) throw new DomainError('datas', 'O fim é anterior ao início', 422);
    // Terminar num mês já fechado alteraria um recibo emitido.
    if (b.endDate) {
      // Fim no último dia do mês não mexe nesse mês; caso contrário o primeiro mês afectado é o do fim.
      const last = lastDayOfMonth(b.endDate.slice(0, 7));
      const first = b.endDate === last ? addDays(last, 1) : b.endDate;
      const closed = (await closedPeriodsWithin(db, actor.companyId, first, a.endDate));
      if (closed.length) throw new DomainError('periodo_fechado', `O processamento de ${closed.map((p) => p.period).sort()[0]} já está fechado com este subsídio — termine a atribuição num mês por fechar`);
    }
    const [row] = await db.update(employeeAllowances).set({ endDate: b.endDate }).where(eq(employeeAllowances.id, a.id)).returning();
    await audit(db, actor, 'end_allowance', 'employee', a.employeeId, a, row);
    return c.json(row);
  });

  app.delete('/v1/employee-allowances/:id', EDIT, async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [a] = await db.select().from(employeeAllowances).where(and(eq(employeeAllowances.id, c.req.param('id')), eq(employeeAllowances.companyId, actor.companyId)));
    if (!a) throw new DomainError('nao_encontrado', 'Atribuição inexistente', 404);
    const closed = await closedPeriodsWithin(db, actor.companyId, a.startDate, a.endDate);
    if (closed.length) throw new DomainError('periodo_fechado', 'Já houve processamentos fechados com este subsídio — indique a data de fim em vez de o apagar');
    await db.delete(employeeAllowances).where(eq(employeeAllowances.id, a.id));
    await audit(db, actor, 'delete_allowance', 'employee', a.employeeId, a, null);
    return c.json({ ok: true });
  });

  // ───────── Conformidade ─────────
  app.get('/v1/compliance', VIEW, async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const [co] = await db.select({ sector: companies.sector }).from(companies).where(eq(companies.id, actor.companyId));
    const staff = await db.select().from(employees).where(and(eq(employees.companyId, actor.companyId), inArray(employees.status, ['active', 'suspended'])));
    const docs = await db.select().from(employeeDocuments).where(eq(employeeDocuments.companyId, actor.companyId));
    const schedules = await db.select().from(workSchedules).where(and(eq(workSchedules.companyId, actor.companyId), eq(workSchedules.active, true)));
    const profile = sectorProfile(co?.sector);
    const checks = complianceChecks({
      sector: co?.sector ?? null, today: luandaDate(new Date()), weeklyHoursLimit: weeklyHours(),
      schedules: schedules.map((s) => ({ id: s.id, name: s.name, ...asSchedule(s) })),
      employees: staff.map((e) => ({
        id: e.id, name: e.name, jobTitle: e.jobTitle, nationality: e.nationality, scheduleId: e.scheduleId, scheduleAnchor: e.scheduleAnchor,
        documents: docs.filter((d) => d.employeeId === e.id).map((d) => ({ type: d.type, expiryDate: d.expiryDate })),
      })),
    });
    const sector = co?.sector ?? null;
    return c.json({ sector, sectorLabel: sector ? SECTORS[sector as keyof typeof SECTORS] ?? sector : null, checks, notes: profile.notes, requiredDocuments: profile.requiredDocuments, employees: staff.length });
  });

  return app;
}
