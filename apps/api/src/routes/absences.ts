import {
  ABSENCE_POLICIES, businessDays, checkAbsenceLimit, labourRules, vacationBalance, vacationEligibleFrom, vacationEntitlement, workingDaysByYear,
  type AbsenceType,
} from '@kianda/core';
import { absences, and, asc, auditLogs, contracts, departments, eq, getDb, gte, inArray, lte, employees, users, type Db } from '@kianda/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { body as readBody, requireCompany, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { canDecideFor, visibleEmployeeIds } from '../services/scope.js';

const TYPES = ['vacation', 'sick', 'justified', 'unjustified', 'maternity', 'paternity', 'marriage', 'bereavement', 'training'] as const;
const today = () => new Date().toISOString().slice(0, 10);
const pt = (d: string) => d.split('-').reverse().join('/');

const createBody = z.object({
  employeeId: z.string(),
  type: z.enum(TYPES),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  reason: z.string().trim().max(500).optional().nullable(),
  /** RH/chefia: registar já aprovado (ex.: baixa médica entregue em papel). */
  approve: z.boolean().optional(),
}).refine((b) => b.endDate >= b.startDate, { message: 'A data de fim tem de ser igual ou posterior à de início', path: ['endDate'] });

type Absence = typeof absences.$inferSelect;
type Employee = typeof employees.$inferSelect;

// ───────────────────────── Regras ─────────────────────────

const canDecide = canDecideFor;

/** Pode registar ausências para este colaborador? */
function canRegisterFor(actor: Actor, emp: Employee): boolean {
  if (actor.employeeId === emp.id) return true;
  if (actor.role === 'owner' || actor.role === 'hr_admin') return true;
  return actor.role === 'manager' && !!actor.employeeId && emp.managerId === actor.employeeId;
}

async function hireDate(db: Db, employeeId: string): Promise<string | null> {
  const [c] = await db.select({ d: contracts.startDate }).from(contracts).where(eq(contracts.employeeId, employeeId)).orderBy(asc(contracts.startDate)).limit(1);
  return c?.d ?? null;
}

/** Dias úteis de uma ausência que caem dentro de um ano civil. */
function daysInYear(a: Pick<Absence, 'startDate' | 'endDate'>, year: number): number {
  const from = a.startDate > `${year}-01-01` ? a.startDate : `${year}-01-01`;
  const to = a.endDate < `${year}-12-31` ? a.endDate : `${year}-12-31`;
  if (to < from) return 0;
  return businessDays(from, to, [labourRules('AO', year)]);
}

async function balanceFor(db: Db, emp: Employee, year: number, excludeId?: string) {
  const pack = labourRules('AO', year);
  const hire = await hireDate(db, emp.id);
  const rows = await db.select().from(absences).where(and(
    eq(absences.employeeId, emp.id), eq(absences.type, 'vacation'), inArray(absences.status, ['pending', 'approved']),
    lte(absences.startDate, `${year}-12-31`), gte(absences.endDate, `${year}-01-01`),
  ));
  let approved = 0;
  let pending = 0;
  for (const a of rows) {
    if (a.id === excludeId) continue;
    const d = daysInYear(a, year);
    if (a.status === 'approved') approved += d; else pending += d;
  }
  // Dias transitados do ano anterior contam no ano corrente.
  const carriedOver = year === Number(today().slice(0, 4)) ? emp.vacationCarryOver : 0;
  return {
    hireDate: hire,
    eligibleFrom: hire ? vacationEligibleFrom(hire, pack) : null,
    ...vacationBalance({ year, entitlement: hire ? vacationEntitlement(hire, year, pack) : 0, carriedOver, approvedDays: approved, pendingDays: pending }),
  };
}

/** Elegibilidade e saldo para férias. `excludeId`: o próprio pedido, na aprovação. */
async function assertVacation(db: Db, emp: Employee, startDate: string, endDate: string, excludeId?: string) {
  const hire = await hireDate(db, emp.id);
  if (!hire) throw new DomainError('sem_contrato', 'O colaborador não tem contrato registado', 422);
  const eligible = vacationEligibleFrom(hire, labourRules('AO', Number(startDate.slice(0, 4))));
  if (startDate < eligible) throw new DomainError('ferias_antes_de_6_meses', `Só pode gozar férias após 6 meses de serviço (a partir de ${pt(eligible)})`, 422);
  const byYear = workingDaysByYear(startDate, endDate, (y) => labourRules('AO', y));
  for (const [y, days] of Object.entries(byYear)) {
    const b = await balanceFor(db, emp, Number(y), excludeId);
    if (days > b.available) throw new DomainError('saldo_insuficiente', `Saldo de férias de ${y} insuficiente: pedidos ${days} dia(s) úteis, disponíveis ${b.available}`);
  }
}

