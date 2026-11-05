import { parseAmount, parseDate } from './bank.js';
import { angolanIbanProblem, isValidAngolanBI, normalizeIban } from './validation.js';

export const EMPLOYEE_IMPORT_LIMIT = 5000;
export const EMPLOYEE_IMPORT_FIELDS = [
  { key: 'number', label: 'N.º mecanográfico', required: true, aliases: ['numero', 'numero funcionario', 'numero colaborador', 'codigo funcionario', 'codigo', 'matricula', 'employee number'] },
  { key: 'name', label: 'Nome completo', required: true, aliases: ['nome', 'nome funcionario', 'nome colaborador', 'funcionario', 'colaborador', 'name'] },
  { key: 'jobTitle', label: 'Função', required: true, aliases: ['cargo', 'categoria', 'categoria profissional', 'job title'] },
  { key: 'startDate', label: 'Data de admissão', required: true, aliases: ['admissao', 'data admissao', 'data inicio', 'inicio contrato', 'data entrada'] },
  { key: 'base', label: 'Salário base', required: true, aliases: ['vencimento base', 'remuneracao base', 'salario base bruto', 'salario base kz', 'salario base aoa', 'base salary'] },
  { key: 'department', label: 'Departamento', aliases: ['departamento nome', 'direccao', 'department'] },
  { key: 'costCenter', label: 'Centro de custo', aliases: ['centro custo', 'cost center'] },
  { key: 'type', label: 'Tipo de contrato', aliases: ['contrato', 'tipo contrato'] },
  { key: 'endDate', label: 'Fim do contrato', aliases: ['data fim', 'data fim contrato', 'termo contrato'] },
  { key: 'termJustification', label: 'Fundamento do termo', aliases: ['justificacao termo', 'fundamento contrato'] },
  { key: 'salaryEffectiveDate', label: 'Remuneração desde', aliases: ['data efeito salario', 'data efeito remuneracao', 'salario desde'] },
  { key: 'currency', label: 'Moeda do salário', aliases: ['moeda', 'currency'] },
  { key: 'meal', label: 'Subsídio de alimentação (Kz)', aliases: ['subsidio alimentacao', 'alimentacao', 'sub alimentacao'] },
  { key: 'transport', label: 'Subsídio de transporte (Kz)', aliases: ['subsidio transporte', 'transporte', 'sub transporte'] },
  { key: 'nif', label: 'NIF', aliases: ['numero fiscal', 'numero contribuinte'] },
  { key: 'biNumber', label: 'N.º do BI', aliases: ['bi', 'numero bi', 'bilhete identidade'] },
  { key: 'inssNumber', label: 'N.º INSS', aliases: ['inss', 'numero inss', 'numero segurado', 'nis'] },
  { key: 'iban', label: 'IBAN', aliases: ['nib', 'nba', 'conta bancaria'] },
  { key: 'bank', label: 'Banco', aliases: ['bank'] },
  { key: 'email', label: 'Email', aliases: ['e mail', 'correio electronico'] },
  { key: 'phone', label: 'Telefone', aliases: ['telemovel', 'contacto', 'phone'] },
  { key: 'province', label: 'Província', aliases: ['provincia trabalho'] },
  { key: 'municipality', label: 'Município', aliases: ['municipio trabalho'] },
  { key: 'gender', label: 'Sexo', aliases: ['genero', 'gender'] },
  { key: 'birthDate', label: 'Data de nascimento', aliases: ['nascimento', 'data nascimento'] },
  { key: 'nationality', label: 'Nacionalidade', aliases: ['nationality'] },
  { key: 'maritalStatus', label: 'Estado civil', aliases: ['estado civil'] },
  { key: 'address', label: 'Morada', aliases: ['endereco', 'address'] },
] as const;
export type EmployeeImportField = typeof EMPLOYEE_IMPORT_FIELDS[number]['key'];
export type EmployeeImportCell = string | number | null;
export type EmployeeImportMapping = Partial<Record<EmployeeImportField, number>>;
export interface EmployeeImportSourceRow { line: number; values: Partial<Record<EmployeeImportField, EmployeeImportCell>> }
export interface EmployeeImportOptions {
  salaryEffectiveDate: string; defaultContractType: 'indefinite' | 'fixed_term' | 'internship';
  defaultCurrency: 'AOA' | 'USD'; usdRate?: number; createDepartments: boolean; skipExisting: boolean; dateSystem?: '1900' | '1904';
}
export interface ImportedEmployee {
  number: string; name: string; jobTitle: string; department: string | null; costCenter: string | null; salaryEffectiveDate: string;
  nif: string | null; biNumber: string | null; inssNumber: string | null; iban: string | null;
  bank: string | null; email: string | null; phone: string | null; province: string | null; municipality: string | null;
  gender: 'F' | 'M' | null; birthDate: string | null; nationality: string | null; maritalStatus: string | null; address: string | null;
  contract: { type: 'indefinite' | 'fixed_term' | 'internship'; startDate: string; endDate: string | null; termJustification: string | null; base: number; meal: number; transport: number; currency: 'AOA' | 'USD'; baseUsd?: number };
}
export interface EmployeeImportParsedRow { line: number; data: ImportedEmployee; errors: string[]; warnings: string[] }
export interface EmployeeImportPreview {
  fingerprint: string; canImport: boolean; sourceName: string; issues: string[];
  counts: { total: number; ready: number; skipped: number; errors: number; warnings: number };
  licence: { activeEmployees: number; limit: number | null }; newDepartments: { name: string; costCenter: string }[];
  rows: (EmployeeImportParsedRow & { status: 'ready' | 'skipped' | 'error' })[];
}
export interface EmployeeImportResult { importId: string; created: number; skipped: number; departmentsCreated: number; replayed: boolean }
export const employeeImportKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function guessEmployeeImportMapping(headers: string[]): EmployeeImportMapping {
  const mapping: EmployeeImportMapping = {};
  for (const field of EMPLOYEE_IMPORT_FIELDS) {
    const labels = [field.label, field.key, ...field.aliases].map(employeeImportKey);
    const index = headers.findIndex((h, i) => labels.includes(employeeImportKey(h)) && !Object.values(mapping).includes(i));
    if (index >= 0) mapping[field.key] = index;
  }
  return mapping;
}
export function employeeImportMappingProblem(mapping: EmployeeImportMapping): string | null {
  const missing = EMPLOYEE_IMPORT_FIELDS.filter(f => 'required' in f && mapping[f.key] === undefined);
  if (missing.length) return 'Associe as colunas obrigatórias: ' + missing.map(f => f.label).join(', ') + '.';
  const columns = Object.values(mapping);
  return new Set(columns).size === columns.length ? null : 'A mesma coluna não pode preencher dois campos.';
}
export function employeeImportSourceRows(grid: EmployeeImportCell[][], headerRow: number, mapping: EmployeeImportMapping): EmployeeImportSourceRow[] {
  const problem = employeeImportMappingProblem(mapping); if (problem) throw new Error(problem);
  const headers = (grid[headerRow] ?? []).map(v => employeeImportKey(String(v ?? '')));
  return grid.slice(headerRow + 1).flatMap((row, i) => {
    if (!row.some(v => v !== null && String(v).trim() !== '')) return [];
    if (row.every((v, c) => employeeImportKey(String(v ?? '')) === (headers[c] ?? ''))) return [];
    return [{ line: headerRow + i + 2, values: Object.fromEntries(Object.entries(mapping).map(([key, col]) => [key, row[col!] ?? null])) }];
  });
}
export function parseEmployeeImport(rows: EmployeeImportSourceRow[], options: EmployeeImportOptions): EmployeeImportParsedRow[] {
  const parsed = rows.map(({ line, values: v }) => {
    const errors: string[] = [], warnings: string[] = [];
    const value = (key: EmployeeImportField) => String(v[key] ?? '').trim();
    const optional = (key: EmployeeImportField) => value(key) || null;
    const money = (key: 'base' | 'meal' | 'transport') => {
      const raw = v[key];
      if ((raw === null || raw === undefined || raw === '') && key !== 'base') return 0;
      const minor = typeof raw === 'number' ? Math.round(raw * 100) : parseAmount(String(raw ?? ''));
      if (minor === null || !Number.isSafeInteger(minor) || minor < 0) { errors.push(EMPLOYEE_IMPORT_FIELDS.find(f => f.key === key)!.label + ': valor inválido ou negativo.'); return 0; }
      return minor / 100;
    };
    const date = (key: 'startDate' | 'endDate' | 'birthDate' | 'salaryEffectiveDate') => {
      if (!value(key)) return null;
      const raw = v[key];
      const input = typeof raw === 'number' && options.dateSystem === '1904' ? String(Math.floor(raw) + 1462) : typeof raw === 'number' ? String(Math.floor(raw)) : value(key);
      const validText = /^\d{5}$/.test(input) || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:T[\d:.Z+-]+| \d{2}:[\d:]+)?$/.test(input) || /^\d{1,2}[-/.]\d{1,2}[-/.](?:\d{2}|\d{4})$/.test(input);
      const d = validText ? parseDate(input) : null;
      if (!d || d < '1900-01-01' || d > '2199-12-31') errors.push(EMPLOYEE_IMPORT_FIELDS.find(f => f.key === key)!.label + ': data inválida.');
      return d;
    };
    const kinds: Record<string, ImportedEmployee['contract']['type']> = { INDEFINITE: 'indefinite', INDETERMINADO: 'indefinite', TEMPOINDETERMINADO: 'indefinite', SEMTERMO: 'indefinite', FIXEDTERM: 'fixed_term', ATERMO: 'fixed_term', TERMOCERTO: 'fixed_term', PRAZOCERTO: 'fixed_term', INTERNSHIP: 'internship', ESTAGIO: 'internship' };
    const type = value('type') ? kinds[employeeImportKey(value('type'))] : options.defaultContractType;
    if (!type) errors.push('Tipo de contrato não reconhecido. Use Indeterminado, A termo ou Estágio.');
    const currencies: Record<string, 'AOA' | 'USD'> = { AOA: 'AOA', KZ: 'AOA', AKZ: 'AOA', KWANZA: 'AOA', KWANZAS: 'AOA', USD: 'USD', DOLAR: 'USD', DOLARES: 'USD' };
    const currency = value('currency') ? currencies[employeeImportKey(value('currency'))] : options.defaultCurrency;
    if (!currency) errors.push('Moeda não reconhecida. Use AOA/Kz ou USD.');
    let base = money('base'); const baseUsd = currency === 'USD' ? base : undefined;
    if (currency === 'USD') {
      if (!options.usdRate || !Number.isFinite(options.usdRate) || options.usdRate <= 0) errors.push('Indique o câmbio de referência Kz por USD.');
      else base = Math.round(base * options.usdRate * 100) / 100;
    }
    if (!Number.isSafeInteger(Math.round(base * 100))) errors.push('O salário convertido excede o limite permitido.');
    const startDate = date('startDate'); if (!startDate) errors.push('Indique a data de admissão.');
    const endDate = date('endDate'), salaryEffectiveDate = date('salaryEffectiveDate') ?? options.salaryEffectiveDate;
    if (startDate && salaryEffectiveDate < startDate) errors.push('A remuneração não pode ter efeito antes da admissão.');
    if (endDate && salaryEffectiveDate > endDate) errors.push('O contrato já terminou na data de efeito da remuneração. Importe apenas vínculos em vigor.');
    const genders: Record<string, 'F' | 'M'> = { F: 'F', FEMININO: 'F', M: 'M', MASCULINO: 'M' };
    const gender = value('gender') ? genders[employeeImportKey(value('gender'))] : null;
    if (value('gender') && !gender) errors.push('Sexo: use F ou M.');
    const data: ImportedEmployee = { number: value('number'), name: value('name'), jobTitle: value('jobTitle'), department: optional('department'), costCenter: optional('costCenter'), salaryEffectiveDate,
      nif: optional('nif')?.toUpperCase() ?? null, biNumber: optional('biNumber')?.toUpperCase() ?? null, inssNumber: optional('inssNumber'), iban: optional('iban') ? normalizeIban(value('iban')) : null,
      bank: optional('bank'), email: optional('email'), phone: optional('phone'), province: optional('province'), municipality: optional('municipality'), gender: gender ?? null, birthDate: date('birthDate'), nationality: optional('nationality'), maritalStatus: optional('maritalStatus'), address: optional('address'),
      contract: { type: type ?? 'indefinite', startDate: startDate ?? '', endDate, termJustification: optional('termJustification'), base, meal: money('meal'), transport: money('transport'), currency: currency ?? 'AOA', ...(baseUsd === undefined ? {} : { baseUsd }) },
    };
    for (const f of EMPLOYEE_IMPORT_FIELDS) {
      if (value(f.key).length > 200) errors.push(f.label + ': máximo de 200 caracteres.');
      const raw = v[f.key];
      if (['number', 'nif', 'inssNumber', 'iban', 'biNumber'].includes(f.key) && typeof raw === 'number' && !Number.isSafeInteger(raw)) errors.push(f.label + ': o Excel perdeu precisão. Volte à origem e use texto para este identificador.');
    }
    if (!data.number) errors.push('Indique o n.º mecanográfico.');
    if (data.name.length < 2) errors.push('Indique o nome completo.');
    if (data.jobTitle.length < 2) errors.push('Indique a função.');
    if (data.biNumber && !isValidAngolanBI(data.biNumber)) errors.push('BI com formato inválido.');
    if (data.iban) { const p = angolanIbanProblem(data.iban); if (p) errors.push(p); }
    if (data.contract.type === 'fixed_term' && (!endDate || !data.contract.termJustification)) errors.push('Contrato a termo exige data de fim e fundamento do termo.');
    if (startDate && endDate && endDate <= startDate) errors.push('O fim do contrato tem de ser posterior à admissão.');
    if (!data.nif) warnings.push('NIF por preencher.');
    if (!data.inssNumber) warnings.push('N.º INSS por preencher.');
    if (!data.iban) warnings.push('IBAN por preencher antes de gerar o ficheiro bancário.');
    return { line, data, errors, warnings };
  });
  const seen = new Map<string, EmployeeImportParsedRow>();
  for (const row of parsed) for (const field of ['number', 'nif', 'biNumber', 'inssNumber'] as const) {
    const value = row.data[field]; if (!value) continue;
    const key = field + ':' + employeeImportKey(value), prior = seen.get(key);
    if (prior) {
      const label = EMPLOYEE_IMPORT_FIELDS.find(f => f.key === field)!.label;
      row.errors.push(label + ' repetido no ficheiro (linha ' + prior.line + ').');
      prior.errors.push(label + ' repetido no ficheiro (linha ' + row.line + ').');
    } else seen.set(key, row);
  }
  return parsed;
}
