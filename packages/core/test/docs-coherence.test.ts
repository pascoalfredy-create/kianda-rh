import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CYCLES, cyclePrice, DEFAULT_TIERS, MODELING_EXTRA_USER_MONTHLY_MINOR, MODELING_INCLUDED_USERS, MODELING_PLANS, modelingPlanPrice, VALUATION_EXTRA_USER_MONTHLY_MINOR, VALUATION_INCLUDED_USERS, VALUATION_PLANS, valuationPlanPrice, type BillingCycle } from '../src/index.js';

/**
 * A documentação comercial (docs/MODULOS-LICENCAS.md) tem de dizer o mesmo que o código.
 * Se um preço mudar só num dos lados, este teste falha — e um agente que leia só os documentos não "corrige" o código para valores antigos.
 */
const doc = (name: string) => readFileSync(new URL(`../../../${name}`, import.meta.url), 'utf8');
const licences = doc('docs/MODULOS-LICENCAS.md');
const kz = (minor: number) => Math.round(minor / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const CYCLE_ORDER: BillingCycle[] = ['monthly', 'semiannual', 'annual'];

/** Linhas da tabela que vem a seguir ao marcador `<!-- tabela-… -->`. */
function table(marker: string): string[][] {
  const start = licences.indexOf(`<!-- ${marker}`);
  expect(start, `marcador ${marker} em falta em MODULOS-LICENCAS.md`).toBeGreaterThan(-1);
  const lines = licences.slice(start).split('\n').slice(1);
  const rows: string[][] = [];
  for (const line of lines) {
    if (!line.startsWith('|')) { if (rows.length) break; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // sem o cabeçalho
}

describe('documentação comercial = código', () => {
  it('RH: uma linha por faixa, com os totais mensal, semestral e anual do código', () => {
    const rows = table('tabela-rh');
    expect(rows.map((r) => r[0])).toEqual(DEFAULT_TIERS.map((t) => t.key));
    for (const tier of DEFAULT_TIERS) {
      const row = rows.find((r) => r[0] === tier.key)!;
      expect(row.slice(2), `faixa ${tier.key}`).toEqual(CYCLE_ORDER.map((c) => kz(cyclePrice(tier, c)!.totalMinor)));
    }
  });

  it('Integra: projectos, sectores e preços por ciclo de cada plano', () => {
    const rows = table('tabela-integra');
    expect(rows.map((r) => r[0])).toEqual(MODELING_PLANS.map((p) => p.key));
    for (const plan of MODELING_PLANS) {
      const row = rows.find((r) => r[0] === plan.key)!;
      expect(row[2], `${plan.key}: projectos`).toBe(plan.projectLimit === null ? 'Ilimitados' : String(plan.projectLimit));
      expect(row[3], `${plan.key}: sectores`).toBe(String(plan.sectorLimit));
      expect(row.slice(4), `${plan.key}: preços`).toEqual(CYCLE_ORDER.map((c) => kz(modelingPlanPrice(plan.key, c).totalMinor)));
    }
  });

  it('Valora: análises activas e preços por ciclo de cada plano; extras e utilizadores incluídos', () => {
    const rows = table('tabela-valora');
    expect(rows.map((r) => r[0])).toEqual(VALUATION_PLANS.map((p) => p.key));
    for (const plan of VALUATION_PLANS) {
      const row = rows.find((r) => r[0] === plan.key)!;
      expect(row[1], `${plan.key}: nome`).toBe(plan.label);
      expect(row[2], `${plan.key}: análises`).toBe(plan.analysisLimit === null ? 'Ilimitadas' : String(plan.analysisLimit));
      expect(row.slice(3), `${plan.key}: preços`).toEqual(CYCLE_ORDER.map((c) => kz(valuationPlanPrice(plan.key, c)!.totalMinor)));
    }
    expect(licences).toContain(`**${kz(VALUATION_EXTRA_USER_MONTHLY_MINOR)} Kz por mês e utilizador**`);
    expect(VALUATION_INCLUDED_USERS).toBe(5);
  });

  it('descontos, utilizadores incluídos, extras e o exemplo de cálculo', () => {
    expect(CYCLES.semiannual.discountBps).toBe(1000);
    expect(CYCLES.annual.discountBps).toBe(1500);
    expect(licences).toContain('Semestral −10%, anual −15%');
    expect(licences).toContain(`**${MODELING_INCLUDED_USERS} utilizadores**`);
    expect(licences).toContain(`**${kz(MODELING_EXTRA_USER_MONTHLY_MINOR)} Kz por mês e utilizador**`);
    expect(licences).toContain(`**${kz(modelingPlanPrice('corporate', 'semiannual', 2).totalMinor)} Kz**`);
  });

  it('nenhum documento repete o desconto anual antigo (−20%)', () => {
    for (const name of ['README.md', 'docs/HANDOFF.md', 'docs/ROADMAP.md', 'docs/MODULOS-LICENCAS.md', 'docs/INTEGRA_MODULE.md']) {
      expect(doc(name), name).not.toMatch(/[−-]20 ?%/);
    }
  });
});
