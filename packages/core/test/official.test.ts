import { describe, expect, it } from 'vitest';
import { AGT_MAP_COLUMNS, AGT_SIMPLE_COLUMNS, agtMapRow, agtMunicipality, agtProvince, agtSimpleRow, bankAmount, bankDescription, bankFromIban, inssSheetRow, nbaFromIban } from '../src/index.js';

describe('formatos oficiais', () => {
  it('províncias: siglas da AGT, com e sem acentos; novas províncias provisórias', () => {
    expect(agtProvince('Luanda')).toEqual({ code: 'LA' });
    expect(agtProvince('huila')).toEqual({ code: 'HA' });
    expect(agtProvince('Lunda Norte')?.code).toBe('LN');
    expect(agtProvince('Icolo e Bengo')).toEqual({ code: 'LA', provisional: true });
    expect(agtProvince('LS')?.code).toBe('LS');
    expect(agtProvince('Atlântida')).toBeNull();
  });

  it('municípios: grafia oficial da lista do template; fora da província = null', () => {
    expect(agtMunicipality('LA', 'belas')).toBe('BELAS');
    expect(agtMunicipality('LN', 'Cuango')).toBe('CUANGO');
    expect(agtMunicipality('LA', 'Icolo e Bengo')).toBe('ICOLO E BENGO');
    expect(agtMunicipality('LA', 'Lubango')).toBeNull();
    expect(agtProvince('Huíla')).toEqual({ code: 'HA' });
  });

  const input = {
    nif: '004512398LA041', name: 'Joana', inssNumber: '123', province: 'LA', municipality: 'BELAS', allowanceExemptionMinor: 3_000_000,
    breakdown: [
      { code: 'BASE', kind: 'earning', amountMinor: 42_000_000 }, { code: 'ALIM', kind: 'earning', amountMinor: 3_000_000 },
      { code: 'TRANSP', kind: 'earning', amountMinor: 2_500_000 }, { code: 'HE', kind: 'earning', amountMinor: 1_000_000 },
      { code: 'BONUS', kind: 'earning', amountMinor: 500_000 }, { code: 'SUBTURNO', kind: 'earning', amountMinor: 8_400_000 },
      { code: 'OUTABON', kind: 'earning', amountMinor: 200_000 },
      { code: 'FALTAS', kind: 'earning', amountMinor: -1_909_091 }, { code: 'CORTE', kind: 'earning', amountMinor: -100_000 },
      { code: 'INSS', kind: 'deduction', amountMinor: 1_500_000 },
    ],
    // OUTABON de 2 000 Kz fora do IRT: ilíquido 55 590 909; base IRT = ilíquido − alimentação − transporte − 2 000 Kz.
    grossMinor: 55_590_909, inssBaseMinor: 50_090_909, inssEmployeeMinor: 1_502_727, irtMinor: 7_000_000, irtTaxableMinor: 48_388_182,
  };

  it('template A2.1: 32 colunas, abonos nos grupos certos, descontos em positivo, base IRT = matéria colectável', () => {
    const row = agtMapRow(input);
    const v = (c: (typeof AGT_MAP_COLUMNS)[number]) => row[AGT_MAP_COLUMNS.indexOf(c)];
    expect(AGT_MAP_COLUMNS).toHaveLength(32);
    expect(row).toHaveLength(32);
    expect([v('Salário Base'), v('Subsídio Alimentação'), v('Subsídio Transporte'), v('Horas Extras'), v('Prémios')]).toEqual([42_000_000, 3_000_000, 2_500_000, 1_000_000, 500_000]);
    expect(v('Descontos por Falta')).toBe(2_009_091);
    // Subsídio de turno sujeito; os 2 000 Kz fora do IRT passam para "Outros" (Art. 2.º).
    expect([v('Outros Subsídios Sujeitos'), v('Outros')]).toEqual([8_400_000, 200_000]);
    expect(v('Base Tributável IRT')).toBe(48_388_182);
    expect([v('Cálculo Manual de Excesso de Subsídios?'), v('Registo Manual de Contribuição Segurança Social?'), v('Não Sujeito a Segurança Social?'), v('Isento IRT?')]).toEqual(['N', 'N', 'N', 'N']);
  });

  it('template simplificado: 15 colunas que somam ao ilíquido', () => {
    const s = agtSimpleRow(agtMapRow(input), 3_000_000);
    expect(AGT_SIMPLE_COLUMNS).toHaveLength(15);
    expect(s).toHaveLength(15);
    // Alimentação 30 000 e transporte 25 000 dentro do limite + 2 000 fora do IRT = partes isentas.
    expect([s[6], s[7]]).toEqual([5_700_000, 8_400_000 + 1_000_000 + 500_000]);
    const over = agtSimpleRow(agtMapRow({ ...input, breakdown: input.breakdown.map((l) => (l.code === 'ALIM' ? { ...l, amountMinor: 4_000_000 } : l)), grossMinor: input.grossMinor + 1_000_000, irtTaxableMinor: input.irtTaxableMinor + 1_000_000 }), 3_000_000);
    expect([over[6], over[7]]).toEqual([5_700_000, 9_900_000 + 1_000_000]);
    expect(Number(s[5]) + Number(s[6]) + Number(s[7])).toBe(input.grossMinor);
  });

  it('sem base de Segurança Social (mês suspenso): "S" e base igual ao ilíquido', () => {
    const row = agtMapRow({ ...input, breakdown: [], grossMinor: 0, inssBaseMinor: 0, inssEmployeeMinor: 0, irtMinor: 0, irtTaxableMinor: 0 });
    expect(row[AGT_MAP_COLUMNS.indexOf('Não Sujeito a Segurança Social?')]).toBe('S');
  });

  it('folha do INSS: salário base + remunerações adicionais = base de incidência', () => {
    expect(inssSheetRow({ breakdown: input.breakdown, inssBaseMinor: 50_090_909 })).toEqual({ baseMinor: 39_990_909, additionalMinor: 10_100_000, totalMinor: 50_090_909 });
  });

  it('bancos: código no IBAN, NBA de 21 algarismos, valor e descrição no formato do BFA', () => {
    expect(bankFromIban('AO06 0040 0000 5521 8890 1015 5')).toMatchObject({ code: '0040', short: 'BAI', bic: 'BAIPAOLU' });
    expect(bankFromIban('AO06000600006030746830165')?.short).toBe('BFA');
    expect(bankFromIban('AO06009900000000000000000')?.short).toBe('0099');
    expect(nbaFromIban('AO06 0040 0000 5521 8890 1015 5')).toBe('004000005521889010155');
    expect(bankAmount(125_000_000)).toBe('1250000,00');
    expect(bankAmount(5)).toBe('0,05');
    expect(bankDescription('Salário de Dezembro 2026')).toBe('SALARIO DE DEZEMBRO');
  });
});
