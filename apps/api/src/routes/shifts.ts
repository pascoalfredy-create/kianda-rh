/**
 * Planeamento de turnos (Tempo): tipos de turno, escala por colaborador e dia, publicação e «os meus turnos».
 * Visibilidade: RH, proprietário, processamento e Finanças vêem todos; a chefia a sua equipa; o colaborador só a sua
 * escala publicada. Planeia quem decide pelo colaborador (canDecideFor). Dias em meses com assiduidade aprovada ou
 * processamento fechado ficam bloqueados.
 */
import {
  ABSENCE_POLICIES, DEFAULT_SHIFT_MIN_REST_MINUTES, OFF_CODE, SHIFT_BATCH_MAX, SHIFT_COLORS, SHIFT_RANGE_MAX_DAYS, addDays, dateRange, daysBetween, labourRules,
  luandaDate, rosterChecks, shiftTypeIssue, shiftWorkMinutes, type AbsenceType, type RosterEntry, type ShiftTypeLike,
} from '@kianda/core';
import {
  absences, and, asc, attendanceMonths, auditLogs, companies, contracts, departments, eq, employees, getDb, gte, inArray, lte, ne, payrollRuns, shiftAssignments,
  shiftTypes, sql, workSchedules, workplaces, type Db,
} from '@kianda/db';
import { Hono } from 'hono';
import { z } from 'zod';
import { xlsx, xlsxResponse, type Cell } from '../lib/xlsx.js';
import { body, requireCompany, requireRole, type Actor, type AppEnv } from '../plugins/tenant.js';
import { DomainError } from '../services/payroll.js';
import { notifyEmployees } from '../services/push.js';
import { canDecideFor, visibleEmployeeIds } from '../services/scope.js';

const date = z.iso.date('Data inválida');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
const VIEWERS = ['owner', 'hr_admin', 'payroll', 'finance', 'manager'] as const;

type TypeRow = typeof shiftTypes.$inferSelect;
type Row = typeof shiftAssignments.$inferSelect;
type Emp = { id: string; name: string; number: string; jobTitle: string; managerId: string | null; departmentId: string | null; workplaceId: string | null; scheduleId: string | null };

const typeView = (t: TypeRow) => ({
  id: t.id, code: t.code, name: t.name, startTime: t.startTime, endTime: t.endTime, breakMinutes: t.breakMinutes, color: t.color,
  minStaff: t.minStaff, active: t.active, workMinutes: shiftWorkMinutes(t),
});

/** O publicado mudou em relação ao planeado (inclui horas do tipo alteradas depois da publicação). */
function pending(r: Row, types: Map<string, TypeRow>): boolean {
  if (r.kind === 'none') return true;
  if (r.kind !== r.pubKind) return true;
  if (r.kind === 'off') return false;
  const t = types.get(r.shiftTypeId ?? '');
  return !t || r.pubShiftTypeId !== t.id || r.pubCode !== t.code || r.pubName !== t.name || r.pubStartTime !== t.startTime || r.pubEndTime !== t.endTime
    || r.pubBreakMinutes !== t.breakMinutes || r.pubColor !== t.color;
}

const published = (r: Row) => r.pubKind === 'shift'
  ? { kind: 'shift' as const, code: r.pubCode!, name: r.pubName ?? r.pubCode!, startTime: r.pubStartTime!, endTime: r.pubEndTime!, breakMinutes: r.pubBreakMinutes ?? 0, color: r.pubColor ?? 'blue' }
  : r.pubKind === 'off' ? { kind: 'off' as const } : null;

function checkRange(from: string, to: string) {
  const n = daysBetween(from, to);
  if (n < 0) throw new DomainError('intervalo', 'A data final é anterior à inicial', 400);
  if (n + 1 > SHIFT_RANGE_MAX_DAYS) throw new DomainError('intervalo', `Mostre no máximo ${SHIFT_RANGE_MAX_DAYS} dias de cada vez`, 400);
}

const periodsOf = (from: string, to: string) => [...new Set(dateRange(from, to).map(d => d.slice(0, 7)))];

