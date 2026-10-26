import 'dotenv/config';
import { DEFAULT_PGC_ACCOUNTS, kz } from '@kianda/core';
import { and, eq } from 'drizzle-orm';
import { accountMappings, closeDb, companies, contracts, departments, employees, getDb } from '../src/index.js';

/** Dados de demonstração: uma empresa fictícia com três departamentos e cinco colaboradores. Idempotente. */
const db = getDb();
const NIF = '5417382910';

let [company] = await db.select().from(companies).where(eq(companies.nif, NIF));
company ??= (await db.insert(companies).values({ name: 'Kwanza Logística & Serviços, Lda.', nif: NIF, inssNumber: '0012457', address: 'Via AL 15, Talatona, Luanda', caeCode: '52' }).returning())[0]!;

const depIds: Record<string, string> = {};
for (const [name, costCenter] of [['Finanças', 'CC-FIN'], ['Recursos Humanos', 'CC-RH'], ['Logística', 'CC-LOG']] as const) {
  const [found] = await db.select().from(departments).where(and(eq(departments.companyId, company.id), eq(departments.name, name)));
  depIds[name] = (found ?? (await db.insert(departments).values({ companyId: company.id, name, costCenter }).returning())[0]!).id;
}

const people = [
  ['1002', 'Edson Kiala Mateus', 'Director Financeiro', 1_850_000, 'indefinite', 'Finanças', null],
  ['1003', 'Joana Cassoma', 'Técnica de Contabilidade', 420_000, 'indefinite', 'Finanças', null],
  ['1005', 'Teresa Mbala', 'Gestora de RH', 980_000, 'indefinite', 'Recursos Humanos', null],
  ['1006', 'Nelson Capitango', 'Técnico de Processamento Salarial', 380_000, 'fixed_term', 'Recursos Humanos', '2026-11-30'],
  ['1009', 'Francisco Muhongo', 'Motorista de Pesados', 185_000, 'fixed_term', 'Logística', '2026-12-15'],
] as const;

for (const [number, name, jobTitle, base, type, dep, end] of people) {
  const [exists] = await db.select().from(employees).where(and(eq(employees.companyId, company.id), eq(employees.number, number)));
  if (exists) continue;
  const [e] = await db.insert(employees).values({ companyId: company.id, number, name, jobTitle, departmentId: depIds[dep], province: 'Luanda' }).returning();
  await db.insert(contracts).values({
    employeeId: e!.id, type, startDate: '2023-01-16', endDate: end,
    baseMinor: kz(base), mealMinor: kz(base >= 1_000_000 ? 45_000 : 30_000), transportMinor: kz(base >= 1_000_000 ? 40_000 : 25_000),
  });
}

for (const [role, account] of Object.entries(DEFAULT_PGC_ACCOUNTS)) {
  await db.insert(accountMappings).values({ companyId: company.id, role, account, label: role }).onConflictDoNothing();
}

console.log(`Empresa de demonstração pronta: ${company.name} (${company.id})`);
await closeDb();
