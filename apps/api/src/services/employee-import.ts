import { ackAudienceIncludes, kz, luandaDate } from '@kianda/core';
import { EMPLOYEE_IMPORT_FIELDS, EMPLOYEE_IMPORT_LIMIT, employeeImportKey, parseEmployeeImport, type EmployeeImportPreview, type EmployeeImportResult } from '@kianda/core/employee-import';
import { ackDocuments, ackRequests, and, auditLogs, companies, compensationChanges, contracts, departments, desc, employees, eq, payrollRuns, type Db } from '@kianda/db';
import { z } from 'zod';
import type { Actor } from '../plugins/tenant.js';
import { assertMinimumWage, createBody, salaryCols } from './employee-input.js';
import { ensureEmployeeCapacity, licenceOf } from './licence.js';
import { tierFor } from '@kianda/core';
import { DomainError } from './payroll.js';
import { xlsx } from '../lib/xlsx.js';

const cell = z.union([z.string().max(1000), z.number().finite(), z.null()]);
export const employeeImportBody = z.object({
  sourceName: z.string().trim().min(1).max(200),
  rows: z.array(z.object({ line: z.number().int().min(1).max(1_000_000), values: z.partialRecord(z.enum(EMPLOYEE_IMPORT_FIELDS.map(f => f.key)), cell) }).strict()).min(1).max(EMPLOYEE_IMPORT_LIMIT)
    .refine(rows => new Set(rows.map(r => r.line)).size === rows.length, 'Os números de linha têm de ser únicos.'),
  options: z.object({ salaryEffectiveDate: z.iso.date(), defaultContractType: z.enum(['indefinite', 'fixed_term', 'internship']), defaultCurrency: z.enum(['AOA', 'USD']), usdRate: z.number().positive().max(1_000_000).optional(), createDepartments: z.boolean(), skipExisting: z.boolean(), dateSystem: z.enum(['1900', '1904']).default('1900') }).strict(),
}).strict();
export const employeeImportCommitBody = employeeImportBody.extend({ importId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), confirm: z.literal(true) });
type Input = z.infer<typeof employeeImportBody>;
type CommitInput = z.infer<typeof employeeImportCommitBody>;
const chunks = <T>(items: T[], n = 200): T[][] => Array.from({ length: Math.ceil(items.length / n) }, (_, i) => items.slice(i * n, (i + 1) * n));
async function fingerprint(input: Input) {
  const canonical = [input.sourceName, input.options, input.rows.map(row => [row.line, EMPLOYEE_IMPORT_FIELDS.map(f => row.values[f.key] ?? null)])];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)));
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function previewEmployeeImport(db: Db, actor: Actor, input: Input): Promise<EmployeeImportPreview> {
  const parsed = parseEmployeeImport(input.rows, input.options);
  const [lic, existing, depts, closed] = await Promise.all([
    licenceOf(db, actor.companyId),
    db.select({ number: employees.number, nif: employees.nif, biNumber: employees.biNumber, inssNumber: employees.inssNumber, id: employees.id }).from(employees).where(eq(employees.companyId, actor.companyId)),
    db.select().from(departments).where(eq(departments.companyId, actor.companyId)),
    db.select({ period: payrollRuns.period }).from(payrollRuns).where(and(eq(payrollRuns.companyId, actor.companyId), eq(payrollRuns.status, 'closed'))).orderBy(desc(payrollRuns.period)).limit(1),
  ]);
  const ids = new Map<string, Set<string>>();
  for (const e of existing) for (const field of ['number', 'nif', 'biNumber', 'inssNumber'] as const) if (e[field]) {
    const key = field + ':' + employeeImportKey(e[field]!), group = ids.get(key) ?? new Set<string>(); group.add(e.id); ids.set(key, group);
  }
  const departmentMap = new Map<string, typeof depts>();
  for (const d of depts) { const key = employeeImportKey(d.name); departmentMap.set(key, [...(departmentMap.get(key) ?? []), d]); }
  const newDepartments = new Map<string, { name: string; costCenter: string }>();
  const centers = new Map<string, Set<string>>();
  for (const r of parsed) if (r.data.department && r.data.costCenter) { const key = employeeImportKey(r.data.department), values = centers.get(key) ?? new Set<string>(); values.add(r.data.costCenter); centers.set(key, values); }
  const rows: EmployeeImportPreview['rows'] = parsed.map(row => {
    const { data, errors, warnings } = row;
    const matches = new Set<string>();
    for (const field of ['number', 'nif', 'biNumber', 'inssNumber'] as const) if (data[field]) for (const id of ids.get(field + ':' + employeeImportKey(data[field]!)) ?? []) matches.add(id);
    if (matches.size > 1) errors.push('Os identificadores correspondem a fichas diferentes. Reveja o número, NIF, BI e INSS.');
    else if (matches.size === 1 && !input.options.skipExisting) errors.push('Já existe uma ficha com este número, NIF, BI ou INSS. Pode optar por ignorar existentes.');
    if (matches.size === 1 && input.options.skipExisting) {
      const duplicateErrors = errors.filter(e => e.includes('repetido no ficheiro'));
      return { ...row, errors: duplicateErrors, warnings: ['Ficha existente: os campos do ficheiro não serão aplicados.'], status: duplicateErrors.length ? 'error' : 'skipped' };
    }
    const validation = createBody.safeParse({ ...data, departmentId: null });
    if (!validation.success) for (const issue of validation.error.issues) errors.push(issue.path.join('.') + ': ' + issue.message);
    if (data.salaryEffectiveDate > luandaDate(new Date())) errors.push('A data de efeito da remuneração importada não pode estar no futuro.');
    if (closed[0] && data.salaryEffectiveDate.slice(0, 7) <= closed[0].period) errors.push('O processamento de ' + closed[0].period + ' já está fechado. Indique uma data de efeito posterior.');
    try { assertMinimumWage(kz(data.contract.base), data.contract.type, data.salaryEffectiveDate); } catch (e) { errors.push(e instanceof Error ? e.message : 'Remuneração inválida.'); }
    if (data.department) {
      const key = employeeImportKey(data.department), found = departmentMap.get(key) ?? [];
      if (!key) errors.push('Departamento inválido.');
      else if (found.length > 1) errors.push('O nome do departamento é ambíguo. Corrija os departamentos antes da importação.');
      else if (!found.length && !input.options.createDepartments) errors.push('Departamento por criar: ' + data.department + '. Active a criação de departamentos ou ajuste o ficheiro.');
      else if (!found.length) {
        const prior = newDepartments.get(key), known = centers.get(key) ?? new Set<string>();
        if (known.size > 1) errors.push('O mesmo departamento tem centros de custo diferentes no ficheiro.');
        else if (!prior) newDepartments.set(key, { name: data.department, costCenter: [...known][0] ?? 'IMP-' + String(newDepartments.size + 1).padStart(3, '0') });
        if (!known.size) warnings.push('Departamento novo com centro de custo provisório; reveja-o em Configuração.');
      } else if (data.costCenter && found[0]!.costCenter !== data.costCenter) warnings.push('Mantém-se o centro de custo do departamento já existente.');
    }
    return { ...row, errors: [...new Set(errors)], warnings: [...new Set(warnings)], status: errors.length ? 'error' : matches.size ? 'skipped' : 'ready' };
  });
  const used = new Set(rows.filter(r => r.status === 'ready' && r.data.department).map(r => employeeImportKey(r.data.department!)));
  const ready = rows.filter(r => r.status === 'ready').length, issues: string[] = [];
  const trialGrows = lic.limit !== null && lic.activeEmployees + ready > lic.limit && lic.status === 'trial' && lic.tier.key !== 'custom';
  if (lic.limit !== null && lic.activeEmployees + ready > lic.limit && !trialGrows) issues.push('A licença permite ' + lic.limit + ' colaboradores activos. Existem ' + lic.activeEmployees + ' e o ficheiro acrescentaria ' + ready + '. Escolha a faixa adequada em Módulos e licenças antes de importar.');
  if (!ready) issues.push('Não existem colaboradores novos e válidos para importar.');
  return { fingerprint: await fingerprint(input), sourceName: input.sourceName, canImport: !issues.length && !rows.some(r => r.status === 'error'), issues,
    counts: { total: rows.length, ready, skipped: rows.filter(r => r.status === 'skipped').length, errors: rows.filter(r => r.status === 'error').length, warnings: rows.filter(r => r.warnings.length).length },
    licence: { limit: lic.limit, activeEmployees: lic.activeEmployees, ...(trialGrows ? { notice: `Durante a avaliação gratuita, a faixa passa a «${tierFor(lic.activeEmployees + ready).label}» ao importar; o preço dessa faixa só se aplica quando escolher a subscrição.` } : {}) }, newDepartments: [...newDepartments].filter(([key]) => used.has(key)).map(([, d]) => d), rows };
}
export async function commitEmployeeImport(db: Db, actor: Actor, input: CommitInput): Promise<EmployeeImportResult> {
  return db.transaction(async tx => {
    const t = tx as unknown as Db;
    await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, actor.companyId)).for('update');
    const hash = await fingerprint(input);
    const [previous] = await tx.select({ after: auditLogs.after }).from(auditLogs).where(and(eq(auditLogs.companyId, actor.companyId), eq(auditLogs.entity, 'employee_import'), eq(auditLogs.entityId, input.importId), eq(auditLogs.action, 'import')));
    if (previous) {
      const saved = previous.after as { fingerprint: string; result: EmployeeImportResult };
      if (saved.fingerprint !== hash) throw new DomainError('importacao_diferente', 'Esta confirmação já foi utilizada para outro conteúdo. Valide de novo o ficheiro.', 409);
      return { ...saved.result, replayed: true };
    }
    if (hash !== input.fingerprint) throw new DomainError('importacao_alterada', 'O ficheiro ou os pressupostos mudaram. Volte a validar antes de confirmar.', 409);
    const preview = await previewEmployeeImport(t, actor, input);
    if (!preview.canImport) throw new DomainError('importacao_invalida', 'A validação detectou erros, duplicados ou um limite de licença. Volte a validar e corrija os pontos indicados.', 409);
    // Em avaliação, a faixa acompanha a equipa importada (ver ensureEmployeeCapacity).
    if (!(await ensureEmployeeCapacity(t, actor.companyId, preview.counts.ready, actor.actorId)).ok) throw new DomainError('limite_colaboradores', 'A licença não comporta os colaboradores a importar. Escolha a faixa adequada em Módulos e licenças.', 402);
    const departmentRows = await tx.select().from(departments).where(eq(departments.companyId, actor.companyId));
    const departmentIds = new Map(departmentRows.map(d => [employeeImportKey(d.name), d.id]));
    if (preview.newDepartments.length) {
      const created = await tx.insert(departments).values(preview.newDepartments.map(d => ({ ...d, companyId: actor.companyId }))).returning();
      for (const d of created) departmentIds.set(employeeImportKey(d.name), d.id);
    }
    const prepared = preview.rows.filter(r => r.status === 'ready').map(row => ({ row, employeeId: crypto.randomUUID(), contractId: crypto.randomUUID() }));
    for (const group of chunks(prepared)) {
      await tx.insert(employees).values(group.map(({ row: { data }, employeeId }) => {
        const { department, costCenter: _cost, contract: _contract, salaryEffectiveDate: _date, ...personal } = data;
        return { ...personal, id: employeeId, companyId: actor.companyId, departmentId: department ? departmentIds.get(employeeImportKey(department))! : null };
      }));
      await tx.insert(contracts).values(group.map(({ row: { data }, employeeId, contractId }) => ({ id: contractId, employeeId, salaryKnownFrom: data.salaryEffectiveDate, type: data.contract.type, startDate: data.contract.startDate, endDate: data.contract.endDate, termJustification: data.contract.termJustification, baseMinor: kz(data.contract.base), mealMinor: kz(data.contract.meal), transportMinor: kz(data.contract.transport), ...salaryCols(data.contract) })));
      await tx.insert(compensationChanges).values(group.map(({ row: { data }, employeeId, contractId }) => ({ companyId: actor.companyId, employeeId, contractId, effectiveDate: data.salaryEffectiveDate, baseMinor: kz(data.contract.base), mealMinor: kz(data.contract.meal), transportMinor: kz(data.contract.transport), ...salaryCols(data.contract), reason: 'Migração inicial de colaboradores', createdBy: actor.actorId })));
    }
    // Migração de vínculos existentes: sem acolhimento retroactivo nem criação automática de contas/convites.
    const published = await tx.select().from(ackDocuments).where(and(eq(ackDocuments.companyId, actor.companyId), eq(ackDocuments.status, 'published')));
    for (const doc of published) {
      const recipients = prepared.filter(p => ackAudienceIncludes(doc.audience, { id: p.employeeId, departmentId: p.row.data.department ? departmentIds.get(employeeImportKey(p.row.data.department))! : null }));
      for (const group of chunks(recipients)) await tx.insert(ackRequests).values(group.map(p => ({ companyId: actor.companyId, documentId: doc.id, employeeId: p.employeeId }))).onConflictDoNothing();
    }
    const result: EmployeeImportResult = { importId: input.importId, created: prepared.length, skipped: preview.counts.skipped, departmentsCreated: preview.newDepartments.length, replayed: false };
    await tx.insert(auditLogs).values({ companyId: actor.companyId, actorId: actor.actorId, action: 'import', entity: 'employee_import', entityId: input.importId,
      after: { fingerprint: hash, sourceName: input.sourceName, result, employees: prepared.map(p => ({ id: p.employeeId, line: p.row.line })) } });
    return result;
  });
}
/** Modelo de entrada sem dados de negócio; disponível também no período experimental. */
export function employeeImportTemplate(): Uint8Array {
  return xlsx([
    { name: 'Colaboradores', header: true, widths: EMPLOYEE_IMPORT_FIELDS.map(f => f.key === 'name' ? 35 : 24), rows: [EMPLOYEE_IMPORT_FIELDS.map(f => f.label)] },
    { name: 'Orientações', header: true, widths: [30, 110], rows: [['Campo', 'Orientação'],
      ['Utilização', 'Preencha a primeira folha ou carregue directamente o seu Excel e associe as colunas no Kianda. Até 5.000 colaboradores por ficheiro.'],
      ['Obrigatórios', 'N.º mecanográfico, Nome completo, Função, Data de admissão e Salário base. Uma linha por vínculo em vigor.'],
      ['Identificadores', 'Formate N.º mecanográfico, BI, NIF, INSS e IBAN como Texto antes de preencher. Preserve zeros iniciais e todos os dígitos.'],
      ['Datas', 'Use AAAA-MM-DD ou DD/MM/AAAA. A admissão é a do vínculo original; indique separadamente desde quando vigora o salário importado.'],
      ['Remuneração', 'Salário base bruto, sem somar subsídios nem descontar INSS/IRT. Não use salário líquido. Alimentação e transporte em colunas próprias, em Kz.'],
      ['Moeda', 'AOA/Kz ou USD. Se USD, Salário base é o valor em USD; indique no ecrã o câmbio de referência Kz/USD.'],
      ['Contrato', 'Indeterminado, A termo ou Estágio. A termo exige Fim do contrato e Fundamento do termo. Sem coluna, confirme o tipo comum no ecrã.'],
      ['Departamentos', 'Pode autorizar a criação. Sem Centro de custo é atribuído um código provisório IMP-xxx, que deve rever.'],
      ['Confirmação', 'Reveja erros, duplicados, avisos e licença. Só a confirmação final grava o lote inteiro. Remover o documento antes da confirmação descarta a pré-visualização.'],
      ['Âmbito', 'Importa fichas, contratos e remuneração de referência. Não cria processamentos históricos fechados nem convida automaticamente os colaboradores.'],
    ] },
  ]);
}