/** Meses bloqueados por colaborador (assiduidade aprovada) e meses com processamento fechado (todos). */
async function locks(db: Db, companyId: string, ids: string[], periods: string[]) {
  const [approved, closed] = await Promise.all([
    ids.length && periods.length ? db.select({ employeeId: attendanceMonths.employeeId, period: attendanceMonths.period }).from(attendanceMonths)
      .where(and(eq(attendanceMonths.companyId, companyId), inArray(attendanceMonths.employeeId, ids), inArray(attendanceMonths.period, periods))) : Promise.resolve([]),
    periods.length ? db.select({ period: payrollRuns.period }).from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), inArray(payrollRuns.period, periods), eq(payrollRuns.status, 'closed'))) : Promise.resolve([]),
  ]);
  const closedSet = new Set(closed.map(c => c.period));
  const byEmp = new Map<string, Set<string>>();
  for (const a of approved) { let s = byEmp.get(a.employeeId); if (!s) byEmp.set(a.employeeId, (s = new Set())); s.add(a.period); }
  return (employeeId: string, d: string) => closedSet.has(d.slice(0, 7)) || !!byEmp.get(employeeId)?.has(d.slice(0, 7));
}

/** Colaboradores no ecrã: activos ou suspensos, visíveis para o actor, com os filtros de departamento e local. */
async function people(db: Db, actor: Actor, filter: { departmentId?: string; workplaceId?: string }) {
  const visible = await visibleEmployeeIds(db, actor);
  const conds = [eq(employees.companyId, actor.companyId), inArray(employees.status, ['active', 'suspended'])];
  if (visible) conds.push(inArray(employees.id, visible.length ? visible : ['-']));
  if (filter.departmentId) conds.push(eq(employees.departmentId, filter.departmentId));
  if (filter.workplaceId) conds.push(eq(employees.workplaceId, filter.workplaceId));
  const rows = await db.select({
    id: employees.id, name: employees.name, number: employees.number, jobTitle: employees.jobTitle, managerId: employees.managerId,
    departmentId: employees.departmentId, workplaceId: employees.workplaceId, scheduleId: employees.scheduleId, department: departments.name, workplace: workplaces.name,
  }).from(employees).leftJoin(departments, eq(departments.id, employees.departmentId)).leftJoin(workplaces, eq(workplaces.id, employees.workplaceId)).where(and(...conds)).orderBy(asc(departments.name), asc(employees.name));
  return rows;
}

/** Início do primeiro contrato (antes dele não se planeia). */
async function contractStarts(db: Db, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ employeeId: contracts.employeeId, start: sql<string>`min(${contracts.startDate})` }).from(contracts).where(inArray(contracts.employeeId, ids)).groupBy(contracts.employeeId);
  return new Map(rows.map(r => [r.employeeId, String(r.start).slice(0, 10)]));
}

async function companyTypes(db: Db, companyId: string) {
  return db.select().from(shiftTypes).where(eq(shiftTypes.companyId, companyId)).orderBy(asc(shiftTypes.startTime), asc(shiftTypes.code));
}

const audit = (db: Db, actor: Actor, action: string, entity: string, id: string, before: unknown, after: unknown) =>
  db.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action, entity, entityId: id, before: before as object, after: after as object });

export interface ShiftChange { employeeId: string; date: string; value: string | null }

/**
 * Grava alterações do planeamento (rascunho). value = id do tipo de turno, «off» (folga) ou null (limpar).
 * Tudo ou nada: um colaborador sem permissão, um dia bloqueado ou um turno inactivo recusam o pedido inteiro.
 */
