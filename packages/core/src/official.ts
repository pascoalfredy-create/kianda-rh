/**
 * Formatos de entrega oficiais (Angola), alinhados com os modelos reais entregues pelo contabilista (27/10/2026):
 * - AGT: "Template IRT A2.1 — Mapa de Remunerações" (32 colunas) e "Novo Template Simplificado IRT" (15 colunas), do
 *   Portal do Contribuinte → Declarações → IRT → Mapa de Remunerações → Upload de Ficheiro. NIF do contribuinte em C1,
 *   período (AAAA-MM) em C2, cabeçalho nas linhas 3–4, dados a partir da linha 5; todos os trabalhadores do mês.
 *   Província por sigla e município pela lista da folha "Auxiliar" do template.
 * - INSS: "Folha de Remuneração Normal" do INSS Virtual (inscrição, nome, categoria, salário base, remunerações
 *   adicionais, total; totais e parcelas de 3% e 8%).
 * - Bancos: ficheiro de salários NOME, NIB, VALOR (regra comum); perfis BFA/BAI opcionais.
 */
import type { Minor } from './money.js';

// ───────────────────────── AGT: mapa mensal de remunerações ─────────────────────────

export { AGT_MUNICIPALITIES, AGT_PROVINCES } from './agt-municipalities.js';
import { AGT_MUNICIPALITIES, AGT_PROVINCES } from './agt-municipalities.js';

/** Template oficial "IRT A2.1 — Mapa de Remunerações" (32 colunas, linha 4; dados a partir da linha 5). */
export const AGT_MAP_COLUMNS = [
  'NIF Trabalhador', 'Nome', 'Nº Segurança Social', 'Província', 'Município', 'Salário Base', 'Descontos por Falta',
  // H–L: Subsídios Não Sujeitos a IRT (Art. 2.º do CIRT)
  'Subsídio Alimentação', 'Subsídio Transporte', 'Abono Família', 'Reembolso de Despesas', 'Outros',
  'Cálculo Manual de Excesso de Subsídios?', 'Excesso Subsídios Não Sujeitos',
  // O–X: Subsídios Sujeitos a IRT
  'Abono de Falhas', 'Subsídio Renda de Casa', 'Compensação Por Rescisão', 'Subsídio de Férias', 'Horas Extras', 'Subsídio de Atavio',
  'Subsídio de Representação', 'Prémios', 'Subsídio de Natal', 'Outros Subsídios Sujeitos',
  'Salário Ilíquido', 'Registo Manual de Contribuição Segurança Social?', 'Base Tributável Segurança Social', 'Não Sujeito a Segurança Social?',
  'Contribuição Segurança Social', 'Base Tributável IRT', 'Isento IRT?', 'IRT Apurado',
] as const;
export type AgtColumn = (typeof AGT_MAP_COLUMNS)[number];
/** Grupos da linha 3 do template (células fundidas). */
export const AGT_NON_SUBJECT: AgtColumn[] = ['Subsídio Alimentação', 'Subsídio Transporte', 'Abono Família', 'Reembolso de Despesas', 'Outros'];
export const AGT_SUBJECT: AgtColumn[] = ['Abono de Falhas', 'Subsídio Renda de Casa', 'Compensação Por Rescisão', 'Subsídio de Férias', 'Horas Extras', 'Subsídio de Atavio', 'Subsídio de Representação', 'Prémios', 'Subsídio de Natal', 'Outros Subsídios Sujeitos'];
const FLAG_COLUMNS = new Set<string>(['Cálculo Manual de Excesso de Subsídios?', 'Registo Manual de Contribuição Segurança Social?', 'Não Sujeito a Segurança Social?', 'Isento IRT?']);
const TEXT_COLUMNS = new Set<string>(['NIF Trabalhador', 'Nome', 'Nº Segurança Social', 'Província', 'Município', ...FLAG_COLUMNS]);
export const AGT_MONEY_COLUMNS = new Set<number>(AGT_MAP_COLUMNS.map((c, i) => (TEXT_COLUMNS.has(c) ? -1 : i)).filter((i) => i >= 0));

