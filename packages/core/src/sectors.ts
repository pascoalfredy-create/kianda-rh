import { applyBps, prorate, type Minor } from './money.js';
import type { Sector } from './licensing.js';

/**
 * Pré-configurações por sector: regimes de horário, subsídios recorrentes, documentos obrigatórios e avisos de conformidade.
 *
 * Os valores sugeridos são pontos de partida — cada empresa ajusta à sua política, ao contrato colectivo do sector e ao
 * contrato individual. A incidência de INSS/IRT dos subsídios sugeridos segue a regra geral (incide) até validação.
 */

// ───────────────────────── Regimes de horário ─────────────────────────

/**
 * Regime de horário.
 * - weekly: 7 valores (segunda → domingo) com os minutos previstos em cada dia; 0 = descanso.
 * - cycle: sequência que se repete a partir da data de início do ciclo (ex.: 2×2 de 12 h, rotação 28/28).
 */
export type ScheduleKind = 'weekly' | 'cycle';
export interface Schedule { kind: ScheduleKind; pattern: number[]; anchorDate?: string | null }

export const SCHEDULE_KIND: Record<ScheduleKind, string> = { weekly: 'Semanal', cycle: 'Ciclo (turnos/rotação)' };

const DAY = 86_400_000;
const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** Minutos previstos num dia. Ciclo sem data de início não tem posição definida → 0 (o RH tem de indicar a data). */
export function scheduledMinutes(s: Schedule, date: string, anchor?: string | null): number {
  if (!s.pattern.length) return 0;
  if (s.kind === 'weekly') {
    const w = new Date(parse(date)).getUTCDay(); // 0 = domingo
    return s.pattern[(w + 6) % 7] ?? 0;
  }
  const a = anchor ?? s.anchorDate;
  if (!a) return 0;
  const n = s.pattern.length;
  const i = Math.round((parse(date) - parse(a)) / DAY);
  return s.pattern[((i % n) + n) % n] ?? 0;
}

/** Dias com trabalho previsto num intervalo (inclusive), opcionalmente excluindo datas (feriados). */
export function scheduledDays(s: Schedule, from: string, to: string, anchor?: string | null, exclude?: ReadonlySet<string>): number {
  let n = 0;
  for (let t = parse(from); t <= parse(to); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (exclude?.has(d)) continue;
    if (scheduledMinutes(s, d, anchor) > 0) n++;
  }
  return n;
}

export interface ScheduleStats { cycleDays: number; workDays: number; restDays: number; maxDailyMinutes: number; avgWeeklyMinutes: number; problems: string[] }

/** Estatísticas e avisos de um regime (média semanal ao longo do ciclo contra o limite do pacote). */
export function scheduleStats(s: Schedule, weeklyHoursLimit: number): ScheduleStats {
  const total = s.pattern.reduce((a, b) => a + b, 0);
  const cycleDays = s.kind === 'weekly' ? 7 : s.pattern.length;
  const workDays = s.pattern.filter((m) => m > 0).length;
  const avgWeeklyMinutes = cycleDays ? Math.round((total / cycleDays) * 7) : 0;
  const maxDailyMinutes = Math.max(0, ...s.pattern);
  const problems: string[] = [];
  if (!workDays) problems.push('O regime não tem nenhum dia de trabalho');
  if (s.kind === 'weekly' && s.pattern.length !== 7) problems.push('O regime semanal tem de ter 7 dias');
  if (s.kind === 'cycle' && s.pattern.length < 2) problems.push('O ciclo tem de ter pelo menos 2 dias');
  if (s.pattern.some((m) => m < 0 || m > 24 * 60)) problems.push('Cada dia tem entre 0 e 24 horas');
  if (avgWeeklyMinutes > weeklyHoursLimit * 60) problems.push(`Média de ${hours(avgWeeklyMinutes)} por semana acima do limite de ${weeklyHoursLimit} h — só com regime de adaptabilidade ou turnos acordado, ou pago como trabalho extraordinário`);
  if (maxDailyMinutes > 12 * 60) problems.push(`Jornadas de ${hours(maxDailyMinutes)} — acima de 12 h por dia exige enquadramento específico`);
  if (s.kind === 'weekly' && s.pattern.length === 7 && s.pattern.every((m) => m > 0)) problems.push('Sem dia de descanso semanal');
  return { cycleDays, workDays, restDays: cycleDays - workDays, maxDailyMinutes, avgWeeklyMinutes, problems };
}