async function applyChanges(db: Db, actor: Actor, changes: ShiftChange[]) {
  if (!changes.length) return { saved: 0 };
  if (changes.length > SHIFT_BATCH_MAX) throw new DomainError('demasiados', `No máximo ${SHIFT_BATCH_MAX} dias por gravação`, 400);
  const last = new Map<string, ShiftChange>();
  for (const ch of changes) last.set(`${ch.employeeId}|${ch.date}`, ch);
  const list = [...last.values()];
  const ids = [...new Set(list.map(c => c.employeeId))];
  const emps = await db.select({ id: employees.id, name: employees.name, managerId: employees.managerId, status: employees.status }).from(employees)
    .where(and(eq(employees.companyId, actor.companyId), inArray(employees.id, ids)));
  const empMap = new Map(emps.map(e => [e.id, e]));
  for (const id of ids) {
    const e = empMap.get(id);
    if (!e || !['active', 'suspended'].includes(e.status)) throw new DomainError('nao_encontrado', 'Colaborador inexistente ou sem contrato activo', 404);
    if (!canDecideFor(actor, e)) throw new DomainError('sem_permissao', `Não pode planear os turnos de ${e.name}.`, 403);
  }
  const types = new Map((await companyTypes(db, actor.companyId)).map(t => [t.id, t]));
  const today = luandaDate(new Date());
  const dates = list.map(c => c.date).sort();
  if (dates[0]! < '2024-01-01' || dates.at(-1)! > addDays(today, 400)) throw new DomainError('data', 'Datas fora do intervalo permitido', 400);
  const locked = await locks(db, actor.companyId, ids, [...new Set(dates.map(d => d.slice(0, 7)))]);
  const starts = await contractStarts(db, ids);
  for (const ch of list) {
    const e = empMap.get(ch.employeeId)!;
    if (locked(ch.employeeId, ch.date)) throw new DomainError('bloqueado', `${e.name}: ${ch.date.slice(0, 7)} tem a assiduidade aprovada ou o processamento fechado — não é possível mudar a escala.`, 409);
    const start = starts.get(ch.employeeId);
    if (ch.value && start && ch.date < start) throw new DomainError('fora_contrato', `${e.name}: o contrato só começa em ${start}.`, 409);
    if (ch.value && ch.value !== 'off') {
      const t = types.get(ch.value);
      if (!t) throw new DomainError('turno', 'Tipo de turno inexistente', 404);
      if (!t.active) throw new DomainError('turno', `O turno ${t.code} está desactivado.`, 409);
    }
  }
  const existing = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.employeeId, ids),
    gte(shiftAssignments.workDate, dates[0]!), lte(shiftAssignments.workDate, dates.at(-1)!)));
  const byKey = new Map(existing.map(r => [`${r.employeeId}|${r.workDate}`, r]));
  const now = new Date();
  const upserts: (typeof shiftAssignments.$inferInsert)[] = [];
  const toDelete: string[] = [], toNone: string[] = [];
  for (const ch of list) {
    const r = byKey.get(`${ch.employeeId}|${ch.date}`);
    if (ch.value === null) {
      if (!r) continue;
      if (r.pubKind) { if (r.kind !== 'none') toNone.push(r.id); } else toDelete.push(r.id);
      continue;
    }
    const kind = ch.value === 'off' ? 'off' : 'shift';
    const shiftTypeId = kind === 'shift' ? ch.value : null;
    if (r && r.kind === kind && r.shiftTypeId === shiftTypeId) continue;
    upserts.push({ companyId: actor.companyId, employeeId: ch.employeeId, workDate: ch.date, kind, shiftTypeId, updatedBy: actor.actorId, updatedAt: now });
  }
  for (let i = 0; i < upserts.length; i += 500) {
    await db.insert(shiftAssignments).values(upserts.slice(i, i + 500)).onConflictDoUpdate({
      target: [shiftAssignments.employeeId, shiftAssignments.workDate],
      set: { kind: sql`excluded.kind`, shiftTypeId: sql`excluded.shift_type_id`, updatedBy: sql`excluded.updated_by`, updatedAt: sql`excluded.updated_at` },
    });
  }
  if (toDelete.length) await db.delete(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.id, toDelete)));
  if (toNone.length) await db.update(shiftAssignments).set({ kind: 'none', shiftTypeId: null, updatedBy: actor.actorId, updatedAt: now })
    .where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.id, toNone)));
  const saved = upserts.length + toDelete.length + toNone.length;
  if (saved) await audit(db, actor, 'update', 'shift_roster', actor.companyId, null, { days: saved, employees: ids.length, from: dates[0], to: dates.at(-1) });
  return { saved };
}

