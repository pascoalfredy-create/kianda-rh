import { complianceAlerts, getPack, luandaDate, PackNotFoundError, angolanIbanProblem, isValidAngolanBI, normalizeIban, type CountryPack } from '@kianda/core';
import { z } from 'zod';
import { DomainError } from './payroll.js';
const today = () => luandaDate(new Date());
const packFor = (date: string) => getPack('AO', Number(date.slice(0, 4)));

export const optionalText = z.string().trim().max(200).optional().nullable().transform((v) => (v === '' ? null : v));
export const optionalDate = z.union([z.iso.date(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v));

export const moneyFields = z.object({
  /** Em USD (indexado): referência em Kz ao câmbio indicado na ficha; o processamento converte ao câmbio do dia. */
  base: z.number().nonnegative(),
  meal: z.number().nonnegative().default(0),
  transport: z.number().nonnegative().default(0),
  currency: z.enum(['AOA', 'USD']).default('AOA'),
  baseUsd: z.number().positive('Indique o salário base em USD').max(10_000_000).optional().nullable(),
});
export const usdCheck = (m: { currency: string; baseUsd?: number | null }) => m.currency === 'AOA' || !!m.baseUsd;
export const usdMessage = { message: 'Indique o salário base em USD', path: ['baseUsd'] };

/** Colunas da moeda do salário (USD = base indexada ao dólar). */
export const salaryCols = (m: { currency: 'AOA' | 'USD'; baseUsd?: number | null }) =>
  m.currency === 'USD' ? { salaryCurrency: 'USD', baseForeignMinor: Math.round(m.baseUsd! * 100) } : { salaryCurrency: 'AOA', baseForeignMinor: null };

export const contractBody = moneyFields.extend({
  type: z.enum(['indefinite', 'fixed_term', 'internship']),
  startDate: z.iso.date(),
  endDate: optionalDate,
  termJustification: optionalText,
}).refine((c) => c.type !== 'fixed_term' || (c.endDate && c.termJustification), { message: 'Contrato a termo exige data de fim e fundamento do termo', path: ['endDate'] })
  .refine((c) => !c.endDate || c.endDate > c.startDate, { message: 'A data de fim tem de ser posterior ao início', path: ['endDate'] })
  .refine(usdCheck, usdMessage);

export const personal = {
  name: z.string().trim().min(2),
  jobTitle: z.string().trim().min(2),
  departmentId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  province: optionalText,
  municipality: optionalText,
  gender: z.enum(['F', 'M']).optional().nullable(),
  birthDate: optionalDate,
  nationality: optionalText,
  maritalStatus: optionalText,
  biNumber: z.string().trim().toUpperCase().refine(isValidAngolanBI, 'BI com formato inválido (ex.: 004512398LA041)').optional().nullable(),
  nif: optionalText,
  inssNumber: optionalText,
  iban: z.string().transform(normalizeIban).superRefine((v, ctx) => { const p = angolanIbanProblem(v); if (p) ctx.addIssue({ code: 'custom', message: p }); }).optional().nullable(),
  bank: optionalText,
  email: z.union([z.email(), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v)),
  phone: optionalText,
  address: optionalText,
  emergencyContactName: optionalText,
  emergencyContactPhone: optionalText,
};

export const createBody = z.object({ number: z.string().trim().min(1), ...personal, contract: contractBody, candidateId: z.string().optional() });
/**
 * Salário mínimo do ano da data de efeito. Datas passadas sem pacote registado (ex.: migração de histórico de 2023–2025)
 * não são verificadas — a remuneração em vigor hoje continua a ser verificada nos alertas da ficha.
 * Datas futuras usam o pacote do ano ou, sem ele, as regras do último publicado (getPack continua as regras).
 */
export function assertMinimumWage(baseMinor: number, type: string, date: string, microOrStartup = false) {
  let pack: CountryPack;
  try {
    pack = packFor(date);
  } catch (err) {
    if (err instanceof PackNotFoundError && date < today()) return;
    throw err;
  }
  const alerts = complianceAlerts({ baseMinor, internship: type === 'internship', microOrStartup }, pack);
  if (alerts.length) throw new DomainError('abaixo_salario_minimo', `${alerts[0]} (${pack.version})`, 400);
}

