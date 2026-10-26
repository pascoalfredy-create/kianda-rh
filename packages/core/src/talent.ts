/**
 * Recrutamento (pipeline de candidatos) e desempenho (ciclos de avaliação).
 */

// ——— Recrutamento ———

export const STAGES = ['applied', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected', 'withdrawn'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'Candidatura', screening: 'Triagem', interview: 'Entrevista', assessment: 'Prova técnica', offer: 'Proposta',
  hired: 'Contratado', rejected: 'Recusado', withdrawn: 'Desistiu',
};
/** Etapas activas do pipeline (colunas do quadro). */
export const PIPELINE: Stage[] = ['applied', 'screening', 'interview', 'assessment', 'offer'];
export const CLOSED_STAGES: Stage[] = ['hired', 'rejected', 'withdrawn'];

export const SOURCES = { site: 'Página de carreiras', referral: 'Indicação interna', linkedin: 'LinkedIn', agency: 'Agência', spontaneous: 'Candidatura espontânea', other: 'Outra' } as const;
export type CandidateSource = keyof typeof SOURCES;

export interface CandidateLite { stage: Stage; source: string; createdAt: string; hiredAt?: string | null }

/** Indicadores de uma vaga: candidatos por etapa, por origem, taxa de conversão e dias até à contratação. */
export function pipelineStats(cs: CandidateLite[]) {
  const byStage = Object.fromEntries(STAGES.map((s) => [s, cs.filter((c) => c.stage === s).length])) as Record<Stage, number>;
  const bySource: Record<string, number> = {};
  for (const c of cs) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  const hired = cs.filter((c) => c.stage === 'hired' && c.hiredAt);
  const days = hired.map((c) => Math.round((Date.parse(c.hiredAt!) - Date.parse(c.createdAt)) / 86_400_000));
  return {
    total: cs.length, active: cs.filter((c) => PIPELINE.includes(c.stage)).length, byStage, bySource,
    hireRate: cs.length ? Math.round((hired.length / cs.length) * 1000) / 10 : 0,
    avgDaysToHire: days.length ? Math.round(days.reduce((s, d) => s + d, 0) / days.length) : null,
  };
}

/** Transições permitidas: avançar/recuar entre etapas activas; fechar a partir de qualquer activa; reabrir recusados/desistentes. */
export function stageTransitionProblem(from: Stage, to: Stage): string | null {
  if (from === to) return 'O candidato já está nessa etapa';
  if (from === 'hired') return 'Candidato já contratado';
  if (to === 'hired') return from === 'offer' ? null : 'Só se contrata a partir da proposta';
  return null;
}

// ——— Desempenho ———

export interface Competency { key: string; label: string; weight: number }
export const DEFAULT_COMPETENCIES: Competency[] = [
  { key: 'qualidade', label: 'Qualidade e rigor do trabalho', weight: 20 },
  { key: 'produtividade', label: 'Produtividade e cumprimento de prazos', weight: 20 },
  { key: 'conhecimento', label: 'Conhecimento técnico da função', weight: 15 },
  { key: 'equipa', label: 'Trabalho em equipa e relacionamento', weight: 15 },
  { key: 'iniciativa', label: 'Iniciativa e resolução de problemas', weight: 15 },
  { key: 'assiduidade', label: 'Assiduidade, pontualidade e disciplina', weight: 15 },
];

export const SCALE: { value: number; label: string }[] = [
  { value: 1, label: 'Insuficiente' }, { value: 2, label: 'Abaixo do esperado' }, { value: 3, label: 'Cumpre' },
  { value: 4, label: 'Supera' }, { value: 5, label: 'Excepcional' },
];

export interface Objective { title: string; weight: number; result?: string | null; score?: number | null }

export const RECOMMENDATIONS = { none: 'Sem recomendação', raise: 'Aumento salarial', promotion: 'Promoção', training: 'Formação', improvement_plan: 'Plano de melhoria' } as const;
export type Recommendation = keyof typeof RECOMMENDATIONS;

/** Problemas na configuração do ciclo (pesos têm de somar 100). */
export function cycleProblems(competencies: Competency[], competencyWeight: number): string[] {
  const out: string[] = [];
  if (!competencies.length) out.push('Indique pelo menos uma competência');
  const sum = competencies.reduce((s, c) => s + c.weight, 0);
  if (competencies.length && sum !== 100) out.push(`Os pesos das competências somam ${sum}% (têm de somar 100%)`);
  if (competencyWeight < 0 || competencyWeight > 100) out.push('Peso das competências entre 0 e 100%');
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Nota final (1–5): média ponderada das competências e dos objectivos, combinadas segundo o peso do ciclo
 * (ex.: 60% competências, 40% objectivos). Sem objectivos avaliados, conta só a parte das competências.
 */
export function reviewScore(competencies: Competency[], scores: Record<string, number | null | undefined>, objectives: Objective[], competencyWeight: number) {
  const scored = competencies.filter((c) => typeof scores[c.key] === 'number');
  const cw = scored.reduce((s, c) => s + c.weight, 0);
  const comp = cw ? scored.reduce((s, c) => s + c.weight * scores[c.key]!, 0) / cw : null;
  const objs = objectives.filter((o) => typeof o.score === 'number' && o.weight > 0);
  const ow = objs.reduce((s, o) => s + o.weight, 0);
  const obj = ow ? objs.reduce((s, o) => s + o.weight * o.score!, 0) / ow : null;
  let final: number | null;
  if (comp !== null && obj !== null) final = (comp * competencyWeight + obj * (100 - competencyWeight)) / 100;
  else final = comp ?? obj;
  return {
    competencies: comp === null ? null : round2(comp), objectives: obj === null ? null : round2(obj), final: final === null ? null : round2(final),
    complete: scored.length === competencies.length && objs.length === objectives.filter((o) => o.weight > 0).length,
  };
}

export function ratingLabel(score: number | null): string {
  if (score === null) return '—';
  if (score < 1.5) return 'Insuficiente';
  if (score < 2.5) return 'Abaixo do esperado';
  if (score < 3.5) return 'Cumpre';
  if (score < 4.5) return 'Supera';
  return 'Excepcional';
}

/** Distribuição das notas finais por classificação (para a calibração do RH). */
export function ratingDistribution(scores: (number | null)[]) {
  const labels = SCALE.map((s) => s.label);
  const out = Object.fromEntries(labels.map((l) => [l, 0])) as Record<string, number>;
  for (const s of scores) if (s !== null) out[ratingLabel(s)]! += 1;
  return out;
}