export function shiftRoutes() {
  const app = new Hono<AppEnv>();
  app.use('/v1/shifts/*', requireCompany);
  const filters = z.object({ departmentId: z.string().min(1).optional(), workplaceId: z.string().min(1).optional() });

  // ───────── Tipos de turno e regra de descanso ─────────

  app.get('/v1/shifts/types', requireRole(...VIEWERS), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const [types, [company]] = await Promise.all([companyTypes(db, actor.companyId), db.select({ minRest: companies.shiftMinRestMinutes }).from(companies).where(eq(companies.id, actor.companyId))]);
    return c.json({ types: types.map(typeView), minRestMinutes: company?.minRest ?? DEFAULT_SHIFT_MIN_REST_MINUTES, canManage: actor.role === 'owner' || actor.role === 'hr_admin' });
  });

  const typeSchema = z.object({
    code: z.string().trim().toUpperCase().min(1).max(3), name: z.string().trim().min(1, 'Indique o nome').max(40), startTime: time, endTime: time,
    breakMinutes: z.number().int().min(0).max(240).default(0), color: z.enum(SHIFT_COLORS).default('blue'), minStaff: z.number().int().min(0).max(500).nullable().default(null),
  });
  const validType = (t: ShiftTypeLike) => { const issue = shiftTypeIssue(t); if (issue) throw new DomainError('turno_invalido', issue, 400); };

  app.post('/v1/shifts/types', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = typeSchema.parse(await body(c));
    validType(b);
    const [dup] = await db.select({ id: shiftTypes.id }).from(shiftTypes).where(and(eq(shiftTypes.companyId, actor.companyId), eq(shiftTypes.code, b.code)));
    if (dup) throw new DomainError('duplicado', `Já existe um turno com o código ${b.code}.`, 409);
    const [row] = await db.insert(shiftTypes).values({ companyId: actor.companyId, ...b }).returning();
    await audit(db, actor, 'create', 'shift_type', row!.id, null, b);
    return c.json(typeView(row!), 201);
  });

  app.patch('/v1/shifts/types/:id', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = typeSchema.extend({ active: z.boolean().default(true) }).parse(await body(c));
    validType(b);
    const [before] = await db.select().from(shiftTypes).where(and(eq(shiftTypes.id, c.req.param('id')), eq(shiftTypes.companyId, actor.companyId)));
    if (!before) throw new DomainError('nao_encontrado', 'Tipo de turno inexistente', 404);
    const [dup] = await db.select({ id: shiftTypes.id }).from(shiftTypes).where(and(eq(shiftTypes.companyId, actor.companyId), eq(shiftTypes.code, b.code), ne(shiftTypes.id, before.id)));
    if (dup) throw new DomainError('duplicado', `Já existe um turno com o código ${b.code}.`, 409);
    const [row] = await db.update(shiftTypes).set({ ...b, updatedAt: new Date() }).where(eq(shiftTypes.id, before.id)).returning();
    await audit(db, actor, 'update', 'shift_type', before.id, typeView(before), b);
    return c.json(typeView(row!));
  });

  app.patch('/v1/shifts/settings', requireRole('hr_admin'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ minRestMinutes: z.number().int().min(0).max(1440) }).parse(await body(c));
    const [before] = await db.select({ minRest: companies.shiftMinRestMinutes }).from(companies).where(eq(companies.id, actor.companyId));
    await db.update(companies).set({ shiftMinRestMinutes: b.minRestMinutes }).where(eq(companies.id, actor.companyId));
    await audit(db, actor, 'update', 'company', actor.companyId, { shiftMinRestMinutes: before?.minRest }, { shiftMinRestMinutes: b.minRestMinutes });
    return c.json({ minRestMinutes: b.minRestMinutes });
  });

  // ───────── Escala ─────────

  app.get('/v1/shifts/roster', requireRole(...VIEWERS), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const q = z.object({ from: date, to: date }).extend(filters.shape).parse(c.req.query());
    checkRange(q.from, q.to);
    const list = await people(db, actor, q);
    const ids = list.map(e => e.id);
    const prev = addDays(q.from, -1);
    const scheduleIds = [...new Set(list.flatMap(e => e.scheduleId ? [e.scheduleId] : []))];
    const [typeRows, [company], rows, abs, schedules, starts, isLocked] = await Promise.all([
      companyTypes(db, actor.companyId),
      db.select({ minRest: companies.shiftMinRestMinutes }).from(companies).where(eq(companies.id, actor.companyId)),
      ids.length ? db.select().from(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.employeeId, ids), gte(shiftAssignments.workDate, prev), lte(shiftAssignments.workDate, q.to))) : Promise.resolve([]),
      ids.length ? db.select().from(absences).where(and(eq(absences.companyId, actor.companyId), inArray(absences.employeeId, ids), eq(absences.status, 'approved'), lte(absences.startDate, q.to), gte(absences.endDate, q.from))) : Promise.resolve([]),
      scheduleIds.length ? db.select({ id: workSchedules.id, name: workSchedules.name, kind: workSchedules.kind }).from(workSchedules).where(and(eq(workSchedules.companyId, actor.companyId), inArray(workSchedules.id, scheduleIds))) : Promise.resolve([]),
      contractStarts(db, ids),
      locks(db, actor.companyId, ids, periodsOf(q.from, q.to)),
    ]);
    const types = new Map(typeRows.map(t => [t.id, t]));
    const sched = new Map(schedules.map(s => [s.id, s]));
    const rules = labourRules('AO', Number(q.from.slice(0, 4)));
    const holidays = new Map([...rules.holidays, ...(q.to.slice(0, 4) !== q.from.slice(0, 4) ? labourRules('AO', Number(q.to.slice(0, 4))).holidays : [])]
      .filter(h => h.date >= q.from && h.date <= q.to).map(h => [h.date, h.name]));
    const absenceMap = new Map<string, Map<string, string>>();
    for (const a of abs) {
      let m = absenceMap.get(a.employeeId);
      if (!m) absenceMap.set(a.employeeId, (m = new Map()));
      for (const d of dateRange(a.startDate < q.from ? q.from : a.startDate, a.endDate > q.to ? q.to : a.endDate)) m.set(d, ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type);
    }
    const planned = (r: Row): RosterEntry | null => r.kind === 'none' ? null : { employeeId: r.employeeId, date: r.workDate, shift: r.kind === 'shift' ? types.get(r.shiftTypeId ?? '') ?? null : null };
    const inRange = rows.filter(r => r.workDate >= q.from);
    const issues = rosterChecks({
      from: q.from, to: q.to, holidays, absences: absenceMap, types: typeRows.filter(t => t.active), minRestMinutes: company?.minRest ?? DEFAULT_SHIFT_MIN_REST_MINUTES,
      weeklyHours: rules.labour.weeklyHours, extendedWeeklyHours: rules.labour.extendedWeeklyHours,
      employees: list.map(e => ({ id: e.id, name: e.name, rotation: sched.get(e.scheduleId ?? '')?.kind === 'cycle' })),
      entries: inRange.map(planned).filter((x): x is RosterEntry => !!x),
      before: rows.filter(r => r.workDate < q.from).map(planned).filter((x): x is RosterEntry => !!x),
    });
    const cells = inRange.map(r => ({ employeeId: r.employeeId, date: r.workDate, kind: r.kind, shiftTypeId: r.shiftTypeId, published: published(r), pending: pending(r, types), locked: isLocked(r.employeeId, r.workDate) }));
    const days = dateRange(q.from, q.to);
    return c.json({
      from: q.from, to: q.to, days, holidays: Object.fromEntries(holidays), today: luandaDate(new Date()),
      types: typeRows.map(typeView), minRestMinutes: company?.minRest ?? DEFAULT_SHIFT_MIN_REST_MINUTES,
      weeklyHours: rules.labour.weeklyHours, extendedWeeklyHours: rules.labour.extendedWeeklyHours,
      previous: rows.filter(r => r.workDate < q.from && r.kind !== 'none').map(r => ({ employeeId: r.employeeId, date: r.workDate, kind: r.kind, shiftTypeId: r.shiftTypeId })),
      employees: list.map(e => ({
        id: e.id, name: e.name, number: e.number, jobTitle: e.jobTitle, department: e.department, departmentId: e.departmentId, workplace: e.workplace, workplaceId: e.workplaceId, schedule: sched.get(e.scheduleId ?? '')?.name ?? null,
        rotation: sched.get(e.scheduleId ?? '')?.kind === 'cycle', startDate: starts.get(e.id) ?? null, canEdit: canDecideFor(actor, e),
        absences: Object.fromEntries(absenceMap.get(e.id) ?? []), lockedDays: days.filter(d => isLocked(e.id, d)),
      })),
      cells, issues, pendingCount: cells.filter(x => x.pending && !x.locked).length,
      canManageTypes: actor.role === 'owner' || actor.role === 'hr_admin',
    });
  });

  const changeSchema = z.object({ employeeId: z.string().min(1), date, value: z.string().min(1).nullable() });

  app.put('/v1/shifts/roster', requireRole('hr_admin', 'manager'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ changes: z.array(changeSchema).max(SHIFT_BATCH_MAX) }).parse(await body(c));
    return c.json(await applyChanges(db, actor, b.changes));
  });

  /** Copia o planeado de um intervalo para outro com o mesmo número de dias (semana anterior, quinzena…). */
  app.post('/v1/shifts/copy', requireRole('hr_admin', 'manager'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ from: date, to: date, target: date, onlyEmpty: z.boolean().default(false) }).extend(filters.shape).parse(await body(c));
    checkRange(b.from, b.to);
    const shift = daysBetween(b.from, b.target);
    if (shift === 0) throw new DomainError('intervalo', 'Escolha outro início para a cópia', 400);
    const targetTo = addDays(b.to, shift);
    if (b.target <= b.to && targetTo >= b.from) throw new DomainError('intervalo', 'O destino não pode sobrepor-se à origem', 400);
    const list = (await people(db, actor, b)).filter(e => canDecideFor(actor, e));
    const ids = list.map(e => e.id);
    if (!ids.length) return c.json({ saved: 0 });
    const rows = await db.select().from(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.employeeId, ids),
      gte(shiftAssignments.workDate, b.from), lte(shiftAssignments.workDate, targetTo > b.to ? targetTo : b.to)));
    const at = new Map(rows.map(r => [`${r.employeeId}|${r.workDate}`, r]));
    const types = new Map((await companyTypes(db, actor.companyId)).map(t => [t.id, t]));
    const isLocked = await locks(db, actor.companyId, ids, periodsOf(b.target, targetTo));
    const starts = await contractStarts(db, ids);
    const changes: ShiftChange[] = [];
    for (const e of list) for (const d of dateRange(b.from, b.to)) {
      const target = addDays(d, shift);
      if (isLocked(e.id, target)) continue;
      const src = at.get(`${e.id}|${d}`), dst = at.get(`${e.id}|${target}`);
      const value = !src || src.kind === 'none' ? null : src.kind === 'off' ? 'off' : src.shiftTypeId;
      if (value && value !== 'off' && !types.get(value)?.active) continue;
      if (value && (starts.get(e.id) ?? '') > target) continue;
      if (b.onlyEmpty && dst && dst.kind !== 'none') continue;
      changes.push({ employeeId: e.id, date: target, value });
    }
    return c.json(await applyChanges(db, actor, changes));
  });

  /** Publica o planeado do intervalo: o colaborador passa a ver e o ponto passa a prever pela escala. */
  app.post('/v1/shifts/publish', requireRole('hr_admin', 'manager'), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const b = z.object({ from: date, to: date }).extend(filters.shape).parse(await body(c));
    checkRange(b.from, b.to);
    const ids = (await people(db, actor, b)).filter(e => canDecideFor(actor, e)).map(e => e.id);
    if (!ids.length) return c.json({ published: 0, employees: 0 });
    const now = new Date();
    // Os meses bloqueados não são publicados (o que a assiduidade aprovou não muda).
    const where = sql`a.company_id = ${actor.companyId} and a.employee_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) and a.work_date between ${b.from} and ${b.to}
      and not exists (select 1 from attendance_months m where m.employee_id = a.employee_id and m.period = to_char(a.work_date, 'YYYY-MM'))
      and not exists (select 1 from payroll_runs p where p.company_id = a.company_id and p.period = to_char(a.work_date, 'YYYY-MM') and p.status = 'closed')`;
    const shifts = await db.execute(sql`update shift_assignments a set pub_kind = 'shift', pub_shift_type_id = t.id, pub_code = t.code, pub_name = t.name,
      pub_start_time = t.start_time, pub_end_time = t.end_time, pub_break_minutes = t.break_minutes, pub_color = t.color, published_at = ${now}, published_by = ${actor.actorId}
      from shift_types t where t.id = a.shift_type_id and a.kind = 'shift' and ${where}
      and (a.pub_kind is distinct from 'shift' or a.pub_shift_type_id is distinct from t.id or a.pub_code is distinct from t.code or a.pub_name is distinct from t.name
        or a.pub_start_time is distinct from t.start_time or a.pub_end_time is distinct from t.end_time or a.pub_break_minutes is distinct from t.break_minutes or a.pub_color is distinct from t.color)
      returning a.employee_id`);
    const offs = await db.execute(sql`update shift_assignments a set pub_kind = 'off', pub_shift_type_id = null, pub_code = null, pub_name = null, pub_start_time = null,
      pub_end_time = null, pub_break_minutes = null, pub_color = null, published_at = ${now}, published_by = ${actor.actorId}
      where a.kind = 'off' and a.pub_kind is distinct from 'off' and ${where} returning a.employee_id`);
    const removed = await db.execute(sql`delete from shift_assignments a where a.kind = 'none' and ${where} returning a.employee_id`);
    const affected = [...shifts.rows, ...offs.rows, ...removed.rows].map(r => String((r as { employee_id: string }).employee_id));
    const unique = [...new Set(affected)];
    if (affected.length) {
      await audit(db, actor, 'publish', 'shift_roster', actor.companyId, null, { days: affected.length, employees: unique.length, from: b.from, to: b.to });
      await notifyEmployees(db, actor.companyId, unique, { title: 'Escala de turnos', body: 'A sua escala de turnos foi publicada ou actualizada.', url: '/turnos', tag: 'turnos' });
    }
    return c.json({ published: affected.length, employees: unique.length });
  });

  /** Excel da escala planeada (o que está no ecrã, publicado ou não). */
  app.get('/v1/shifts/export', requireRole(...VIEWERS), async (c) => {
    const actor = c.get('actor'), db = getDb();
    const q = z.object({ from: date, to: date }).extend(filters.shape).parse(c.req.query());
    checkRange(q.from, q.to);
    const list = await people(db, actor, q);
    const ids = list.map(e => e.id);
    const [typeRows, rows] = await Promise.all([
      companyTypes(db, actor.companyId),
      ids.length ? db.select().from(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), inArray(shiftAssignments.employeeId, ids), gte(shiftAssignments.workDate, q.from), lte(shiftAssignments.workDate, q.to))) : Promise.resolve([]),
    ]);
    const types = new Map(typeRows.map(t => [t.id, t]));
    const at = new Map(rows.map(r => [`${r.employeeId}|${r.workDate}`, r]));
    const days = dateRange(q.from, q.to);
    const wd = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const head: Cell[] = ['N.º', 'Colaborador', 'Departamento', ...days.map(d => `${wd[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8, 10)}/${d.slice(5, 7)}`), 'Turnos', 'Horas'];
    const body: Cell[][] = list.map(e => {
      let n = 0, minutes = 0;
      const cells = days.map(d => {
        const r = at.get(`${e.id}|${d}`);
        if (!r || r.kind === 'none') return '';
        if (r.kind === 'off') return OFF_CODE;
        const t = types.get(r.shiftTypeId ?? '');
        if (!t) return '';
        n++; minutes += shiftWorkMinutes(t);
        return t.code;
      });
      return [e.number, e.name, e.department ?? '', ...cells, { value: n, format: 'integer' }, Math.round((minutes / 60) * 100) / 100];
    });
    const legend: Cell[][] = [['Código', 'Turno', 'Entrada', 'Saída', 'Intervalo (min)', 'Horas de trabalho', 'Mínimo de pessoas'],
      ...typeRows.filter(t => t.active).map((t): Cell[] => [t.code, t.name, t.startTime, t.endTime, { value: t.breakMinutes, format: 'integer' }, Math.round((shiftWorkMinutes(t) / 60) * 100) / 100, t.minStaff ?? '']),
      [OFF_CODE, 'Folga', '', '', '', '', '']];
    const data = xlsx([
      { name: 'Escala', header: true, widths: [8, 30, 20, ...days.map(() => 7), 8, 8], numberFormat: '0.00', rows: [head, ...body] },
      { name: 'Turnos', header: true, widths: [8, 24, 9, 9, 14, 16, 16], numberFormat: '0.00', rows: legend },
    ]);
    return xlsxResponse(data, `escala-turnos-${q.from}-${q.to}.xlsx`);
  });

  // ───────── Os meus turnos ─────────

  app.get('/v1/shifts/mine', async (c) => {
    const actor = c.get('actor'), db = getDb();
    if (!actor.employeeId) return c.json({ error: 'sem_ficha', message: 'O seu utilizador não está associado a uma ficha de colaborador.' }, 409);
    const today = luandaDate(new Date());
    const q = z.object({ from: date.optional(), to: date.optional() }).parse(c.req.query());
    const from = q.from ?? today, to = q.to ?? addDays(from, 27);
    checkRange(from, to);
    const [rows, abs] = await Promise.all([
      db.select().from(shiftAssignments).where(and(eq(shiftAssignments.companyId, actor.companyId), eq(shiftAssignments.employeeId, actor.employeeId), gte(shiftAssignments.workDate, from), lte(shiftAssignments.workDate, to))).orderBy(asc(shiftAssignments.workDate)),
      db.select().from(absences).where(and(eq(absences.companyId, actor.companyId), eq(absences.employeeId, actor.employeeId), eq(absences.status, 'approved'), lte(absences.startDate, to), gte(absences.endDate, from))),
    ]);
    const holidays = Object.fromEntries([...labourRules('AO', Number(from.slice(0, 4))).holidays, ...labourRules('AO', Number(to.slice(0, 4))).holidays].filter(h => h.date >= from && h.date <= to).map(h => [h.date, h.name]));
    const absenceDays: Record<string, string> = {};
    for (const a of abs) for (const d of dateRange(a.startDate < from ? from : a.startDate, a.endDate > to ? to : a.endDate)) absenceDays[d] = ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type;
    const days = rows.flatMap(r => { const p = published(r); return p ? [{ date: r.workDate, ...p, workMinutes: p.kind === 'shift' ? shiftWorkMinutes(p) : 0, publishedAt: r.publishedAt }] : []; });
    const next = days.find(d => d.kind === 'shift' && d.date >= today) ?? null;
    return c.json({ from, to, today, days, holidays, absences: absenceDays, next });
  });

  return app;
}

