import type { CandidateProfile } from './talent.js';

export interface AtsCriterion {
  kind: 'skill' | 'experience' | 'education' | 'language' | 'certification';
  label: string;
  weight: number;
  required: boolean;
  minimumYears?: number;
}
const normal = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
export function atsCriteriaProblems(criteria: AtsCriterion[]) {
  const problems: string[] = [];
  if (criteria.length > 12) problems.push('Use até 12 critérios profissionais.');
  if (criteria.length && criteria.reduce((n, c) => n + c.weight, 0) !== 100) problems.push('Os pesos do ATS devem somar 100%.');
  for (const c of criteria) {
    if (!c.label.trim() || c.weight < 1 || c.weight > 100 || !Number.isInteger(c.weight)) problems.push('Cada critério precisa de um nome e peso entre 1 e 100.');
    if (/\b(idade|sexo|genero|gravidez|gravida|gestante|religiao|etnia|raca|estado civil|nacionalidade|origem etnica|filhos|deficiencia|orientacao sexual|filiacao politica)\b/.test(normal(c.label))) problems.push('O ATS só admite requisitos profissionais; retire dados pessoais ou critérios discriminatórios.');
    if (c.kind === 'experience' && (c.minimumYears == null || c.minimumYears < 0 || c.minimumYears > 80)) problems.push('Indique os anos mínimos de experiência.');
  }
  return [...new Set(problems)];
}

/** Correspondência documental, sem decisão de contratação. Dados desconhecidos mantêm-se desconhecidos. */
export function atsCompatibility(criteria: AtsCriterion[], profile: CandidateProfile, cvText = '') {
  const evidence = (text: string, term: string) => {
    const a = ` ${normal(text)} `, b = ` ${normal(term)} `;
    const index = a.indexOf(b);
    if (index < 0 || /\b(sem|nao|no|not|without)\b/.test(a.slice(Math.max(0, index - 35), index))) return null;
    return text.slice(0, 240);
  };
  const rows = criteria.map(c => {
    if (c.kind === 'experience') {
      const years = profile.yearsExperience;
      return { ...c, status: years == null ? 'unknown' as const : years >= (c.minimumYears ?? 0) ? 'found' as const : 'below' as const, evidence: years == null ? null : `${years} ano(s) declarados no perfil`, source: years == null ? null : 'Perfil declarado' };
    }
    const declared = c.kind === 'skill' ? profile.skills : c.kind === 'language' ? profile.languages : c.kind === 'certification' ? profile.certifications : [profile.highestEducation, profile.fieldOfStudy].filter((x): x is string => !!x);
    const match = (declared ?? []).find(v => evidence(v, c.label));
    const cv = cvText.split(/[\n\r]+/).find(v => evidence(v, c.label));
    return { ...c, status: match || cv ? 'found' as const : 'unknown' as const, evidence: match?.slice(0, 240) ?? cv?.slice(0, 240) ?? null, source: match ? 'Perfil declarado' : cv ? 'Texto extraído do CV — confirmar contexto' : null };
  });
  return { configured: criteria.length > 0, foundWeight: rows.filter(r => r.status === 'found').reduce((n, r) => n + r.weight, 0), unknownWeight: rows.filter(r => r.status === 'unknown').reduce((n, r) => n + r.weight, 0), rows };
}
