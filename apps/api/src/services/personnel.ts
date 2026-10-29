import { personnelCashFlow, personnelMonths, type CashObligation } from '@kianda/core/personnel-cash';
import { allowanceAmount, calculatePayroll, labourRules, scheduledDays, type Schedule, compensationAt, getPack, lastDayOfMonth, listPacks, luandaDate, payrollObligations, yearServiceFraction, workingDaysInMonth } from '@kianda/core';
import { and, asc, companies, compensationChanges, contracts, departments, desc, employeeAllowances, allowanceTypes, employees, eq, expenseClaims, getDb, inArray, payrollLines, payrollRuns, personnelCashPlans, workSchedules } from '@kianda/db';
import { DomainError } from './payroll.js';

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) { const id = key(row), list = map.get(id) ?? []; list.push(row); map.set(id, list); }
  return map;
}
async function staffData(companyId: string) {
  const db = getDb();
  const [people, terms, changes, deps, company, allowances, schedules] = await Promise.all([
    db.select().from(employees).where(eq(employees.companyId, companyId)),
    db.select({ c: contracts }).from(contracts).innerJoin(employees, eq(employees.id, contracts.employeeId)).where(eq(employees.companyId, companyId)).orderBy(desc(contracts.startDate)),
    db.select().from(compensationChanges).where(eq(compensationChanges.companyId, companyId)),
    db.select().from(departments).where(eq(departments.companyId, companyId)),
    db.select().from(companies).where(eq(companies.id, companyId)),
    db.select({ a: employeeAllowances, t: allowanceTypes }).from(employeeAllowances).innerJoin(allowanceTypes, eq(allowanceTypes.id, employeeAllowances.typeId)).where(eq(employeeAllowances.companyId, companyId)),
    db.select().from(workSchedules).where(eq(workSchedules.companyId, companyId)),
  ]);
  if (!company[0]) throw new DomainError('nao_encontrado', 'Empresa inexistente', 404);
  return { people, terms: terms.map(r => r.c), changes, deps, company: company[0], allowances, schedules,
    termsByEmployee: groupBy(terms.map(r => r.c), c => c.employeeId), changesByEmployee: groupBy(changes, c => c.employeeId),
    allowancesByEmployee: groupBy(allowances, x => x.a.employeeId), schedulesById: new Map(schedules.map(s => [s.id, s])),
  };
}

function projectionPack(year: number) {
  const years = listPacks().map(p => Number(p.slice(3))).filter(y => y <= year).sort((a, b) => b - a);
  if (!years.length) return null;
  return getPack('AO', years[0]!);
}

function regularMonth(data: Awaited<ReturnType<typeof staffData>>, period: string, annual: boolean, paid = new Set<string>()) {
  const year = Number(period.slice(0, 4)), month = Number(period.slice(5));
  const pack = projectionPack(year);
  if (!pack) return { rows: [], pack: null };
  const first = `${period}-01`, last = lastDayOfMonth(period);
  const rows = data.people.flatMap(e => {
    const terms = data.termsByEmployee.get(e.id) ?? [];
    const c = terms.find(c => c.startDate <= last);
    const end = c?.terminatedAt ?? c?.endDate;
    if (!c || end && end < first || e.status === 'suspended' || e.status === 'terminated' && !end) return [];
    const pay = compensationAt(data.changesByEmployee.get(e.id) ?? [], last) ?? c;
    const hire = terms.at(-1)?.startDate ?? c.startDate;
    const from = c.startDate > first ? c.startDate : first, until = end && end < last ? end : last;
    const days = from === first && until === last ? undefined : Math.min(30, Math.round((Date.parse(until) - Date.parse(from)) / 86_400_000) + 1);
    const sched = data.schedulesById.get(e.scheduleId ?? '');
    const schedule: Schedule = sched ? { kind: sched.kind as Schedule['kind'], pattern: sched.pattern, anchorDate: sched.anchorDate } : { kind: 'weekly', pattern: [...Array(5).fill(data.company.workdayMinutes), 0, 0] };
    const anchor = e.scheduleAnchor ?? sched?.anchorDate ?? null;
    const holidays = new Set(labourRules('AO', year).holidays.map(h => h.date));
    const extra = (data.allowancesByEmployee.get(e.id) ?? []).filter(({ a }) => a.startDate <= last && (!a.endDate || a.endDate >= first)).flatMap(({ a, t }) => {
      const af = a.startDate > from ? a.startDate : from, at = a.endDate && a.endDate < until ? a.endDate : until;
      if (at < af) return [];
      const activeDays = af === first && at === last ? undefined : Math.min(30, Math.round((Date.parse(at) - Date.parse(af)) / 86400000) + 1);
      const workDays = schedule.kind === 'cycle' && !anchor ? 0 : scheduledDays(schedule, af, at, anchor, holidays);
      return [{ code: t.code, name: t.label, amountMinor: allowanceAmount({ calc: t.calc as 'fixed' | 'base_pct' | 'per_day', valueMinor: a.valueMinor ?? t.valueMinor, bps: a.bps ?? t.bps, baseMinor: pay.baseMinor, activeDays, scheduledDays: workDays, dailyRateDivisor: pack.labour.dailyRateDivisor }), inInss: t.inInss, inIrt: t.inIrt }];
    });
    if (c.otherMinor) extra.push({ code: 'OUTROS', name: c.otherLabel ?? 'Outros subsídios', amountMinor: c.otherMinor, inInss: true, inIrt: true });
    const result = calculatePayroll({ period, pack, baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor, otherEarnings: extra, workedDays: days,
      holidaySubsidy: annual && month === (data.company.holidaySubsidyMonth ?? 12) && !paid.has(`${year}|${e.id}|SUBFER`) ? yearServiceFraction(year, hire, end) : false,
      christmasSubsidy: annual && month === data.company.christmasSubsidyMonth && !paid.has(`${year}|${e.id}|SUBNAT`) ? yearServiceFraction(year, hire, end) : false,
    });
    return [{ e, c, hire, baseMinor: pay.baseMinor, result }];
  });
  return { rows, pack };
}

