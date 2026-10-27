import {
  ABSENCE_POLICIES, describeSchedule, fromLuanda, labourRules, luandaDate, luandaTime, scheduledMinutes, summarizeMonth, type AbsenceType,
} from '@kianda/core';
import {
  absences, and, asc, attendanceEntries, workSchedules, attendanceMonths, auditLogs, companies, contracts, departments, desc, eq, employees, getDb, gte, inArray, isNull, lte, payrollRuns, users,
  type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { canDecideFor, canSee, visibleEmployeeIds } from '../services/scope.js';

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Período inválido (AAAA-MM)');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const lastDay = (period: string) => { const [y, m] = period.split('-').map(Number) as [number, number]; return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };

type Employee = typeof employees.$inferSelect;
type Entry = typeof attendanceEntries.$inferSelect;

// ───────────────────────── Serviços ─────────────────────────

async function loadEmployee(db: Db, actor: Actor, id: string): Promise<Employee> {
  const [e] = await db.select().from(employees).where(and(eq(employees.id, id), eq(employees.companyId, actor.companyId)));
  if (!e) throw new DomainError('nao_encontrado', 'Colaborador inexistente', 404);
  return e;
}

/** Folha mensal de um colaborador: registos, ausências aprovadas, feriados, resumo e aprovação. */
export async function monthSheet(db: Db, companyId: string, emp: Employee, period: string) {
  const from = `${period}-01`;
  const to = lastDay(period);
  const [company] = await db.select({ workdayMinutes: companies.workdayMinutes }).from(companies).where(eq(companies.id, companyId));
  const entries = await db.select().from(attendanceEntries)
    .where(and(eq(attendanceEntries.employeeId, emp.id), gte(attendanceEntries.workDate, from), lte(attendanceEntries.workDate, to)))
    .orderBy(asc(attendanceEntries.clockIn));
  const abs = await db.select().from(absences).where(and(
    eq(absences.employeeId, emp.id), eq(absences.status, 'approved'), lte(absences.startDate, to), gte(absences.endDate, from),
  ));
  const absenceByDate: Record<string, string> = {};
  for (const a of abs) {
    for (let d = a.startDate < from ? from : a.startDate; d <= (a.endDate > to ? to : a.endDate); d = nextDay(d)) {
      absenceByDate[d] = ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type;
    }
  }
  const [approval] = await db.select({ m: attendanceMonths, by: users.name }).from(attendanceMonths)
    .leftJoin(users, eq(users.id, attendanceMonths.approvedBy))
    .where(and(eq(attendanceMonths.employeeId, emp.id), eq(attendanceMonths.period, period)));
  const [first] = await db.select({ d: contracts.startDate }).from(contracts).where(eq(contracts.employeeId, emp.id)).orderBy(asc(contracts.startDate)).limit(1);
  const [last] = await db.select({ t: contracts.terminatedAt, e: contracts.endDate }).from(contracts).where(eq(contracts.employeeId, emp.id)).orderBy(desc(contracts.startDate)).limit(1);
  const [sched] = emp.scheduleId ? await db.select().from(workSchedules).where(eq(workSchedules.id, emp.scheduleId)) : [];
  const regime = sched ? { kind: sched.kind as 'weekly' | 'cycle', pattern: sched.pattern, anchorDate: sched.anchorDate } : null;
  const anchor = emp.scheduleAnchor ?? sched?.anchorDate ?? null;
  const summary = summarizeMonth({
    shiftRegime: regime?.kind === 'cycle',
    familyEveMinutes: labourRules('AO', Number(period.slice(0, 4))).labour.familyEveMinutes,
    schedule: regime ? (d) => scheduledMinutes(regime, d, anchor) : undefined,
    employedFrom: first?.d ?? null,
    employedUntil: emp.status === 'terminated' ? (last?.t ?? last?.e ?? null) : null,
    period, dailyMinutes: company?.workdayMinutes ?? 480, holidays: labourRules('AO', Number(period.slice(0, 4))).holidays,
    absences: absenceByDate, today: luandaDate(new Date()),
    punches: entries.map((e) => ({ workDate: e.workDate, clockIn: e.clockIn, clockOut: e.clockOut })),
  });
  const schedule = sched ? { id: sched.id, name: sched.name, description: describeSchedule(regime!), anchor } : null;
  return { summary, entries, schedule, approval: approval ? { ...approval.m, approvedByName: approval.by } : null };
}

function nextDay(d: string): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Correcções só com o mês por aprovar e o processamento do mês por fechar. */
async function assertEditable(db: Db, companyId: string, employeeId: string, workDate: string) {
  const period = workDate.slice(0, 7);
  const [m] = await db.select({ id: attendanceMonths.id }).from(attendanceMonths).where(and(eq(attendanceMonths.employeeId, employeeId), eq(attendanceMonths.period, period)));
  if (m) throw new DomainError('mes_aprovado', `A assiduidade de ${period} já foi aprovada. Reabra o mês (RH) para corrigir.`);
  const [run] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period), eq(payrollRuns.status, 'closed')));
  if (run) throw new DomainError('periodo_fechado', `O processamento de ${period} já está fechado.`);
}

