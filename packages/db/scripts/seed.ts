import 'dotenv/config';
import { ALLOWANCE_PRESETS, DEFAULT_ACCOUNT_MAPPINGS, DEFAULT_COMPETENCIES, kz, SCHEDULE_PRESETS, sectorProfile } from '@kianda/core';
import { and, eq } from 'drizzle-orm';
import { allowanceTypes, workSchedules, absences, accountMappings, bankAccounts, subscriptions, candidateEvents, candidates, expenseClaims, expenseLines, jobOpenings, reviewCycles, reviews, attendanceEntries, closeDb, companies, compensationChanges, contracts, departments, employeeDocuments, employees, getDb, hashPassword, users, verifyPassword } from '../src/index.js';

/** Dados de demonstração: empresa fictícia com três departamentos, cinco colaboradores, hierarquia e documentos. Idempotente. */
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
  ['1003', 'Joana Cassoma', 'Técnica de Contabilidade', 360_000, 'indefinite', 'Finanças', null],
  ['1005', 'Teresa Mbala', 'Gestora de RH', 980_000, 'indefinite', 'Recursos Humanos', null],
  ['1006', 'Nelson Capitango', 'Técnico de Processamento Salarial', 380_000, 'fixed_term', 'Recursos Humanos', '2026-11-30'],
  ['1009', 'Francisco Muhongo', 'Motorista de Pesados', 185_000, 'fixed_term', 'Logística', '2026-12-15'],
] as const;

for (const [number, name, jobTitle, base, type, dep, end] of people) {
  const [exists] = await db.select().from(employees).where(and(eq(employees.companyId, company.id), eq(employees.number, number)));
  if (exists) continue;
  const [e] = await db.insert(employees).values({ companyId: company.id, number, name, jobTitle, departmentId: depIds[dep], province: 'Luanda', nationality: 'Angolana' }).returning();
  const [c] = await db.insert(contracts).values({
    employeeId: e!.id, type, startDate: '2023-01-16', endDate: end,
    baseMinor: kz(base), mealMinor: kz(base >= 1_000_000 ? 45_000 : 30_000), transportMinor: kz(base >= 1_000_000 ? 40_000 : 25_000),
  }).returning();
  await db.insert(compensationChanges).values({
    companyId: company.id, employeeId: e!.id, contractId: c!.id, effectiveDate: c!.startDate,
    baseMinor: c!.baseMinor, mealMinor: c!.mealMinor, transportMinor: c!.transportMinor, reason: 'Admissão',
  }).onConflictDoNothing();
}

// IBAN e n.º INSS de demonstração (só se faltarem). IBAN fictícios: código de banco 0000 (inexistente),
// com dígitos de controlo válidos — nunca coincidem com contas reais.
const demoIban = (seq: number) => {
  const body = `00000000${String(seq).padStart(11, '0')}`;
  for (let k = 0; k < 100; k++) {
    const iban = `AO06${body}${String(k).padStart(2, '0')}`;
    const moved = iban.slice(4) + '1024' + '06'; // "AO" → 10 24
    let rem = 0;
    for (const ch of moved) rem = (rem * 10 + Number(ch)) % 97;
    if (rem === 1) return iban;
  }
  throw new Error('IBAN de demonstração');
};
{
  const all = await db.select().from(employees).where(eq(employees.companyId, company.id));
  for (const e of all) {
    const n = Number(e.number) || 0;
    const patch: Partial<typeof employees.$inferInsert> = {};
    if (!e.iban && ['1002', '1003', '1005', '1006', '1009'].includes(e.number)) Object.assign(patch, { iban: demoIban(n), bank: 'Banco de demonstração' });
    if (!e.inssNumber && ['1002', '1003', '1005', '1006', '1009'].includes(e.number)) patch.inssNumber = `9${String(n).padStart(8, '0')}`;
    if (Object.keys(patch).length) await db.update(employees).set(patch).where(eq(employees.id, e.id));
  }
}

