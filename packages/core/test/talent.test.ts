import { describe, expect, it } from 'vitest';
import { cycleProblems, DEFAULT_COMPETENCIES, pipelineStats, ratingDistribution, ratingLabel, reviewScore, stageTransitionProblem } from '../src/index.js';

describe('recrutamento', () => {
  it('indicadores do pipeline', () => {
    const s = pipelineStats([
      { stage: 'applied', source: 'site', createdAt: '2026-10-01' }, { stage: 'interview', source: 'referral', createdAt: '2026-10-02' },
      { stage: 'hired', source: 'site', createdAt: '2026-10-01', hiredAt: '2026-10-21' }, { stage: 'rejected', source: 'linkedin', createdAt: '2026-10-03' },
    ]);
    expect(s).toMatchObject({ total: 4, active: 2, hireRate: 25, avgDaysToHire: 20, bySource: { site: 2, referral: 1, linkedin: 1 } });
    expect(s.byStage.hired).toBe(1);
  });
  it('só se contrata a partir da proposta', () => {
    expect(stageTransitionProblem('interview', 'hired')).toMatch(/proposta/);
    expect(stageTransitionProblem('offer', 'hired')).toBeNull();
    expect(stageTransitionProblem('hired', 'rejected')).toMatch(/contratado/);
    expect(stageTransitionProblem('rejected', 'screening')).toBeNull();
  });
});

describe('avaliação de desempenho', () => {
  it('pesos do ciclo', () => {
    expect(cycleProblems(DEFAULT_COMPETENCIES, 60)).toEqual([]);
    expect(cycleProblems([{ key: 'a', label: 'A', weight: 50 }], 60)[0]).toMatch(/somam 50%/);
  });
  it('nota ponderada: 60% competências + 40% objectivos', () => {
    const comps = [{ key: 'a', label: 'A', weight: 50 }, { key: 'b', label: 'B', weight: 50 }];
    const r = reviewScore(comps, { a: 4, b: 3 }, [{ title: 'Fecho mensal até dia 5', weight: 70, score: 5 }, { title: 'Formação', weight: 30, score: 3 }], 60);
    expect(r).toEqual({ competencies: 3.5, objectives: 4.4, final: 3.86, complete: true });
    expect(ratingLabel(r.final)).toBe('Supera');
    const partial = reviewScore(comps, { a: 4 }, [], 60);
    expect(partial).toMatchObject({ competencies: 4, objectives: null, final: 4, complete: false });
  });
  it('distribuição das classificações', () => {
    expect(ratingDistribution([1.2, 3, 3.4, 4.6, null])).toEqual({ Insuficiente: 1, 'Abaixo do esperado': 0, Cumpre: 2, Supera: 0, Excepcional: 1 });
  });
});