const audit = (db: Db, actor: Actor, action: string, entity: string, id: string, before: unknown, after: unknown) =>
  db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity, entityId: id, before: before as object, after: after as object });

const view = (e: Entry) => ({ ...e, in: luandaTime(e.clockIn), out: e.clockOut ? luandaTime(e.clockOut) : null });

// ───────────────────────── Rotas ─────────────────────────

export function attendanceRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/attendance/*', requireCompany);

  /** O meu dia: registos de hoje e se há entrada aberta. */
  app.get('/v1/attendance/me', async (c) => {
    const actor = c.get('actor');
    if (!actor.employeeId) return c.json({ error: 'sem_ficha', message: 'O seu utilizador não está associado a uma ficha de colaborador.' }, 409);
    const db = getDb();
    const today = luandaDate(new Date());
    const entries = await db.select().from(attendanceEntries).where(and(eq(attendanceEntries.employeeId, actor.employeeId), eq(attendanceEntries.workDate, today))).orderBy(asc(attendanceEntries.clockIn));
    const forgotten = await db.select({ workDate: attendanceEntries.workDate }).from(attendanceEntries)
      .where(and(eq(attendanceEntries.employeeId, actor.employeeId), isNull(attendanceEntries.clockOut), lte(attendanceEntries.workDate, nextDayBefore(today))));
    const worked = entries.reduce((s, e) => s + Math.round(((e.clockOut ?? new Date()).getTime() - e.clockIn.getTime()) / 60_000), 0);
    return c.json({
      today, now: luandaTime(new Date()), entries: entries.map(view), open: entries.some((e) => !e.clockOut), workedMinutes: worked,
      forgottenDays: [...new Set(forgotten.map((f) => f.workDate))],
    });
  });

  /** Registar entrada ou saída — sempre com a hora do servidor. */
  app.post('/v1/attendance/clock', async (c) => {
    const actor = c.get('actor');
    if (!actor.employeeId) return c.json({ error: 'sem_ficha', message: 'O seu utilizador não está associado a uma ficha de colaborador.' }, 409);
    const { action } = z.object({ action: z.enum(['in', 'out']) }).parse(await body(c));
    const db = getDb();
    const now = new Date();
    const today = luandaDate(now);
    const emp = await loadEmployee(db, actor, actor.employeeId);
    if (emp.status !== 'active') throw new DomainError('inactivo', 'Ficha suspensa ou cessada: não é possível registar ponto.', 403);
    // O ponto regista factos: nunca é bloqueado por processamento fechado (é comum fechar a 20–25 do mês);
    // as horas desses dias seguem na aprovação do mês e no processamento seguinte.
    const [open] = await db.select().from(attendanceEntries).where(and(eq(attendanceEntries.employeeId, emp.id), eq(attendanceEntries.workDate, today), isNull(attendanceEntries.clockOut)));
    if (action === 'in') {
      if (open) throw new DomainError('entrada_aberta', `Já registou entrada às ${luandaTime(open.clockIn)}. Registe a saída primeiro.`);
      const [e] = await db.insert(attendanceEntries).values({ companyId: actor.companyId, employeeId: emp.id, workDate: today, clockIn: now, source: 'web', createdBy: actor.actorId }).returning();
      return c.json(view(e!), 201);
    }
    if (!open) throw new DomainError('sem_entrada', 'Não há entrada registada hoje. Registe a entrada primeiro.');
    if (now.getTime() - open.clockIn.getTime() < 60_000) throw new DomainError('demasiado_cedo', 'A saída tem de ser pelo menos 1 minuto depois da entrada.');
    const [e] = await db.update(attendanceEntries).set({ clockOut: now }).where(eq(attendanceEntries.id, open.id)).returning();
    return c.json(view(e!));
  });

  /** Folha mensal de um colaborador (o próprio, a chefia da equipa, RH/processamento/finanças). */
  app.get('/v1/attendance/sheet', async (c) => {
    const actor = c.get('actor');
    const q = z.object({ period: periodSchema, employeeId: z.string().optional() }).parse(c.req.query());
    const employeeId = q.employeeId ?? actor.employeeId;
    if (!employeeId) return c.json({ error: 'sem_ficha', message: 'Indique o colaborador.' }, 400);
    const db = getDb();
    const emp = await loadEmployee(db, actor, employeeId);
    if (!(await canSee(db, actor, emp.id))) return c.json({ error: 'sem_permissao', message: 'Sem acesso à assiduidade deste colaborador.' }, 403);
    const sheet = await monthSheet(db, actor.companyId, emp, q.period);
    return c.json({
      employee: { id: emp.id, name: emp.name, number: emp.number, jobTitle: emp.jobTitle },
      ...sheet, entries: sheet.entries.map(view),
      canEdit: canDecideFor(actor, emp) && !sheet.approval,
      canApprove: canDecideFor(actor, emp) && !sheet.approval && q.period < luandaDate(new Date()).slice(0, 7),
      canReopen: !!sheet.approval && (actor.role === 'owner' || actor.role === 'hr_admin'),
    });
  });

  /** Visão da equipa/empresa: totais do mês por colaborador. */
  app.get('/v1/attendance/overview', async (c) => {
    const actor = c.get('actor');
    const { period } = z.object({ period: periodSchema }).parse(c.req.query());
    const db = getDb();
    const visible = await visibleEmployeeIds(db, actor);
    const conds = [eq(employees.companyId, actor.companyId), inArray(employees.status, ['active', 'suspended'])];
    if (visible) conds.push(inArray(employees.id, visible.length ? visible : ['-']));
    const list = await db.select({ e: employees, department: departments.name }).from(employees)
      .leftJoin(departments, eq(departments.id, employees.departmentId)).where(and(...conds)).orderBy(asc(employees.name));
    const out = [];
    for (const { e, department } of list) {
      const { summary, approval } = await monthSheet(db, actor.companyId, e, period);
      const { days: _d, ...totals } = summary;
      out.push({ employee: { id: e.id, name: e.name, number: e.number, department }, ...totals, approval, canApprove: canDecideFor(actor, e) && !approval && period < luandaDate(new Date()).slice(0, 7) });
    }
    return c.json(out);
  });

  /** Correcção manual (chefia da equipa ou RH; nunca o próprio). */
  app.post('/v1/attendance/entries', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ employeeId: z.string(), date: z.iso.date(), start: time, end: time.optional().nullable(), note: z.string().trim().min(3, 'Indique o motivo da correcção') }).parse(await body(c));
    const db = getDb();
    const emp = await loadEmployee(db, actor, b.employeeId);
    if (!canDecideFor(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Só a chefia directa ou o RH corrigem registos (nunca os próprios).' }, 403);
    if (b.date > luandaDate(new Date())) throw new DomainError('data_futura', 'Não pode registar ponto em datas futuras', 400);
    if (b.end && b.end <= b.start) throw new DomainError('horas_invalidas', 'A saída tem de ser depois da entrada', 400);
    await assertEditable(db, actor.companyId, emp.id, b.date);
    const [e] = await db.insert(attendanceEntries).values({
      companyId: actor.companyId, employeeId: emp.id, workDate: b.date, clockIn: fromLuanda(b.date, b.start), clockOut: b.end ? fromLuanda(b.date, b.end) : null,
      source: 'manual', note: b.note, createdBy: actor.actorId,
    }).returning();
    await audit(db, actor, 'create', 'attendance_entry', e!.id, null, { ...e, employeeId: emp.id });
    return c.json(view(e!), 201);
  });

  app.patch('/v1/attendance/entries/:id', async (c) => {
    const actor = c.get('actor');
    const b = z.object({ start: time.optional(), end: time.optional().nullable(), note: z.string().trim().min(3, 'Indique o motivo da correcção') }).parse(await body(c));
    const db = getDb();
    const [before] = await db.select().from(attendanceEntries).where(and(eq(attendanceEntries.id, c.req.param('id')), eq(attendanceEntries.companyId, actor.companyId)));
    if (!before) return c.json({ error: 'nao_encontrado', message: 'Registo inexistente' }, 404);
    const emp = await loadEmployee(db, actor, before.employeeId);
    if (!canDecideFor(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Só a chefia directa ou o RH corrigem registos (nunca os próprios).' }, 403);
    await assertEditable(db, actor.companyId, emp.id, before.workDate);
    const clockIn = b.start ? fromLuanda(before.workDate, b.start) : before.clockIn;
    const clockOut = b.end === undefined ? before.clockOut : b.end === null ? null : fromLuanda(before.workDate, b.end);
    if (clockOut && clockOut <= clockIn) throw new DomainError('horas_invalidas', 'A saída tem de ser depois da entrada', 400);
    const [after] = await db.update(attendanceEntries).set({ clockIn, clockOut, note: b.note, updatedBy: actor.actorId, updatedAt: new Date() }).where(eq(attendanceEntries.id, before.id)).returning();
    await audit(db, actor, 'update', 'attendance_entry', before.id, { ...view(before) }, { ...view(after!), employeeId: emp.id });
    return c.json(view(after!));
  });

  app.delete('/v1/attendance/entries/:id', async (c) => {
    const actor = c.get('actor');
    const { note } = z.object({ note: z.string().trim().min(3, 'Indique o motivo') }).parse(c.req.query());
    const db = getDb();
    const [before] = await db.select().from(attendanceEntries).where(and(eq(attendanceEntries.id, c.req.param('id')), eq(attendanceEntries.companyId, actor.companyId)));
    if (!before) return c.json({ error: 'nao_encontrado', message: 'Registo inexistente' }, 404);
    const emp = await loadEmployee(db, actor, before.employeeId);
    if (!canDecideFor(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Só a chefia directa ou o RH corrigem registos (nunca os próprios).' }, 403);
    await assertEditable(db, actor.companyId, emp.id, before.workDate);
    await db.delete(attendanceEntries).where(eq(attendanceEntries.id, before.id));
    await audit(db, actor, 'delete', 'attendance_entry', before.id, { ...view(before), employeeId: emp.id }, { note });
    return c.body(null, 204);
  });

  /** Aprovar o mês: fixa as horas extra que seguem para o processamento. */
  app.post('/v1/attendance/approve', async (c) => {
    const actor = c.get('actor');
    const b = z.object({
      employeeId: z.string(), period: periodSchema,
      approvedOvertimeMinutes: z.number().int().min(0).optional(),
      note: z.string().trim().max(500).optional(),
    }).parse(await body(c));
    const db = getDb();
    const emp = await loadEmployee(db, actor, b.employeeId);
    if (!canDecideFor(actor, emp)) return c.json({ error: 'sem_permissao', message: 'Só a chefia directa ou o RH aprovam a assiduidade (nunca a própria).' }, 403);
    if (b.period >= luandaDate(new Date()).slice(0, 7)) throw new DomainError('mes_em_curso', 'O mês só pode ser aprovado depois de terminar', 400);
    const { summary, approval } = await monthSheet(db, actor.companyId, emp, b.period);
    if (approval) throw new DomainError('ja_aprovado', 'Este mês já está aprovado');
    if (summary.openDays) throw new DomainError('saidas_em_falta', `Há ${summary.openDays} dia(s) com saída por registar. Corrija antes de aprovar.`);
    const approved = b.approvedOvertimeMinutes ?? summary.overtimeMinutes;
    if (approved > summary.overtimeMinutes) throw new DomainError('extra_acima', `Não pode aprovar mais horas extra do que as registadas (${summary.overtimeMinutes} min)`, 400);
    if (approved < summary.overtimeMinutes && !b.note) throw new DomainError('motivo_obrigatorio', 'Indique o motivo para aprovar menos horas extra do que as registadas', 400);
    // Limites do trabalho extraordinário (LGT, art. 185.º): acima disso, só com consentimento do trabalhador e autorização da IGT.
    const limits = labourRules('AO', Number(b.period.slice(0, 4))).labour.overtimeLimits;
    const yearRows = await db.select({ m: attendanceMonths.approvedOvertimeMinutes }).from(attendanceMonths)
      .where(and(eq(attendanceMonths.employeeId, emp.id), gte(attendanceMonths.period, `${b.period.slice(0, 4)}-01`), lte(attendanceMonths.period, `${b.period.slice(0, 4)}-12`)));
    const yearTotal = yearRows.reduce((s, r) => s + r.m, 0) + approved;
    if ((approved > limits.perMonth * 60 || yearTotal > limits.perYear * 60) && !b.note) {
      throw new DomainError('limite_extra', `${approved > limits.perMonth * 60 ? `Mais de ${limits.perMonth} h extra no mês` : `Mais de ${limits.perYear} h extra no ano (${Math.round(yearTotal / 60)} h)`}: só com consentimento do trabalhador e autorização da Inspecção Geral do Trabalho (LGT, art. 185.º). Indique a autorização na nota.`, 400);
    }
    // Descanso semanal e feriados são pagos à parte (arts. 194.º e 200.º). Ao aprovar menos do que o registado, o corte vai
    // primeiro ao trabalho em descanso/feriado (normalmente o não autorizado) e só depois aos dias normais.
    const workdayPart = Math.min(approved, summary.overtimeMinutes - summary.restOrHolidayOvertimeMinutes);
    const restHoliday = approved - workdayPart;
    const [row] = await db.insert(attendanceMonths).values({
      companyId: actor.companyId, employeeId: emp.id, period: b.period, workedMinutes: summary.workedMinutes, expectedMinutes: summary.expectedMinutes,
      overtimeMinutes: summary.overtimeMinutes, approvedOvertimeMinutes: approved, note: b.note ?? null, approvedBy: actor.actorId,
      restHolidayOvertimeMinutes: restHoliday,
      restDayPaidMinutes: restHoliday < summary.restOrHolidayOvertimeMinutes ? Math.min(summary.restDayPaidMinutes, restHoliday) : summary.restDayPaidMinutes,
      holidayWorkDays: restHoliday < summary.restOrHolidayOvertimeMinutes ? 0 : summary.holidayWorkDays,
    }).returning();
    await audit(db, actor, 'approve', 'attendance_month', row!.id, null, { ...row, employeeId: emp.id });
    return c.json(row, 201);
  });

  /** Reabrir um mês aprovado (só RH), se o processamento não estiver fechado. */
  app.post('/v1/attendance/reopen', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor');
    const b = z.object({ employeeId: z.string(), period: periodSchema, note: z.string().trim().min(3, 'Indique o motivo') }).parse(await body(c));
    const db = getDb();
    const [run] = await db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.period, b.period), eq(payrollRuns.status, 'closed')));
    if (run) throw new DomainError('periodo_fechado', `O processamento de ${b.period} já está fechado: corrija no mês seguinte.`);
    const [row] = await db.delete(attendanceMonths).where(and(eq(attendanceMonths.companyId, actor.companyId), eq(attendanceMonths.employeeId, b.employeeId), eq(attendanceMonths.period, b.period))).returning();
    if (!row) return c.json({ error: 'nao_encontrado', message: 'Mês não aprovado' }, 404);
    await audit(db, actor, 'reopen', 'attendance_month', row.id, row, { note: b.note, employeeId: b.employeeId });
    return c.json({ ok: true });
  });

  return app;
}

/** Último dia antes de hoje (para detectar saídas esquecidas em dias anteriores). */
function nextDayBefore(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