const hours = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

/** Descrição curta para documentos e listas: "Ciclo de 56 dias: 28 de trabalho (12h00) e 28 de descanso". */
export function describeSchedule(s: Schedule): string {
  if (s.kind === 'weekly') {
    const names = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
    const parts = s.pattern.map((m, i) => (m > 0 ? `${names[i]} ${hours(m)}` : null)).filter(Boolean);
    return parts.length ? `Semanal: ${parts.join(', ')}` : 'Semanal sem dias de trabalho';
  }
  // Agrupa blocos consecutivos: "4 dia(s) de 12h00, 4 de descanso"
  const blocks: { m: number; n: number }[] = [];
  for (const m of s.pattern) {
    const last = blocks[blocks.length - 1];
    if (last && last.m === m) last.n++;
    else blocks.push({ m, n: 1 });
  }
  return `Ciclo de ${s.pattern.length} dias: ${blocks.map((b) => (b.m > 0 ? `${b.n} de trabalho (${hours(b.m)})` : `${b.n} de descanso`)).join(', ')}`;
}

const repeat = (m: number, n: number) => Array.from({ length: n }, () => m);

export interface ScheduleSpec { key: string; name: string; kind: ScheduleKind; pattern: number[]; note?: string }

export const SCHEDULE_PRESETS: Record<string, ScheduleSpec> = {
  standard: { key: 'standard', name: 'Horário normal (seg–sex, 8 h)', kind: 'weekly', pattern: [480, 480, 480, 480, 480, 0, 0] },
  mon_sat: { key: 'mon_sat', name: 'Seg–sex 8 h e sábado 4 h', kind: 'weekly', pattern: [480, 480, 480, 480, 480, 240, 0] },
  six_days: { key: 'six_days', name: 'Seis dias por semana (7h20)', kind: 'weekly', pattern: [440, 440, 440, 440, 440, 440, 0] },
  shift_12x2: { key: 'shift_12x2', name: 'Turnos de 12 h (2 dias de trabalho × 2 de descanso)', kind: 'cycle', pattern: [720, 720, 0, 0], note: 'Média de 42 h semanais; turnos de dia e de noite alternam entre equipas' },
  shift_3x8: { key: 'shift_3x8', name: 'Três turnos de 8 h (5 dias × 2 de descanso)', kind: 'cycle', pattern: [480, 480, 480, 480, 480, 0, 0], note: 'Manhã, tarde e noite em rotação entre equipas' },
  rotation_28: { key: 'rotation_28', name: 'Rotação 28/28 (12 h no local)', kind: 'cycle', pattern: [...repeat(720, 28), ...repeat(0, 28)], note: '28 dias no local de trabalho e 28 de descanso; média de 42 h semanais' },
  rotation_21: { key: 'rotation_21', name: 'Rotação 21/21 (12 h no local)', kind: 'cycle', pattern: [...repeat(720, 21), ...repeat(0, 21)] },
  rotation_14: { key: 'rotation_14', name: 'Rotação 14/14 (12 h no local)', kind: 'cycle', pattern: [...repeat(720, 14), ...repeat(0, 14)] },
  rotation_42_21: { key: 'rotation_42_21', name: 'Rotação 6×3 semanas (10 h no local)', kind: 'cycle', pattern: [...repeat(600, 42), ...repeat(0, 21)], note: '42 dias no local e 21 de descanso; confirme o enquadramento (média acima de 44 h)' },
};