/** Template "Novo Template Simplificado IRT — Mapa de Remunerações" (15 colunas). */
export const AGT_SIMPLE_COLUMNS = [
  'NIF Trabalhador', 'Nome', 'Nº Segurança Social', 'Província', 'Município', 'Salário Base', 'Subsídios Não Sujeitos a IRT', 'Subsídios Sujeitos a IRT',
  'Salário Ilíquido', 'Base Tributável Segurança Social', 'Não Sujeito a Segurança Social?', 'Contribuição Segurança Social', 'Base Tributável IRT', 'Isento IRT?', 'IRT Apurado',
] as const;
export const AGT_SIMPLE_MONEY_COLUMNS = new Set<number>([5, 6, 7, 8, 9, 11, 12, 14]);

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Sigla da AGT a partir do nome (ou da sigla). As províncias da divisão de 2024 entram pela de origem — a lista oficial
 * de municípios do template ainda é a de 18 províncias (ex.: Icolo e Bengo é município de Luanda).
 */
const NEW_PROVINCES: Record<string, string> = { cuando: 'CC', cubango: 'CC', 'icolo e bengo': 'LA', 'moxico leste': 'MO' };
export function agtProvince(name: string | null | undefined): { code: string; provisional?: boolean } | null {
  if (!name) return null;
  const n = norm(name);
  const code = Object.entries(AGT_PROVINCES).find(([k, v]) => k.toLowerCase() === n || norm(v) === n)?.[0];
  if (code) return { code };
  return NEW_PROVINCES[n] ? { code: NEW_PROVINCES[n]!, provisional: true } : null;
}
/** Grafia oficial do município (lista do template) — null se não pertence à província. */
export function agtMunicipality(provinceCode: string, name: string | null | undefined): string | null {
  if (!name) return null;
  const n = norm(name);
  return AGT_MUNICIPALITIES[provinceCode]?.find((m) => norm(m) === n) ?? null;
}

type BreakdownLine = { code: string; kind: string; amountMinor: number };

export interface AgtMapInput {
  nif: string; name: string; inssNumber: string; province: string; municipality: string;
  breakdown: BreakdownLine[]; grossMinor: Minor; inssBaseMinor: Minor; inssEmployeeMinor: Minor; irtMinor: Minor;
  /** Matéria colectável usada no cálculo (depois da contribuição do trabalhador). */
  irtTaxableMinor: Minor;
  /** Limite mensal de isenção de alimentação e de transporte (cada um), do pacote do ano. */
  allowanceExemptionMinor: Minor;
}

/** Códigos do recibo → colunas do template. Abonos da empresa sem coluna própria → "Outros Subsídios Sujeitos". */
const COLUMN_OF: Record<string, AgtColumn> = {
  BASE: 'Salário Base', ALIM: 'Subsídio Alimentação', TRANSP: 'Subsídio Transporte', ABFAM: 'Abono Família',
  ABFALHAS: 'Abono de Falhas', SUBALOJ: 'Subsídio Renda de Casa', SUBATAVIO: 'Subsídio de Atavio', SUBREPR: 'Subsídio de Representação',
  COMP: 'Compensação Por Rescisão', COMPEXC: 'Compensação Por Rescisão', AVISO: 'Compensação Por Rescisão',
  SUBFER: 'Subsídio de Férias', SUBFERPROP: 'Subsídio de Férias', SUBNAT: 'Subsídio de Natal',
  HE: 'Horas Extras', HEDESC: 'Horas Extras', FERTRAB: 'Horas Extras',
};
/** Reduções do salário (faltas, licenças não pagas, suspensões, descontos manuais) — coluna "Descontos por Falta" em positivo. */
const REDUCTIONS = new Set(['FALTAS', 'LICNR', 'SUSP', 'CORTE']);

