import { deleteObjects, r2KeysOf } from './storage.js';
import { sql, type Db } from '@kianda/db';

/**
 * Protecção de dados (Lei n.º 22/11): portabilidade (exportação), minimização e eliminação.
 *
 * Tabelas com dados de uma empresa: as que têm company_id e as "filhas" que pertencem à empresa pela tabela-mãe.
 * A ordem de PURGE respeita as chaves estrangeiras (filhas primeiro); um teste confirma que nenhuma tabela com
 * company_id fica de fora.
 */
type Scope = { table: string; via?: { column: string; parent: string } };

export const COMPANY_TABLES_PURGE_ORDER: Scope[] = [
  { table: 'financial_model_versions' }, { table: 'modeling_members' }, { table: 'financial_personnel_imports' }, { table: 'financial_historical_inputs' }, { table: 'financial_models' }, { table: 'company_modules' },
  { table: 'candidate_events', via: { column: 'candidate_id', parent: 'candidates' } },
  { table: 'candidates' }, { table: 'job_openings' },
  { table: 'reviews' }, { table: 'review_cycles' },
  { table: 'expense_lines', via: { column: 'claim_id', parent: 'expense_claims' } },
  { table: 'expense_claims' },
  { table: 'bank_lines' }, { table: 'bank_matches' }, { table: 'bank_statements' },
  { table: 'journal_lines', via: { column: 'entry_id', parent: 'journal_entries' } },
  { table: 'journal_entries' },
  { table: 'payroll_lines', via: { column: 'run_id', parent: 'payroll_runs' } },
  { table: 'payroll_payments' }, { table: 'payroll_runs' }, { table: 'payroll_variables' },
  { table: 'terminations' }, { table: 'issued_documents' }, { table: 'document_templates' }, { table: 'document_requests' }, { table: 'profile_change_requests' },
  { table: 'employee_allowances' }, { table: 'allowance_types' }, { table: 'work_schedules' },
  { table: 'compensation_changes' },
  { table: 'contracts', via: { column: 'employee_id', parent: 'employees' } },
  { table: 'personnel_budget_lines' }, { table: 'personnel_budgets' },
  { table: 'file_blobs' }, { table: 'files' },
  { table: 'employee_documents' }, { table: 'documents' }, { table: 'absences' }, { table: 'attendance_entries' }, { table: 'attendance_months' },
  { table: 'salary_advances' }, { table: 'access_links' }, { table: 'users' }, { table: 'employees' }, { table: 'departments' },
  { table: 'bank_accounts' }, { table: 'account_mappings' },
  { table: 'gateway_events', via: { column: 'payment_request_id', parent: 'payment_requests' } },
  { table: 'payment_requests' }, { table: 'subscriptions' }, { table: 'outbound_emails' }, { table: 'audit_logs' },
];

/** Colunas que nunca saem numa exportação (segredos de acesso). */
const SECRET_COLUMNS: Record<string, string[]> = {
  users: ['password_hash', 'pin_hash', 'totp_secret'],
  access_links: ['token_hash'],
};
/** Fora da exportação: registos técnicos da plataforma. */
/** O conteúdo dos ficheiros não segue na exportação (só os metadados em files). */
const NOT_EXPORTED = new Set(['gateway_events', 'outbound_emails', 'file_blobs']);

const where = (s: Scope, companyId: string) =>
  s.via
    ? sql`${sql.identifier(s.via.column)} in (select id from ${sql.identifier(s.via.parent)} where company_id = ${companyId})`
    : sql`company_id = ${companyId}`;

/** Todos os dados da empresa, tabela a tabela (JSON), sem segredos de acesso. */
export async function exportCompany(db: Db, companyId: string) {
  const tables: Record<string, unknown[]> = {};
  const [company] = (await db.execute(sql`select * from companies where id = ${companyId}`)).rows;
  for (const s of [...COMPANY_TABLES_PURGE_ORDER].reverse()) {
    if (NOT_EXPORTED.has(s.table)) continue;
    const rows = (await db.execute(sql`select * from ${sql.identifier(s.table)} where ${where(s, companyId)}`)).rows as Record<string, unknown>[];
    const hide = SECRET_COLUMNS[s.table] ?? [];
    tables[s.table] = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.includes(k))));
  }
  return {
    format: 'kianda-export', version: 1, generatedAt: new Date().toISOString(),
    company, counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables,
  };
}

/** Elimina todos os dados da empresa (irreversível). Corre numa transacção: ou sai tudo, ou nada. */
export async function purgeCompany(db: Db, companyId: string) {
  const keys = await r2KeysOf(db, companyId);
  const deleted = await db.transaction(async (tx) => {
    const deleted: Record<string, number> = {};
    for (const s of COMPANY_TABLES_PURGE_ORDER) {
      const r = await tx.execute(sql`delete from ${sql.identifier(s.table)} where ${where(s, companyId)}`);
      if (r.rowCount) deleted[s.table] = r.rowCount;
    }
    const r = await tx.execute(sql`delete from companies where id = ${companyId}`);
    deleted.companies = r.rowCount ?? 0;
    return deleted;
  });
  // Conteúdos no R2: só depois de a transacção confirmar (se falhar, nada foi apagado).
  await deleteObjects(keys);
  return deleted;
}