// ───────────────────────── Subsídios recorrentes ─────────────────────────

/** fixed = valor mensal; base_pct = % do salário base; per_day = valor por dia de trabalho previsto na escala. */
export type AllowanceCalc = 'fixed' | 'base_pct' | 'per_day';
export const ALLOWANCE_CALC: Record<AllowanceCalc, string> = { fixed: 'Valor mensal fixo', base_pct: '% do salário base', per_day: 'Por dia de escala' };

export interface AllowanceSpec { key: string; code: string; label: string; calc: AllowanceCalc; valueMinor?: number; bps?: number; inInss: boolean; inIrt: boolean; note?: string }

const A = (key: string, code: string, label: string, calc: AllowanceCalc, v: number, note?: string): AllowanceSpec =>
  ({ key, code, label, calc, ...(calc === 'base_pct' ? { bps: v } : { valueMinor: v }), inInss: true, inIrt: true, note });

export const ALLOWANCE_PRESETS: Record<string, AllowanceSpec> = {
  shift: A('shift', 'SUBTURNO', 'Subsídio de turno', 'base_pct', 1000, 'Trabalho em regime de turnos rotativos'),
  night: A('night', 'SUBNOCT', 'Subsídio de trabalho nocturno', 'fixed', 1_500_000, 'Para quem trabalha regularmente em período nocturno'),
  risk: A('risk', 'SUBRISCO', 'Subsídio de risco', 'base_pct', 1000, 'Funções com exposição a risco (armas, explosivos, alturas, agentes químicos)'),
  isolation: A('isolation', 'SUBISOL', 'Subsídio de isolamento', 'per_day', 500_000, 'Por dia em local isolado (frentes de mina, estaleiros remotos)'),
  field: A('field', 'SUBCAMPO', 'Subsídio de campo', 'per_day', 300_000, 'Por dia de trabalho no campo/estaleiro'),
  offshore: A('offshore', 'SUBOFFSH', 'Subsídio offshore', 'per_day', 1_000_000, 'Por dia em plataforma ou embarcação'),
  housing: A('housing', 'SUBALOJ', 'Subsídio de alojamento', 'fixed', 3_000_000),
  travel: A('travel', 'SUBDESL', 'Subsídio de deslocação', 'per_day', 250_000, 'Deslocação diária para obra ou rota fora da base'),
  cashier: A('cashier', 'ABFALHAS', 'Abono para falhas', 'fixed', 1_000_000, 'Funções com manuseamento de valores (caixas, tesouraria)'),
  exclusivity: A('exclusivity', 'SUBEXCL', 'Subsídio de exclusividade', 'base_pct', 1500),
  teaching: A('teaching', 'SUBDOC', 'Subsídio de docência', 'fixed', 1_000_000),
};

// ───────────────────────── Perfis por sector ─────────────────────────

/** Documento obrigatório para as funções cujo título contém uma das palavras indicadas (sem acentos, minúsculas). */
export type RequiredDocument = { type: 'professional_card' | 'driving_licence' | 'work_visa'; label: string; reason: string; appliesTo: string[]; appliesToLabel: string };

export interface SectorProfile {
  schedules: string[];
  allowances: string[];
  requiredDocuments: RequiredDocument[];
  /** Avisos de conformidade do sector (mostrados no painel; validar com jurista). */
  notes: string[];
}

const BASE: SectorProfile = { schedules: ['standard'], allowances: [], requiredDocuments: [], notes: [] };

