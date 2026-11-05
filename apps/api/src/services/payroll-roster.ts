import { compensationAt, lastDayOfMonth } from '@kianda/core';
import { and, asc, compensationChanges, contracts, departments, desc, employees, eq, inArray, lte, isNull, or, type Db } from '@kianda/db';

/** O último contrato iniciado até ao fim do mês decide quem pertence à folha. */
export async function eligiblePayrollStaff(db: Db, companyId: string, period: string) {
  const rows = await db.selectDistinctOn([employees.id], { e: employees, c: contracts }).from(employees)
    .innerJoin(contracts, and(eq(contracts.employeeId, employees.id), lte(contracts.startDate, lastDayOfMonth(period))))
    .where(and(eq(employees.companyId, companyId), inArray(employees.status, ['active', 'terminated']), or(isNull(contracts.salaryKnownFrom), lte(contracts.salaryKnownFrom, lastDayOfMonth(period)))))
    .orderBy(employees.id, desc(contracts.startDate));
  return rows.filter(({ c }) => !(c.terminatedAt ?? c.endDate) || (c.terminatedAt ?? c.endDate)! >= `${period}-01`)
    .sort((a, b) => a.e.number.localeCompare(b.e.number, 'pt', { numeric: true }));
}

export async function payrollRoster(db: Db, companyId: string, period: string) {
  const [staff, changes, depts] = await Promise.all([
    eligiblePayrollStaff(db, companyId, period),
    db.select().from(compensationChanges).where(and(eq(compensationChanges.companyId, companyId), lte(compensationChanges.effectiveDate, lastDayOfMonth(period)))).orderBy(asc(compensationChanges.effectiveDate)),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.companyId, companyId)),
  ]);
  const grouped = new Map<string, typeof changes>();
  for (const c of changes) { const rows = grouped.get(c.employeeId) ?? []; rows.push(c); grouped.set(c.employeeId, rows); }
  return staff.map(({ e, c }) => {
    const pay = compensationAt(grouped.get(e.id) ?? [], lastDayOfMonth(period)) ?? c;
    return { id: e.id, name: e.name, number: e.number, department: depts.find(d => d.id === e.departmentId)?.name ?? null, jobTitle: e.jobTitle,
      baseMinor: pay.baseMinor, mealMinor: pay.mealMinor, transportMinor: pay.transportMinor, salaryCurrency: pay.salaryCurrency,
      baseForeignMinor: pay.baseForeignMinor, startDate: c.startDate, endDate: c.terminatedAt ?? c.endDate };
  });
}