export async function personnelOverview(companyId: string) {
  const data = await staffData(companyId);
  const today = luandaDate(new Date()), period = today.slice(0, 7);
  const active = data.people.filter(e => e.status === 'active' && (data.termsByEmployee.get(e.id) ?? []).some(c => c.startDate <= today && !(c.terminatedAt && c.terminatedAt < today)));
  const projected = regularMonth(data, period, false);
  const activeIds = new Set(active.map(e => e.id));
  const regular = projected.rows.filter(r => activeIds.has(r.e.id));
  const sortedBase = regular.map(r => r.baseMinor).sort((a, b) => a - b);
  const median = sortedBase.length ? Math.round((sortedBase[Math.floor((sortedBase.length - 1) / 2)]! + sortedBase[Math.floor(sortedBase.length / 2)]!) / 2) : null;
  const earliest = (id: string) => data.termsByEmployee.get(id)?.at(-1)?.startDate;
  const tenure = active.map(e => earliest(e.id)).filter((d): d is string => !!d).map(d => Math.max(0, (Date.parse(today) - Date.parse(d)) / (86_400_000 * 365.25)));
  const birthdays = active.flatMap(e => {
    if (!e.birthDate) return [];
    let next = `${today.slice(0, 4)}${e.birthDate.slice(4)}`;
    if (next < today) next = `${Number(today.slice(0, 4)) + 1}${e.birthDate.slice(4)}`;
    const days = Math.round((Date.parse(next) - Date.parse(today)) / 86_400_000);
    return days >= 0 && days <= 30 ? [{ id: e.id, name: e.name, date: next }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const [run] = await getDb().select().from(payrollRuns).where(and(eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period)));
  const actual = run ? await getDb().select().from(payrollLines).where(eq(payrollLines.runId, run.id)) : null;
  const totals = (actual ?? regular.map(r => r.result)).reduce((s, r) => ({ grossMinor: s.grossMinor + r.grossMinor, costMinor: s.costMinor + r.grossMinor + r.inssEmployerMinor, irtMinor: s.irtMinor + r.irtMinor, inssMinor: s.inssMinor + r.inssEmployeeMinor + r.inssEmployerMinor }), { grossMinor: 0, costMinor: 0, irtMinor: 0, inssMinor: 0 });
  const financial = { ...totals, period, source: run ? run.status : 'estimate', packVersion: run?.packVersion ?? projected.pack?.version ?? null };
  const depts = [...data.deps.map(d => ({ id: d.id as string | null, name: d.name, costCenter: d.costCenter })), { id: null, name: 'Sem departamento', costCenter: 'Sem centro' }].map(d => ({ ...d, headcount: active.filter(e => e.departmentId === d.id).length, costMinor: regular.filter(r => r.e.departmentId === d.id).reduce((s, r) => s + r.result.totalCostMinor, 0) })).filter(d => d.headcount);
  const locations = [...new Set(active.map(e => e.province ?? 'Não indicado'))].map(name => ({ name, headcount: active.filter(e => (e.province ?? 'Não indicado') === name).length, costMinor: regular.filter(r => (r.e.province ?? 'Não indicado') === name).reduce((s, r) => s + r.result.totalCostMinor, 0) }));
  return { active: active.length, fixedTerm: regular.filter(r => r.c.type === 'fixed_term').length, interns: regular.filter(r => r.c.type === 'internship').length, financial, birthdays, departments: depts, locations,
    demographics: { women: active.filter(e => e.gender === 'F').length, men: active.filter(e => e.gender === 'M').length, unspecified: active.filter(e => !['F', 'M'].includes(e.gender ?? '')).length, avgTenureYears: tenure.length ? tenure.reduce((s, n) => s + n, 0) / tenure.length : null, medianBaseMinor: median, salaryRatio: sortedBase[0] ? sortedBase.at(-1)! / sortedBase[0] : null },
  };
}

export async function cashForecast(companyId: string, from: string) {
  const db = getDb(), data = await staffData(companyId);
  const months = personnelMonths(from), last = months.at(-1)!;
  const [plan] = await db.select().from(personnelCashPlans).where(and(eq(personnelCashPlans.companyId, companyId), eq(personnelCashPlans.period, from)));
  const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.companyId, companyId)).orderBy(asc(payrollRuns.period));
  const lines = runs.length ? await db.select().from(payrollLines).where(inArray(payrollLines.runId, runs.map(r => r.id))) : [];
  const paidSubs = new Set<string>();
  for (const run of runs.filter(r => r.status === 'closed')) for (const l of lines.filter(l => l.runId === run.id)) for (const b of l.breakdown as { code: string; amountMinor: number }[]) if (['SUBFER', 'SUBNAT'].includes(b.code) && b.amountMinor > 0) paidSubs.add(`${run.period.slice(0, 4)}|${l.employeeId}|${b.code}`);
  const warnings = new Set<string>();
  const obligations: CashObligation[] = [];
  // Inclui dívidas de períodos anteriores, sem repetir as que já foram pagas.
  const previous = personnelMonths(from, 1)[0]!;
  const [y, m] = previous.split('-').map(Number) as [number, number];
  const prior = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const periods = [...new Set([...runs.filter(r => r.status === 'closed' && r.period <= last).map(r => r.period), prior, ...months])].sort();
  for (const period of periods) {
    const run = runs.find(r => r.period === period);
    if (period < prior && run?.status !== 'closed') continue;
    const estimate = run ? null : regularMonth(data, period, true, paidSubs);
    const pack = projectionPack(Number(period.slice(0, 4)));
    if (!pack) { warnings.add(`Sem regras de referência para ${period}; projecção desse mês indisponível.`); continue; }
    if (pack.year !== Number(period.slice(0, 4))) warnings.add(`Projecções de ${period.slice(0, 4)} estimadas pelas regras ${pack.version}; não são processamentos salariais.`);
    const totals = (run ? lines.filter(l => l.runId === run.id) : estimate!.rows.map(r => r.result)).reduce((s, l) => ({ netMinor: s.netMinor + l.netMinor, irtMinor: s.irtMinor + l.irtMinor, inssEmployeeMinor: s.inssEmployeeMinor + l.inssEmployeeMinor, inssEmployerMinor: s.inssEmployerMinor + l.inssEmployerMinor }), { netMinor: 0, irtMinor: 0, inssEmployeeMinor: 0, inssEmployerMinor: 0 });
    for (const o of payrollObligations({ period, pack, ...totals, paid: { salaries: run?.paidSalariesAt, irt: run?.paidIrtAt, inss: run?.paidInssAt }, today: luandaDate(new Date()) })) {
      if (!run && period === prior && o.kind === 'salaries') continue;
      obligations.push({ dueDate: o.dueDate, amountMinor: o.amountMinor, kind: o.kind, paid: !!o.paidAt, estimated: run?.status !== 'closed' });
    }
  }
  const expenses = await db.select().from(expenseClaims).where(and(eq(expenseClaims.companyId, companyId), eq(expenseClaims.status, 'approved')));
  for (const e of expenses) obligations.push({ kind: 'expenses', dueDate: `${from}-01`, amountMinor: e.totalMinor, paid: false, estimated: false });
  return { plan: { period: from, openingMinor: plan?.openingMinor ?? 0, receipts: plan?.receipts ?? {}, revision: plan?.revision ?? 0 }, ...personnelCashFlow({ from, openingMinor: plan?.openingMinor ?? 0, receipts: plan?.receipts ?? {}, obligations }), warnings: [...warnings], holidayMonth: data.company.holidaySubsidyMonth ?? 12, canProject: projectionPack(Number(from.slice(0, 4))) !== null };
}