export const SECTOR_PROFILES: Record<Sector, SectorProfile> = {
  commerce: { ...BASE, schedules: ['standard', 'mon_sat', 'six_days'], allowances: ['cashier'] },
  services: { ...BASE },
  construction: {
    schedules: ['standard', 'mon_sat'], allowances: ['risk', 'field', 'travel'], requiredDocuments: [],
    notes: ['Seguro de acidentes de trabalho e doenças profissionais obrigatório para todo o pessoal em obra', 'Equipamento de protecção individual e registo de entrega por colaborador', 'Contratos a termo por obra: o fundamento deve identificar a obra e a duração prevista'],
  },
  security: {
    schedules: ['shift_12x2', 'six_days', 'standard'], allowances: ['shift', 'night', 'risk'],
    requiredDocuments: [{ type: 'professional_card', label: 'Cartão profissional de vigilante', reason: 'A actividade de segurança privada exige pessoal habilitado com cartão profissional válido', appliesTo: ['vigilante', 'seguranca', 'guarda', 'agente de protec', 'supervisor de seguranca'], appliesToLabel: 'vigilantes e agentes de segurança' }],
    notes: ['Formação e cartão profissional válidos para todos os vigilantes (lei da segurança privada)', 'Uso de arma: licença de uso e porte e formação específica', 'Turnos de 12 h: o regime de turnos deve constar do contrato ou de acordo escrito com o trabalhador', 'Trabalho nocturno regular deve ser compensado nos termos da LGT'],
  },
  mining: {
    schedules: ['rotation_28', 'rotation_21', 'standard'], allowances: ['isolation', 'field', 'risk', 'housing'], requiredDocuments: [],
    notes: ['Seguro de acidentes de trabalho e doenças profissionais obrigatório', 'Exames médicos de admissão e periódicos para funções de risco', 'Rotações: dias de viagem entre a base e a mina devem estar definidos no contrato (tempo de trabalho ou não)', 'Estrangeiros: visto de trabalho válido e respeito das quotas de trabalhadores nacionais'],
  },
  oil_gas: {
    schedules: ['rotation_28', 'rotation_14', 'rotation_21', 'standard'], allowances: ['offshore', 'isolation', 'risk', 'housing'], requiredDocuments: [],
    notes: ['Regras de angolanização de quadros do sector petrolífero: planos de formação e substituição de expatriados', 'Certificações de segurança offshore (formação BOSIET/HUET) por colaborador embarcado', 'Seguro de acidentes de trabalho obrigatório; exames médicos periódicos', 'Estrangeiros: visto de trabalho válido'],
  },
  manufacturing: {
    schedules: ['standard', 'shift_3x8', 'mon_sat'], allowances: ['shift', 'night', 'risk'], requiredDocuments: [],
    notes: ['Seguro de acidentes de trabalho obrigatório', 'Turnos rotativos: escala afixada e conhecida com antecedência'],
  },
  agriculture: {
    schedules: ['mon_sat', 'standard', 'six_days'], allowances: ['field', 'housing'], requiredDocuments: [],
    notes: ['Trabalho sazonal: contratos a termo com fundamento na campanha agrícola', 'Seguro de acidentes de trabalho obrigatório'],
  },
  hospitality: {
    schedules: ['six_days', 'shift_3x8', 'standard'], allowances: ['shift', 'night', 'cashier'], requiredDocuments: [],
    notes: ['Escalas com folga semanal garantida; trabalho em feriados pago com o acréscimo legal', 'Manipuladores de alimentos: certificado de saúde válido'],
  },
  health: {
    schedules: ['shift_12x2', 'shift_3x8', 'standard'], allowances: ['shift', 'night', 'risk'],
    requiredDocuments: [{ type: 'professional_card', label: 'Cédula/carteira profissional', reason: 'Profissionais de saúde exercem com inscrição válida na respectiva ordem', appliesTo: ['medic', 'enfermeir', 'farmaceut', 'tecnico de saude', 'analises clinicas', 'fisioterapeut', 'parteir'], appliesToLabel: 'médicos, enfermeiros e técnicos de saúde' }],
    notes: ['Inscrição válida na ordem profissional (médicos, enfermeiros, técnicos)', 'Turnos e urgências: escalas aprovadas e afixadas'],
  },
  education: { ...BASE, allowances: ['teaching', 'exclusivity'], notes: ['Contratos de docentes a termo: fundamento no ano lectivo'] },
  transport: {
    schedules: ['standard', 'mon_sat', 'shift_3x8'], allowances: ['travel', 'risk', 'night'],
    requiredDocuments: [{ type: 'driving_licence', label: 'Carta de condução', reason: 'Motoristas conduzem com carta válida da categoria do veículo', appliesTo: ['motorista', 'condutor', 'camionista', 'operador de maquinas', 'operador de empilhador', 'estafeta', 'motoqueiro'], appliesToLabel: 'motoristas e condutores' }],
    notes: ['Motoristas: carta válida da categoria e controlo dos tempos de condução e descanso'],
  },
  finance: { ...BASE, allowances: ['cashier', 'exclusivity'] },
  telecom: { ...BASE, schedules: ['standard', 'shift_3x8'], allowances: ['shift', 'night'] },
  ngo: { ...BASE, allowances: ['field', 'travel'] },
  public: { ...BASE, allowances: ['exclusivity'] },
  other: { ...BASE },
};