/** Linha do template completo (A2.1): valores em cêntimos; colunas S/N em texto. */
export function agtMapRow(i: AgtMapInput): (string | number)[] {
  const col = Object.fromEntries(AGT_MAP_COLUMNS.map((c) => [c, 0])) as Record<AgtColumn, number>;
  for (const l of i.breakdown) {
    if (l.kind !== 'earning' || !l.amountMinor) continue;
    if (REDUCTIONS.has(l.code) || l.amountMinor < 0) { col['Descontos por Falta'] += Math.abs(l.amountMinor); continue; }
    col[COLUMN_OF[l.code] ?? (l.code.startsWith('BONUS') ? 'Prémios' : 'Outros Subsídios Sujeitos')] += l.amountMinor;
  }
  const irtBase = i.irtTaxableMinor > 0 ? i.irtTaxableMinor + i.inssEmployeeMinor : 0;
  // Abonos fora do IRT que não são alimentação/transporte (variáveis ou subsídios marcados sem IRT) → "Outros" (Art. 2.º).
  const ex = i.allowanceExemptionMinor;
  const exemptAllowances = Math.min(col['Subsídio Alimentação'], ex) + Math.min(col['Subsídio Transporte'], ex);
  const otherNonSubject = Math.max(0, i.grossMinor - irtBase - exemptAllowances);
  const moved = Math.min(otherNonSubject, col['Outros Subsídios Sujeitos']);
  col['Outros Subsídios Sujeitos'] -= moved;
  col.Outros += moved;
  // Sem base de Segurança Social (mês todo suspenso, expatriado): o portal não aceita zero — vai o ilíquido com "S".
  const notSubject = i.inssBaseMinor <= 0;
  return AGT_MAP_COLUMNS.map((c) => {
    switch (c) {
      case 'NIF Trabalhador': return i.nif;
      case 'Nome': return i.name;
      case 'Nº Segurança Social': return i.inssNumber;
      case 'Província': return i.province;
      case 'Município': return i.municipality;
      case 'Cálculo Manual de Excesso de Subsídios?': return 'N';
      case 'Registo Manual de Contribuição Segurança Social?': return 'N';
      case 'Salário Ilíquido': return i.grossMinor;
      case 'Base Tributável Segurança Social': return notSubject ? Math.max(0, i.grossMinor) : i.inssBaseMinor;
      case 'Não Sujeito a Segurança Social?': return notSubject ? 'S' : 'N';
      case 'Contribuição Segurança Social': return i.inssEmployeeMinor;
      case 'Base Tributável IRT': return irtBase;
      case 'Isento IRT?': return 'N';
      case 'IRT Apurado': return i.irtMinor;
      default: return col[c];
    }
  });
}

/** Linha do template simplificado (15 colunas), derivada da completa: salário base já líquido das faltas. */
export function agtSimpleRow(full: (string | number)[]): (string | number)[] {
  const v = (c: AgtColumn) => full[AGT_MAP_COLUMNS.indexOf(c)]!;
  const n = (c: AgtColumn) => Number(v(c));
  return [
    v('NIF Trabalhador'), v('Nome'), v('Nº Segurança Social'), v('Província'), v('Município'),
    n('Salário Base') - n('Descontos por Falta'),
    AGT_NON_SUBJECT.reduce((s, c) => s + n(c), 0), AGT_SUBJECT.reduce((s, c) => s + n(c), 0),
    n('Salário Ilíquido'), n('Base Tributável Segurança Social'), v('Não Sujeito a Segurança Social?'), n('Contribuição Segurança Social'),
    n('Base Tributável IRT'), v('Isento IRT?'), n('IRT Apurado'),
  ];
}

// ───────────────────────── INSS: folha de remuneração ─────────────────────────