/** Minutos previstos pela escala publicada (ponto): data → minutos (0 = folga). */
export async function publishedRoster(db: Db, companyId: string, ids: string[], from: string, to: string) {
  const out = new Map<string, Map<string, { minutes: number; code: string | null; label: string | null }>>();
  if (!ids.length) return out;
  const rows = await db.select({ employeeId: shiftAssignments.employeeId, workDate: shiftAssignments.workDate, pubKind: shiftAssignments.pubKind, code: shiftAssignments.pubCode,
    start: shiftAssignments.pubStartTime, end: shiftAssignments.pubEndTime, breakMinutes: shiftAssignments.pubBreakMinutes })
    .from(shiftAssignments).where(and(eq(shiftAssignments.companyId, companyId), inArray(shiftAssignments.employeeId, ids), gte(shiftAssignments.workDate, from), lte(shiftAssignments.workDate, to),
      sql`${shiftAssignments.pubKind} is not null`));
  for (const r of rows) {
    let m = out.get(r.employeeId);
    if (!m) out.set(r.employeeId, (m = new Map()));
    m.set(r.workDate, r.pubKind === 'shift'
      ? { minutes: shiftWorkMinutes({ startTime: r.start!, endTime: r.end!, breakMinutes: r.breakMinutes ?? 0 }), code: r.code, label: `${r.code} ${r.start}–${r.end}` }
      : { minutes: 0, code: OFF_CODE, label: 'Folga' });
  }
  return out;
}
