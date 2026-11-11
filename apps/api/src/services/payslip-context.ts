import { ABSENCE_POLICIES, labourRules, lastDayOfMonth, TERMINATION_REASONS, workingDaysByYear, type AbsenceType, type TerminationReason } from '@kianda/core';
import { absences, and, asc, companies, contracts, departments, employees, eq, gte, inArray, lte, terminations, type Db, type PayslipContext } from '@kianda/db';
import { groupBy } from '../lib/group-by.js';

/** Os recibos fechados conservam os dados impressos mesmo que a ficha ou as ocorrências sejam alteradas. */
export async function payslipContexts(db: Db, companyId: string, period: string, employeeIds: string[]) {
  const [company] = await db.select({ name: companies.name, nif: companies.nif, inssNumber: companies.inssNumber, address: companies.address })
    .from(companies).where(eq(companies.id, companyId));
  const people = await db.select({
    id: employees.id, name: employees.name, number: employees.number, jobTitle: employees.jobTitle,
    department: departments.name, nif: employees.nif, biNumber: employees.biNumber,
    inssNumber: employees.inssNumber, iban: employees.iban, bank: employees.bank,
  }).from(employees).leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(employees.companyId, companyId), inArray(employees.id, employeeIds)));

  const from = `${period}-01`, to = lastDayOfMonth(period);
  const leave = groupBy(await db.select({ employeeId: absences.employeeId, type: absences.type, startDate: absences.startDate, endDate: absences.endDate })
    .from(absences).where(and(eq(absences.companyId, companyId), inArray(absences.employeeId, employeeIds), eq(absences.status, 'approved'),
      lte(absences.startDate, to), gte(absences.endDate, from))).orderBy(asc(absences.startDate), asc(absences.id)), row => row.employeeId);
  const terms = new Map((await db.select({ term: terminations, hireDate: contracts.startDate })
    .from(terminations).leftJoin(contracts, eq(contracts.id, terminations.contractId))
    .where(and(eq(terminations.companyId, companyId), inArray(terminations.employeeId, employeeIds), eq(terminations.period, period),
      eq(terminations.status, 'confirmed')))).map(row => [row.term.employeeId, row]));

  return new Map(people.map(({ id, biNumber, ...person }): [string, PayslipContext] => {
    const term = terms.get(id);
    const proposal = term?.term.proposal as { seniority?: { label?: string } } | undefined;
    return [id, {
      company: company!,
      employee: { ...person, nif: person.nif ?? biNumber },
      leave: (leave.get(id) ?? []).map(a => {
        const startDate = a.startDate < from ? from : a.startDate, endDate = a.endDate > to ? to : a.endDate;
        const workingDays = Object.values(workingDaysByYear(startDate, endDate, y => labourRules('AO', y))).reduce((sum, days) => sum + days, 0);
        return { type: a.type, label: ABSENCE_POLICIES[a.type as AbsenceType]?.label ?? a.type, startDate, endDate, workingDays };
      }),
      termination: term ? {
        reasonLabel: TERMINATION_REASONS[term.term.reason as TerminationReason]?.label ?? term.term.reason,
        hireDate: term.hireDate, noticeDate: term.term.noticeDate, effectiveDate: term.term.effectiveDate,
        seniority: proposal?.seniority?.label ?? null,
      } : null,
    }];
  }));
}
