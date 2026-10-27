/**
 * Formatos de entrega oficiais (Angola).
 *
 * AGT — Mapa Mensal de Remunerações (IRT Grupo A), Portal do Contribuinte → Declarações → IRT → Entregar → Mapa de
 * Remunerações → "Upload de Ficheiro" (Excel, CSV ou XML). Colunas pela ordem do template da AGT (31), conforme a
 * documentação dos softwares certificados; validar contra o "Template do ficheiro" descarregado no portal.
 * O ficheiro tem de incluir todos os trabalhadores (não só os alterados).
 *
 * Bancos — transferências por lotes: o BFA e o BAI aceitam Excel (convertido pelo banco em PS2/PSX). Regras do BFA:
 * sem cabeçalhos/logótipos/totais, valor com 2 decimais e vírgula, sem separador de milhares, descrição até 20 caracteres.
 */
import type { Minor } from './money.js';

// ───────────────────────── AGT: mapa mensal de remunerações ─────────────────────────

export const AGT_MAP_COLUMNS = [
  'NIF Trabalhador', 'Nome', 'N.º Segurança Social', 'Província', 'Município',
  'Salário Base', 'Descontos por Falta', 'Subsídio de Alimentação', 'Subsídio Transporte', 'Abono de Família',
  'Reembolso de despesas', 'Outros', 'Cálculo Manual de Excesso de Subsídios', 'Excesso Subsídios Não Sujeitos', 'Abono para Falhas',
  'Subsídio Renda de Casa', 'Compensação por rescisão', 'Subsídio de Férias', 'Horas Extras', 'Subsídio de Atavio',
  'Prémios', 'Subsídio de Natal', 'Outros Subsídios Sujeitos', 'Salário Ilíquido', 'Cálculo Manual da Base Trib. Seg. Social?',
  'Base Tributável Segurança Social', 'Não Sujeito a Segurança Social?', 'Contribuição Segurança Social', 'Base Tributável IRT', 'Isento IRT?',
  'IRT Apurado',
] as const;