/** Folha de Remuneração Normal (formato do INSS Virtual): salário base + remunerações adicionais = base de incidência. */
export function inssSheetRow(i: { breakdown: BreakdownLine[]; inssBaseMinor: Minor }) {
  const earnings = i.breakdown.filter((l) => l.kind === 'earning');
  const base = earnings.filter((l) => l.code === 'BASE').reduce((s, l) => s + l.amountMinor, 0)
    - earnings.filter((l) => REDUCTIONS.has(l.code) || l.amountMinor < 0).reduce((s, l) => s + Math.abs(l.amountMinor), 0);
  const salary = Math.max(0, Math.min(base, i.inssBaseMinor));
  return { baseMinor: salary, additionalMinor: Math.max(0, i.inssBaseMinor - salary), totalMinor: Math.max(0, i.inssBaseMinor) };
}

// ───────────────────────── Bancos ─────────────────────────

/** Código de instituição (posições 5–8 do IBAN angolano) → banco. BIC só onde confirmado em fontes públicas. */
export const ANGOLA_BANKS: Record<string, { short: string; name: string; bic?: string }> = {
  '0004': { short: 'BCGA', name: 'Banco Caixa Geral Angola', bic: 'BCGAAOLU' },
  '0006': { short: 'BFA', name: 'Banco de Fomento Angola', bic: 'BFMXAOLU' },
  '0010': { short: 'BPC', name: 'Banco de Poupança e Crédito' },
  '0040': { short: 'BAI', name: 'Banco Angolano de Investimentos', bic: 'BAIPAOLU' },
  '0043': { short: 'BCA', name: 'Banco Comercial Angolano', bic: 'COMLAOLU' },
  '0044': { short: 'SOL', name: 'Banco Sol', bic: 'SOLOAOLU' },
  '0047': { short: 'KEVE', name: 'Banco Keve', bic: 'BRDKAOLU' },
  '0048': { short: 'BMF', name: 'Banco BAI Microfinanças' },
  '0051': { short: 'BIC', name: 'Banco BIC', bic: 'BCCBAOLU' },
  '0052': { short: 'BNI', name: 'Banco de Negócios Internacional', bic: 'BNICAOLU' },
  '0053': { short: 'BANC', name: 'Banco Angolano de Negócios e Comércio', bic: 'ANCEAOLU' },
  '0054': { short: 'BDA', name: 'Banco de Desenvolvimento de Angola', bic: 'BDAAAOLU' },
  '0059': { short: 'BCH', name: 'Banco Comercial do Huambo', bic: 'BCHUAOLU' },
  '0060': { short: 'SBA', name: 'Standard Bank de Angola', bic: 'SBICAOLU' },
  '0063': { short: 'SCBA', name: 'Standard Chartered Bank Angola', bic: 'SCBLAOLU' },
  '0066': { short: 'YETU', name: 'Banco Yetu', bic: 'YETUAOLU' },
  '0067': { short: 'BIR', name: 'Banco de Investimento Rural', bic: 'BIRVAOLU' },
  '0069': { short: 'BPT', name: 'Banco Postal', bic: 'POTAAOLU' },
};

const compactIban = (iban: string) => iban.replace(/\s/g, '').toUpperCase();
/** NBA (21 algarismos) a partir do IBAN AO06… (Aviso BNA n.º 06/2015). */
export const nbaFromIban = (iban: string) => compactIban(iban).slice(4);
export function bankFromIban(iban: string | null | undefined) {
  if (!iban) return null;
  const code = compactIban(iban).slice(4, 8);
  return { code, ...(ANGOLA_BANKS[code] ?? { short: code, name: `Banco ${code}` }) };
}

/** Valor para os ficheiros Excel dos bancos: 2 decimais, vírgula, sem separador de milhares (ex.: 1250000,00). */
export function bankAmount(minor: Minor): string {
  const sign = minor < 0 ? '-' : '';
  const a = Math.abs(minor);
  return `${sign}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/** Descrição curta para o extracto do beneficiário (máx. 20 caracteres, sem acentos). */
export function bankDescription(text: string, max = 20) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 /.-]/g, '').toUpperCase().slice(0, max).trim();
}