export function sectorProfile(sector: string | null | undefined): SectorProfile {
  return SECTOR_PROFILES[(sector ?? 'other') as Sector] ?? SECTOR_PROFILES.other;
}

// ───────────────────────── Cálculo dos subsídios no mês ─────────────────────────

export interface AllowanceAmountInput {
  calc: AllowanceCalc;
  valueMinor?: number | null;
  bps?: number | null;
  /** Salário base mensal completo. */
  baseMinor: Minor;
  /** Dias de calendário em que o subsídio vigora no mês (sobreposição atribuição × contrato); undefined = mês inteiro. */
  activeDays?: number;
  /** Dias de trabalho previstos na escala, dentro dos dias em que vigora (para per_day). */
  scheduledDays: number;
  dailyRateDivisor: number;
}

/** Valor do subsídio no mês: fixo e % do base proporcionais a mês incompleto; por dia = valor × dias de escala. */
export function allowanceAmount(i: AllowanceAmountInput): Minor {
  const part = (v: Minor) => (i.activeDays !== undefined && i.activeDays < i.dailyRateDivisor ? prorate(v, Math.max(0, i.activeDays), i.dailyRateDivisor) : v);
  if (i.calc === 'fixed') return part(i.valueMinor ?? 0);
  if (i.calc === 'base_pct') return part(applyBps(i.baseMinor, i.bps ?? 0));
  return (i.valueMinor ?? 0) * Math.max(0, i.scheduledDays);
}

// ───────────────────────── Conformidade ─────────────────────────

export type CheckSeverity = 'error' | 'warning' | 'info';
export interface ComplianceCheck { code: string; severity: CheckSeverity; title: string; detail: string; employees: { id: string; name: string; note?: string }[] }

export interface ComplianceInput {
  sector: string | null;
  today: string;
  weeklyHoursLimit: number;
  employees: { id: string; name: string; jobTitle?: string | null; nationality: string | null; scheduleId: string | null; scheduleAnchor?: string | null; documents: { type: string; expiryDate: string | null }[] }[];
  schedules: ({ id: string; name: string } & Schedule)[];
}

const isNational = (n: string | null) => {
  const v = (n ?? '').trim().toLowerCase();
  return !v || v.startsWith('angol') || v === 'ao';
};
const fold = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** A função do colaborador exige o documento? (pelo título da função, sem acentos). */
export const appliesTo = (req: RequiredDocument, jobTitle: string | null | undefined) => !!jobTitle && req.appliesTo.some((k) => fold(jobTitle).includes(k));
const addDaysIso = (d: string, n: number) => new Date(parse(d) + n * DAY).toISOString().slice(0, 10);