/** Siglas da AGT (divisão de 18 províncias). As províncias criadas em 2024 usam a da província de origem até a AGT publicar as novas. */
export const AGT_PROVINCE_CODES: Record<string, { code: string; provisional?: boolean }> = {
  Benguela: { code: 'BA' }, 'Bié': { code: 'BE' }, Bengo: { code: 'BO' }, Cabinda: { code: 'CA' }, 'Cuando Cubango': { code: 'CC' },
  Cunene: { code: 'CE' }, 'Cuanza Norte': { code: 'CN' }, 'Cuanza Sul': { code: 'CS' }, 'Huíla': { code: 'HA' }, Huambo: { code: 'HO' },
  Luanda: { code: 'LA' }, 'Lunda Norte': { code: 'LN' }, 'Lunda Sul': { code: 'LS' }, Malanje: { code: 'ME' }, Moxico: { code: 'MO' },
  Namibe: { code: 'NE' }, 'Uíge': { code: 'UE' }, Zaire: { code: 'ZE' },
  // Lei n.º 14/24 (nova divisão político-administrativa): sigla provisória da província de origem.
  Cuando: { code: 'CC', provisional: true }, Cubango: { code: 'CC', provisional: true },
  'Icolo e Bengo': { code: 'LA', provisional: true }, 'Moxico Leste': { code: 'MO', provisional: true },
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function agtProvince(name: string | null | undefined): { code: string; provisional?: boolean } | null {
  if (!name) return null;
  const n = norm(name);
  const hit = Object.entries(AGT_PROVINCE_CODES).find(([k, v]) => norm(k) === n || v.code.toLowerCase() === n);
  return hit ? hit[1] : null;
}

type BreakdownLine = { code: string; kind: string; amountMinor: number };

export interface AgtMapInput {
  nif: string; name: string; inssNumber: string; province: string; municipality: string;
  breakdown: BreakdownLine[]; grossMinor: Minor; inssBaseMinor: Minor; inssEmployeeMinor: Minor; irtMinor: Minor;
  /** Matéria colectável usada no cálculo (depois da contribuição do trabalhador). */
  irtTaxableMinor: Minor;
}

/** Códigos do recibo → colunas do mapa da AGT. Abonos da empresa sem coluna própria vão para "Outros". */
const COLUMN_OF: Record<string, string> = {
  BASE: 'Salário Base', ALIM: 'Subsídio de Alimentação', TRANSP: 'Subsídio Transporte',
  ABFALHAS: 'Abono para Falhas', SUBALOJ: 'Subsídio Renda de Casa', ABFAM: 'Abono de Família', SUBATAVIO: 'Subsídio de Atavio',
  COMP: 'Compensação por rescisão', COMPEXC: 'Compensação por rescisão', AVISO: 'Compensação por rescisão',
  SUBFER: 'Subsídio de Férias', SUBFERPROP: 'Subsídio de Férias', SUBNAT: 'Subsídio de Natal',
  HE: 'Horas Extras', HEDESC: 'Horas Extras', FERTRAB: 'Horas Extras',
};
/** Reduções do salário (faltas, licenças não pagas, suspensões, descontos manuais) — coluna "Descontos por Falta" em positivo. */
const REDUCTIONS = new Set(['FALTAS', 'LICNR', 'SUSP', 'CORTE']);

/** Uma linha do mapa (valores em cêntimos; as colunas S/N em texto). */
export function agtMapRow(i: AgtMapInput): (string | number)[] {
  const col: Record<string, number> = Object.fromEntries(AGT_MAP_COLUMNS.map((c) => [c, 0]));
  for (const l of i.breakdown) {
    if (l.kind !== 'earning' || !l.amountMinor) continue;
    if (REDUCTIONS.has(l.code) || l.amountMinor < 0) { col['Descontos por Falta']! += Math.abs(l.amountMinor); continue; }
    const c = COLUMN_OF[l.code] ?? (l.code.startsWith('BONUS') ? 'Prémios' : 'Outros');
    col[c]! += l.amountMinor;
  }
  // Sem base de Segurança Social (ex.: mês todo suspenso, expatriado): o portal não aceita zero — vai o ilíquido com "S".
  const notSubject = i.inssBaseMinor <= 0;
  const irtBase = i.irtTaxableMinor > 0 ? i.irtTaxableMinor + i.inssEmployeeMinor : 0;
  return AGT_MAP_COLUMNS.map((c) => {
    switch (c) {
      case 'NIF Trabalhador': return i.nif;
      case 'Nome': return i.name;
      case 'N.º Segurança Social': return i.inssNumber;
      case 'Província': return i.province;
      case 'Município': return i.municipality;
      case 'Cálculo Manual de Excesso de Subsídios': return 'N';
      case 'Cálculo Manual da Base Trib. Seg. Social?': return 'N';
      case 'Salário Ilíquido': return i.grossMinor;
      case 'Base Tributável Segurança Social': return notSubject ? Math.max(0, i.grossMinor) : i.inssBaseMinor;
      case 'Não Sujeito a Segurança Social?': return notSubject ? 'S' : 'N';
      case 'Contribuição Segurança Social': return i.inssEmployeeMinor;
      case 'Base Tributável IRT': return irtBase;
      case 'Isento IRT?': return 'N';
      case 'IRT Apurado': return i.irtMinor;
      default: return col[c] ?? 0;
    }
  });
}

/** Colunas com valores monetários (para converter de cêntimos e formatar). */
export const AGT_MONEY_COLUMNS = new Set<number>(AGT_MAP_COLUMNS.map((c, i) => [c, i] as const)
  .filter(([c]) => !['NIF Trabalhador', 'Nome', 'N.º Segurança Social', 'Província', 'Município', 'Cálculo Manual de Excesso de Subsídios', 'Cálculo Manual da Base Trib. Seg. Social?', 'Não Sujeito a Segurança Social?', 'Isento IRT?'].includes(c))
  .map(([, i]) => i));

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