async function loadAbsence(db: Db, actor: Actor, id: string) {
  const [row] = await db.select({ a: absences, e: employees }).from(absences).innerJoin(employees, eq(employees.id, absences.employeeId))
    .where(and(eq(absences.id, id), eq(absences.companyId, actor.companyId)));
  if (!row) throw new DomainError('nao_encontrado', 'Ausência inexistente', 404);
  return row;
}

const audit = (db: Db, actor: Actor, action: string, id: string, before: unknown, after: unknown) =>
  db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity: 'absence', entityId: id, before: before as object, after: after as object });

// ───────────────────────── Rotas ─────────────────────────

export function absenceRoutes() {
  const app = new Hono<AppEnv>();
  for (const p of ['/v1/absences', '/v1/absences/*', '/v1/leave/*']) app.use(p, requireCompany);

  app.post('/v1/absences', async (c) => {
    const actor = c.get('actor');
    const b = createBody.parse(await readBody(c));
    const db = getDb();
    const [emp] = await db.select().from(employees).where(and(eq(employees.id, b.employeeId), eq(employees.companyId, actor.companyId)));
    if (!emp) return c.json({ error: 'colaborador_inexistente', message: 'Colaborador inexistente' }, 404);
    if (!canRegisterFor(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Só pode registar ausências próprias ou da sua equipa.' }, 403);
    const isSelf = actor.employeeId === emp.id;
    const policy = ABSENCE_POLICIES[b.type as AbsenceType];
    if (isSelf && !policy.selfService && actor.role !== 'owner' && actor.role !== 'hr_admin') {
      return c.json({ error: 'sem_permissao', message: `${policy.label} só pode ser registada pelos Recursos Humanos ou pela chefia.` }, 403);
    }
    if (b.approve && !canDecide(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Não pode aprovar este pedido (ninguém aprova pedidos próprios).' }, 403);

    const byYear = workingDaysByYear(b.startDate, b.endDate, (y) => labourRules('AO', y));
    const workingDays = Object.values(byYear).reduce((s, d) => s + d, 0);
    if (!workingDays) return c.json({ error: 'sem_dias_uteis', message: 'O período não contém dias úteis' }, 422);
    const limitError = checkAbsenceLimit(b.type, b.startDate, b.endDate, workingDays, labourRules('AO', Number(b.startDate.slice(0, 4))));
    if (limitError) return c.json({ error: 'limite_legal', message: limitError }, 422);

    const overlap = await db.select().from(absences).where(and(eq(absences.employeeId, b.employeeId), lte(absences.startDate, b.endDate), gte(absences.endDate, b.startDate), inArray(absences.status, ['pending', 'approved'])));
    if (overlap.length) return c.json({ error: 'sobreposicao', message: `Já existe uma ausência de ${pt(overlap[0]!.startDate)} a ${pt(overlap[0]!.endDate)}` }, 409);
    if (b.type === 'vacation') await assertVacation(db, emp, b.startDate, b.endDate);

    const approved = !!b.approve;
    const [a] = await db.insert(absences).values({
      companyId: actor.companyId, employeeId: emp.id, type: b.type, startDate: b.startDate, endDate: b.endDate, workingDays, reason: b.reason ?? null,
      requestedBy: actor.actorId, status: approved ? 'approved' : 'pending', decidedBy: approved ? actor.actorId : null, decidedAt: approved ? new Date() : null,
    }).returning();
    await audit(db, actor, approved ? 'create_approved' : 'request', a!.id, null, a);
    return c.json(a, 201);
  });

  app.get('/v1/absences', async (c) => {
    const actor = c.get('actor');
    const q = z.object({
      from: z.iso.date().optional(), to: z.iso.date().optional(), employeeId: z.string().optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
      awaitingMe: z.enum(['1']).optional(),
    }).parse(c.req.query());
    const db = getDb();
    const visible = await visibleEmployeeIds(db, actor);
    const conds = [eq(absences.companyId, actor.companyId)];
    if (visible) conds.push(inArray(absences.employeeId, visible.length ? visible : ['-']));
    if (q.employeeId) conds.push(eq(absences.employeeId, q.employeeId));
    if (q.status) conds.push(eq(absences.status, q.status));
    if (q.from) conds.push(gte(absences.endDate, q.from));
    if (q.to) conds.push(lte(absences.startDate, q.to));
    const rows = await db.select({ a: absences, name: employees.name, number: employees.number, managerId: employees.managerId, department: departments.name, requester: users.name })
      .from(absences).innerJoin(employees, eq(employees.id, absences.employeeId))
      .leftJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(users, eq(users.id, absences.requestedBy))
      .where(and(...conds)).orderBy(asc(absences.startDate));
    const hr = actor.role === 'owner' || actor.role === 'hr_admin';
    const out = rows.map(({ a, name, number, managerId, department, requester }) => {
      const decider = canDecide(actor, { id: a.employeeId, managerId });
      const open = a.status === 'pending' || a.status === 'approved';
      return {
        ...a, employee: { id: a.employeeId, name, number, department }, requesterName: requester,
        canDecide: a.status === 'pending' && decider,
        canCancel: open && (hr || ((actor.employeeId === a.employeeId || decider) && (a.status === 'pending' || a.startDate > today()))),
      };
    });
    return c.json(q.awaitingMe ? out.filter((x) => x.canDecide) : out);
  });

  const decide = (status: 'approved' | 'rejected') => async (c: Context<AppEnv>) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().max(500).optional() }).parse(await readBody(c));
    if (status === 'rejected' && !note) throw new DomainError('motivo_obrigatorio', 'Indique o motivo da recusa', 400);
    const db = getDb();
    const { a, e } = await loadAbsence(db, actor, c.req.param('id')!);
    if (a.status !== 'pending') throw new DomainError('estado_invalido', 'Só pedidos pendentes podem ser decididos');
    if (!canDecide(actor, e)) return c.json({ error: 'sem_permissao', message: 'Só a chefia directa ou os Recursos Humanos podem decidir este pedido (nunca o próprio).' }, 403);
    if (status === 'approved' && a.type === 'vacation') await assertVacation(db, e, a.startDate, a.endDate, a.id);
    const [after] = await db.update(absences).set({ status, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: note ?? null }).where(eq(absences.id, a.id)).returning();
    await audit(db, actor, status === 'approved' ? 'approve' : 'reject', a.id, { status: a.status }, { status, note: note ?? null, employeeId: a.employeeId });
    return c.json(after);
  };
  app.post('/v1/absences/:id/approve', decide('approved'));
  app.post('/v1/absences/:id/reject', decide('rejected'));

  app.post('/v1/absences/:id/cancel', async (c) => {
    const actor = c.get('actor');
    const db = getDb();
    const { a, e } = await loadAbsence(db, actor, c.req.param('id'));
    const hr = actor.role === 'owner' || actor.role === 'hr_admin';
    if (a.status === 'rejected' || a.status === 'cancelled') throw new DomainError('estado_invalido', 'O pedido já está encerrado');
    if (!hr) {
      const mine = actor.employeeId === a.employeeId;
      if (!mine && !canDecide(actor, e)) return c.json({ error: 'sem_permissao', message: 'Sem permissão para cancelar este pedido.' }, 403);
      if (a.status === 'approved' && a.startDate <= today()) throw new DomainError('ja_iniciada', 'Ausências já iniciadas só podem ser corrigidas pelos Recursos Humanos');
    }
    const [after] = await db.update(absences).set({ status: 'cancelled', decidedBy: actor.actorId, decidedAt: new Date() }).where(eq(absences.id, a.id)).returning();
    await audit(db, actor, 'cancel', a.id, { status: a.status }, { status: 'cancelled', employeeId: a.employeeId });
    return c.json(after);
  });

  /** Saldos de férias do ano para os colaboradores visíveis. */
  app.get('/v1/leave/balances', async (c) => {
    const actor = c.get('actor');
    const { year, employeeId } = z.object({ year: z.coerce.number().int().default(Number(today().slice(0, 4))), employeeId: z.string().optional() }).parse(c.req.query());
    const db = getDb();
    const visible = await visibleEmployeeIds(db, actor);
    const conds = [eq(employees.companyId, actor.companyId), inArray(employees.status, ['active', 'suspended'])];
    if (visible) conds.push(inArray(employees.id, visible.length ? visible : ['-']));
    if (employeeId) conds.push(eq(employees.id, employeeId));
    const list = await db.select({ e: employees, department: departments.name }).from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId)).where(and(...conds)).orderBy(asc(employees.name));
    const out = [];
    for (const { e, department } of list) out.push({ employee: { id: e.id, name: e.name, number: e.number, department }, ...(await balanceFor(db, e, year)) });
    return c.json(out);
  });

  return app;
}
