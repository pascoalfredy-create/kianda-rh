import { describe, expect, it } from 'vitest';
import { registrationNameProblem, registrationReviewReasons } from '../src/index.js';

describe('dados de cadastro', () => {
  it('rejeita nomes provisórios completos normalizando acentos, espaços e maiúsculas', () => {
    for (const value of [' TESTE ', 'Tésté', 'test test', 'Admin', '12345', '---']) {
      expect(registrationNameProblem(value), value).not.toBeNull();
    }
    for (const value of ['Pascoal Frederico', 'Maria Testa', 'Testemunho Consultoria', 'João D’Ávila']) {
      expect(registrationNameProblem(value), value).toBeNull();
    }
  });
  it('sinaliza padrões óbvios sem declarar inválidos NIFs apenas por repetição parcial', () => {
    expect(registrationReviewReasons('5002555555')).toHaveLength(1);
    expect(registrationReviewReasons('1234567890')).toHaveLength(1);
    expect(registrationReviewReasons('5417433373')).toEqual([]);
  });
});