// Hierarquia, documentos e um aumento no histórico (só preenche o que faltar).
const byNumber = Object.fromEntries((await db.select().from(employees).where(eq(employees.companyId, company.id))).map((e) => [e.number, e]));
for (const [number, manager] of [['1003', '1002'], ['1006', '1005'], ['1009', '1002']] as const) {
  const e = byNumber[number];
  if (e && !e.managerId && byNumber[manager]) await db.update(employees).set({ managerId: byNumber[manager]!.id }).where(eq(employees.id, e.id));
}
const docs = [
  ['1003', 'bi', '004512398LA041', '2022-05-10', '2032-05-09', 'Arquivo de Identificação de Luanda'],
  ['1009', 'bi', '007733101BE042', '2021-02-01', '2031-01-31', 'Arquivo de Identificação de Benguela'],
  ['1009', 'driving_licence', 'LU-0099812', '2021-11-20', '2026-11-20', 'DNVT'],
] as const;
for (const [number, type, docNumber, issueDate, expiryDate, issuer] of docs) {
  const e = byNumber[number];
  if (!e) continue;
  await db.insert(employeeDocuments).values({ companyId: company.id, employeeId: e.id, type, number: docNumber, issueDate, expiryDate, issuer }).onConflictDoNothing();
  if (type === 'bi' && !e.biNumber) await db.update(employees).set({ biNumber: docNumber }).where(eq(employees.id, e.id));
}
const joana = byNumber['1003'];
if (joana) {
  await db.insert(compensationChanges).values({
    companyId: company.id, employeeId: joana.id, effectiveDate: '2025-01-01', baseMinor: kz(420_000), mealMinor: kz(30_000), transportMinor: kz(25_000), reason: 'Promoção a Técnica de Contabilidade',
  }).onConflictDoNothing();
}

// Licença da empresa de demonstração (sem expiração) e código da empresa.
await db.insert(subscriptions).values({ companyId: company.id, status: 'active', tierKey: 't1', cycle: 'annual', paidUntil: '2099-12-31', notes: 'Empresa de demonstração' }).onConflictDoNothing();
if (!company.code) await db.update(companies).set({ code: 'KWANZA' }).where(eq(companies.id, company.id));

// Sector (transportes e logística) e a sua pré-configuração: regimes de horário e subsídios sugeridos.
if (!company.sector) await db.update(companies).set({ sector: 'transport' }).where(eq(companies.id, company.id));
const profile = sectorProfile(company.sector ?? 'transport');
for (const k of profile.schedules) {
  const s = SCHEDULE_PRESETS[k]!;
  await db.insert(workSchedules).values({ companyId: company.id, name: s.name, kind: s.kind, pattern: s.pattern, note: s.note ?? null, presetKey: s.key, anchorDate: s.kind === 'cycle' ? '2026-01-05' : null }).onConflictDoNothing();
}
for (const k of profile.allowances) {
  const a = ALLOWANCE_PRESETS[k]!;
  await db.insert(allowanceTypes).values({ companyId: company.id, code: a.code, label: a.label, calc: a.calc, valueMinor: a.valueMinor ?? null, bps: a.bps ?? null, inInss: a.inInss, inIrt: a.inIrt, note: a.note ?? null, presetKey: a.key }).onConflictDoNothing();
}

// Conta bancária de salários (IBAN fictício do banco 0000).
const [hasBank] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.companyId, company.id));
if (!hasBank) await db.insert(bankAccounts).values({ companyId: company.id, name: 'Conta de salários', bankName: 'Banco de demonstração', iban: 'AO06000000000000000000000', ledgerAccount: '43.1' });

for (const { role, account, label } of DEFAULT_ACCOUNT_MAPPINGS) {
  await db.insert(accountMappings).values({ companyId: company.id, role, account, label }).onConflictDoNothing();
}

const OWNER_EMAIL = 'admin@kwanzalog.co.ao';
const ownerPassword = process.env.SEED_OWNER_PASSWORD ?? 'Kianda2026demo';
const [owner] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.email, OWNER_EMAIL)));
if (!owner) await db.insert(users).values({ companyId: company.id, email: OWNER_EMAIL, name: 'Teresa Mbala', role: 'owner', passwordHash: await hashPassword(ownerPassword) });

// Utilizadores de demonstração com perfis diferentes (mesma palavra-passe do proprietário).
const demoUsers = [
  ['edson@kwanzalog.co.ao', 'Edson Kiala Mateus', 'manager', '1002'],
  ['joana@kwanzalog.co.ao', 'Joana Cassoma', 'employee', '1003'],
] as const;
for (const [email, name, role, number] of demoUsers) {
  const [u] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.email, email)));
  if (!u && byNumber[number]) await db.insert(users).values({ companyId: company.id, email, name, role, employeeId: byNumber[number]!.id, passwordHash: await hashPassword(ownerPassword) });
}

