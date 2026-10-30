/** Identifica as saídas de documentos de negócio; os JSON de consulta permanecem disponíveis. */
export function isDocumentExport(path: string, format: string | undefined): boolean {
  if (/^\/v1\/modeling\/models\/[^/]+\/reports\/[^/]+\/?$/.test(path)) return true;
  if (/^\/v1\/(?:ledger\/export(?:\/mark)?|budgets\/[^/]+\/export|expenses-bank-file)\/?$/.test(path)) return true;
  if (/^\/v1\/payroll-runs\/[^/]+\/bank-file\/?$/.test(path)) return format !== 'json';
  if (/^\/v1\/(?:payroll-runs\/[^/]+\/maps\/(?:agt|irt|inss)|reports\/people|ledger\/trial-balance)\/?$/.test(path)) return ['csv', 'xlsx'].includes(format ?? '');
  return false;
}