/** Verificações de conformidade do sector e gerais (documentos, vistos, regimes de horário). */
export function complianceChecks(input: ComplianceInput): ComplianceCheck[] {
  const profile = sectorProfile(input.sector);
  const soon = addDaysIso(input.today, 30);
  const checks: ComplianceCheck[] = [];
  const valid = (docs: ComplianceInput['employees'][number]['documents'], types: string[]) => docs.filter((d) => types.includes(d.type) && (!d.expiryDate || d.expiryDate >= input.today));

  for (const req of profile.requiredDocuments) {
    const missing: ComplianceCheck['employees'] = [];
    const expiring: ComplianceCheck['employees'] = [];
    for (const e of input.employees.filter((x) => appliesTo(req, x.jobTitle))) {
      const docs = e.documents.filter((d) => d.type === req.type);
      const ok = valid(docs, [req.type]);
      if (!ok.length) missing.push({ id: e.id, name: e.name, note: docs.length ? 'caducado' : 'sem registo' });
      else if (ok.every((d) => d.expiryDate && d.expiryDate <= soon)) expiring.push({ id: e.id, name: e.name, note: `caduca a ${ok.map((d) => d.expiryDate!).sort().at(-1)}` });
    }
    if (missing.length) checks.push({ code: `doc_${req.type}`, severity: 'error', title: `${req.label} em falta ou caducado`, detail: `${req.reason} (aplica-se a ${req.appliesToLabel}, pela função na ficha).`, employees: missing });
    if (expiring.length) checks.push({ code: `doc_${req.type}_soon`, severity: 'warning', title: `${req.label} a caducar nos próximos 30 dias`, detail: 'Peça a renovação antes da data de validade.', employees: expiring });
  }

  const foreign = input.employees.filter((e) => !isNational(e.nationality));
  const noVisa = foreign.filter((e) => !valid(e.documents, ['work_visa', 'residence_card']).length);
  if (noVisa.length) checks.push({ code: 'foreign_visa', severity: 'error', title: 'Trabalhadores estrangeiros sem visto de trabalho válido', detail: 'Registe o visto de trabalho (ou cartão de residente) com a data de validade na ficha do colaborador.', employees: noVisa.map((e) => ({ id: e.id, name: e.name, note: e.nationality ?? undefined })) });
  const visaSoon = foreign.filter((e) => { const v = valid(e.documents, ['work_visa', 'residence_card']); return v.length && v.every((d) => d.expiryDate && d.expiryDate <= addDaysIso(input.today, 60)); });
  if (visaSoon.length) checks.push({ code: 'foreign_visa_soon', severity: 'warning', title: 'Vistos de trabalho a caducar nos próximos 60 dias', detail: 'A renovação do visto demora — inicie o processo com antecedência.', employees: visaSoon.map((e) => ({ id: e.id, name: e.name })) });

  for (const s of input.schedules) {
    const st = scheduleStats(s, input.weeklyHoursLimit);
    if (st.problems.length) checks.push({ code: `schedule_${s.id}`, severity: 'warning', title: `Regime "${s.name}"`, detail: st.problems.join('. '), employees: input.employees.filter((e) => e.scheduleId === s.id).map((e) => ({ id: e.id, name: e.name })) });
    if (s.kind === 'cycle' && !s.anchorDate) {
      const without = input.employees.filter((e) => e.scheduleId === s.id && !e.scheduleAnchor);
      if (without.length) checks.push({ code: `anchor_${s.id}`, severity: 'error', title: `Regime "${s.name}" sem data de início do ciclo`, detail: 'Indique a data de início do ciclo no regime ou em cada colaborador — sem ela o ponto não sabe que dias são de trabalho.', employees: without.map((e) => ({ id: e.id, name: e.name })) });
    }
  }
  if (input.schedules.some((s) => s.kind === 'cycle')) {
    const none = input.employees.filter((e) => !e.scheduleId);
    if (none.length) checks.push({ code: 'no_schedule', severity: 'info', title: 'Colaboradores sem regime atribuído', detail: 'Seguem o horário normal da empresa (segunda a sexta). Atribua o regime de turnos ou rotação na ficha, se aplicável.', employees: none.map((e) => ({ id: e.id, name: e.name })) });
  }
  return checks;
}