// As contas de demonstração usam sempre a palavra-passe actual de SEED_OWNER_PASSWORD (se o secret mudar, acompanham).
for (const email of [OWNER_EMAIL, ...demoUsers.map((d) => d[0])]) {
  const [u] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.email, email)));
  if (u && !(await verifyPassword(ownerPassword, u.passwordHash))) {
    await db.update(users).set({ passwordHash: await hashPassword(ownerPassword) }).where(eq(users.id, u.id));
    console.log(`Palavra-passe de demonstração sincronizada: ${email}`);
  }
}

// Ausências de exemplo (só se a empresa ainda não tiver nenhuma).
const [anyAbsence] = await db.select({ id: absences.id }).from(absences).where(eq(absences.companyId, company.id)).limit(1);
if (!anyAbsence) {
  const demo = [
    ['1002', 'vacation', '2026-11-16', '2026-11-27', 10, 'approved', null],
    ['1006', 'vacation', '2026-11-23', '2026-12-04', 10, 'pending', null],
    ['1009', 'sick', '2026-11-03', '2026-11-05', 3, 'approved', 'Atestado médico entregue'],
    ['1003', 'training', '2026-11-19', '2026-11-20', 2, 'approved', 'Formação IRT e INSS 2026'],
    ['1003', 'vacation', '2026-12-21', '2026-12-31', 8, 'pending', 'Natal com a família'],
  ] as const;
  for (const [number, type, startDate, endDate, workingDays, status, reason] of demo) {
    const e = byNumber[number];
    if (e) await db.insert(absences).values({ companyId: company.id, employeeId: e.id, type, startDate, endDate, workingDays, status, reason, decidedAt: status === 'approved' ? new Date() : null });
  }
}

