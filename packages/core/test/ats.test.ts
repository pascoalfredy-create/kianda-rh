import { describe, expect, it } from 'vitest';
import { atsCompatibility, atsCriteriaProblems, type AtsCriterion } from '../src/index.js';

const criteria: AtsCriterion[] = [{ kind: 'skill', label: 'Excel', weight: 40, required: true }, { kind: 'experience', label: 'Experiência na função', minimumYears: 3, weight: 30, required: true }, { kind: 'language', label: 'Inglês', weight: 30, required: false }];
describe('ATS com requisitos profissionais e evidência verificável', () => {
  it('sem critérios não inventa uma pontuação', () => expect(atsCompatibility([], {})).toEqual({ configured: false, foundWeight: 0, unknownWeight: 0, rows: [] }));
  it('normaliza acentos e usa a experiência declarada sem inferir idade', () => {
    const r = atsCompatibility(criteria, { skills: ['Microsoft Excel'], yearsExperience: 4, languages: ['Ingles avançado'] });
    expect(r.foundWeight).toBe(100); expect(r.unknownWeight).toBe(0); expect(r.rows.map(x => x.source)).toEqual(['Perfil declarado', 'Perfil declarado', 'Perfil declarado']);
  });
  it('informação ausente é desconhecida e não gera uma correspondência de 100% por omissão', () => {
    const r = atsCompatibility(criteria, { skills: ['Excel'] });
    expect(r.foundWeight).toBe(40); expect(r.unknownWeight).toBe(60); expect(r.rows[1]!.status).toBe('unknown');
  });
  it('experiência declarada abaixo do mínimo não é confundida com ausência de informação', () => {
    const r = atsCompatibility(criteria, { yearsExperience: 1 }); expect(r.rows[1]!.status).toBe('below'); expect(r.unknownWeight).toBe(70);
  });
  it('uma palavra no CV identifica a linha de evidência e não é uma certificação confirmada', () => {
    const r = atsCompatibility(criteria, {}, 'Experiência profissional\nTrabalho com Excel e análise de dados.');
    expect(r.foundWeight).toBe(40); expect(r.rows[0]).toMatchObject({ evidence: 'Trabalho com Excel e análise de dados.', source: 'Texto extraído do CV — confirmar contexto' });
  });
  it('não encontra palavras dentro de outras nem transforma uma negação simples em competência', () => {
    expect(atsCompatibility(criteria, {}, 'Sem experiência em Excel.').foundWeight).toBe(0);
    expect(atsCompatibility(criteria, {}, 'Excelência no atendimento.').foundWeight).toBe(0);
  });
  it('exige pesos completos e limita critérios a informação profissional', () => {
    expect(atsCriteriaProblems(criteria)).toEqual([]);
    expect(atsCriteriaProblems([{ ...criteria[0]!, weight: 50 }]).join(' ')).toMatch(/100/);
    for (const label of ['Idade até 30', 'Estado civil solteiro', 'Género masculino', 'Nacionalidade angolana', 'Religião', 'Sem filhos', 'Gravidez']) expect(atsCriteriaProblems([{ ...criteria[0]!, label, weight: 100 }]).join(' ')).toMatch(/profissionais/);
  });
});