// Registos de ponto de exemplo (Outubro de 2026, dias úteis até ontem), só se a empresa ainda não tiver nenhum.
const [anyPunch] = await db.select({ id: attendanceEntries.id }).from(attendanceEntries).where(eq(attendanceEntries.companyId, company.id)).limit(1);
if (!anyPunch) {
  const at = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - 3_600_000); // hora de Luanda → UTC
  const yesterday = new Date(Date.now() + 3_600_000 - 86_400_000).toISOString().slice(0, 10);
  let seq = 7;
  const rnd = () => { seq = (seq * 9301 + 49297) % 233280; return seq / 233280; }; // determinístico
  const rows: (typeof attendanceEntries.$inferInsert)[] = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, '0')}`;
    if (date > yesterday) break;
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const number of ['1002', '1003', '1005', '1006', '1009']) {
      const e = byNumber[number];
      if (!e) continue;
      const saturdayShift = number === '1009' && wd === 6 && d % 2 === 0; // motorista: sábados alternados
      if ((wd === 0 || wd === 6) && !saturdayShift) continue;
      const inMin = 7 * 60 + 45 + Math.floor(rnd() * 30);
      const outMin = saturdayShift ? 12 * 60 + 30 : 17 * 60 + Math.floor(rnd() * (number === '1002' ? 120 : 40));
      const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const forgot = number === '1006' && d === 14; // saída esquecida: pendência para a chefia corrigir
      if (saturdayShift) {
        rows.push({ companyId: company.id, employeeId: e.id, workDate: date, clockIn: at(date, hm(inMin)), clockOut: at(date, hm(outMin)), source: 'web', createdBy: 'seed' });
      } else {
        rows.push({ companyId: company.id, employeeId: e.id, workDate: date, clockIn: at(date, hm(inMin)), clockOut: at(date, '12:30'), source: 'web', createdBy: 'seed' });
        rows.push({ companyId: company.id, employeeId: e.id, workDate: date, clockIn: at(date, '13:30'), clockOut: forgot ? null : at(date, hm(outMin)), source: 'web', createdBy: 'seed' });
      }
    }
  }
  if (rows.length) await db.insert(attendanceEntries).values(rows);
}

console.log(`Empresa de demonstração pronta: ${company.name} (${company.id})`);
// Diárias de ajudas de custo e uma nota de despesas da Joana à espera da chefia.
if (company.perDiemNationalMinor === null) await db.update(companies).set({ perDiemNationalMinor: kz(15_000), perDiemInternationalMinor: kz(75_000) }).where(eq(companies.id, company.id));
const [anyClaim] = await db.select({ id: expenseClaims.id }).from(expenseClaims).where(eq(expenseClaims.companyId, company.id)).limit(1);
const [joanaUser] = await db.select().from(users).where(and(eq(users.companyId, company.id), eq(users.email, 'joana@kwanzalog.co.ao')));
if (!anyClaim && joana && joanaUser) {
  const d = (offset: number) => new Date(Date.now() + 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);
  const [claim] = await db.insert(expenseClaims).values({
    companyId: company.id, employeeId: joana.id, number: `ND-${d(0).slice(0, 4)}-0001`, title: 'Deslocação ao Lobito — inventário do armazém', tripFrom: d(6), tripTo: d(4),
    status: 'submitted', totalMinor: kz(18_500) + kz(42_000) + kz(37_500), createdBy: joanaUser.id, submittedAt: new Date(),
  }).returning();
  await db.insert(expenseLines).values([
    { claimId: claim!.id, position: 0, kind: 'expense', date: d(6), description: 'Táxi aeroporto', category: 'transport', documentRef: 'RC 0441', amountMinor: kz(18_500) },
    { claimId: claim!.id, position: 1, kind: 'expense', date: d(5), description: 'Hotel, 2 noites', category: 'lodging', documentRef: 'FT 2026/1187', supplierNif: '5417000000', amountMinor: kz(42_000) },
    { claimId: claim!.id, position: 2, kind: 'per_diem', date: d(6), description: 'Ajudas de custo Lobito', zone: 'national', halfDays: 5, rateMinor: kz(15_000), amountMinor: kz(37_500) },
  ]);
}

// Recrutamento: uma vaga publicada com candidatos em várias etapas.
const [anyOpening] = await db.select({ id: jobOpenings.id }).from(jobOpenings).where(eq(jobOpenings.companyId, company.id)).limit(1);
const edson = byNumber['1002'];
if (!anyOpening && edson) {
  const [o] = await db.insert(jobOpenings).values({
    companyId: company.id, title: 'Contabilista sénior', departmentId: depIds['Finanças'], hiringManagerId: edson.id, location: 'Luanda (Talatona)', positions: 1,
    salaryMinMinor: kz(550_000), salaryMaxMinor: kz(750_000), status: 'open', isPublic: true, createdBy: 'seed',
    description: 'Fecho contabilístico mensal segundo o PGC Angola, apuramento de impostos (IRT, IVA, Imposto Industrial) e reporte à direcção financeira.',
    requirements: 'Licenciatura em Contabilidade ou Gestão; 5 anos de experiência; inscrição na OCPCA; domínio de Excel.',
  }).returning();
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  for (const [name, email, source, stage, rating, ago] of [
    ['Mariana Domingos', 'mariana.domingos@exemplo.ao', 'site', 'applied', null, 2],
    ['Paulo Sebastião', 'paulo.sebastiao@exemplo.ao', 'linkedin', 'screening', 3, 6],
    ['Helena Tchissola', 'helena.tchissola@exemplo.ao', 'referral', 'interview', 4, 12],
    ['Rui Kassoma', 'rui.kassoma@exemplo.ao', 'site', 'offer', 5, 20],
  ] as const) {
    const [c] = await db.insert(candidates).values({ companyId: company.id, openingId: o!.id, name, email, phone: '923000000', source, stage, rating, createdAt: day(ago), consentAt: source === 'site' ? day(ago) : null }).returning();
    await db.insert(candidateEvents).values({ candidateId: c!.id, kind: 'stage', toStage: stage, text: 'Dados de demonstração', actorName: 'Kianda', createdAt: day(ago) });
  }
}

// Desempenho: ciclo anual aberto, com auto-avaliações por fazer.
const [anyCycle] = await db.select({ id: reviewCycles.id }).from(reviewCycles).where(eq(reviewCycles.companyId, company.id)).limit(1);
if (!anyCycle) {
  const year = new Date().getFullYear();
  const [cy] = await db.insert(reviewCycles).values({
    companyId: company.id, name: `Avaliação anual ${year}`, periodFrom: `${year}-01-01`, periodTo: `${year}-12-31`, deadline: `${year}-12-15`,
    status: 'open', selfReview: true, competencies: DEFAULT_COMPETENCIES, competencyWeight: 60, createdBy: 'seed', launchedAt: new Date(),
  }).returning();
  const staff = await db.select({ id: employees.id, managerId: employees.managerId }).from(employees).where(and(eq(employees.companyId, company.id), eq(employees.status, 'active')));
  if (staff.length) await db.insert(reviews).values(staff.map((e) => ({ companyId: company.id, cycleId: cy!.id, employeeId: e.id, reviewerEmployeeId: e.managerId, status: 'self' })));
}

console.log(`Acesso: ${OWNER_EMAIL} (proprietário), edson@kwanzalog.co.ao (chefia), joana@kwanzalog.co.ao (colaboradora) / ${owner ? '(palavra-passe já definida)' : ownerPassword}`);
await closeDb();
