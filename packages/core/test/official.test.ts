import { describe, expect, it } from 'vitest';
import { AGT_MAP_COLUMNS, agtMapRow, agtProvince, bankAmount, bankDescription, bankFromIban, nbaFromIban } from '../src/index.js';

describe('formatos oficiais', () => {
  it('províncias: siglas da AGT, com e sem acentos; novas províncias provisórias', () => {
    expect(agtProvince('Luanda')).toEqual({ code: 'LA' });
    expect(agtProvince('huila')).toEqual({ code: 'HA' });
    expect(agtProvince('Lunda Norte')?.code).toBe('LN');
    expect(agtProvince('Icolo e Bengo')).toEqual({ code: 'LA', provisional: true });
    expect(agtProvince('LS')?.code).toBe('LS');
    expect(agtProvince('Atlântida')).toBeNull();
  });

  it('linha do mapa da AGT: abonos nas colunas certas, descontos em positivo, base IRT antes do INSS', () => {
    const row = agtMapRow({
      nif: '004512398LA041', name: 'Joana', inssNumber: '123', province: 'LA', municipality: 'Belas',
      breakdown: [
        { code: 'BASE', kind: 'earning', amountMinor: 42_000_000 }, { code: 'ALIM', kind: 'earning', amountMinor: 3_000_000 },
        { code: 'TRANSP', kind: 'earning', amountMinor: 2_500_000 }, { code: 'HE', kind: 'earning', amountMinor: 1_000_000 },
        { code: 'BONUS', kind: 'earning', amountMinor: 500_000 }, { code: 'SUBTURNO', kind: 'earning', amountMinor: 8_400_000 },
        { code: 'FALTAS', kind: 'earning', amountMinor: -1_909_091 }, { code: 'CORTE', kind: 'earning', amountMinor: -100_000 },
        { code: 'INSS', kind: 'deduction', amountMinor: 1_500_000 },
      ],
      grossMinor: 55_390_909, inssBaseMinor: 50_000_000, inssEmployeeMinor: 1_500_000, irtMinor: 7_000_000, irtTaxableMinor: 48_500_000,
    });
    const v = (c: (typeof AGT_MAP_COLUMNS)[number]) => row[AGT_MAP_COLUMNS.indexOf(c)];
    expect(row).toHaveLength(31);
    expect([v('Salário Base'), v('Subsídio de Alimentação'), v('Subsídio Transporte'), v('Horas Extras'), v('Prémios'), v('Outros')]).toEqual([42_000_000, 3_000_000, 2_500_000, 1_000_000, 500_000, 8_400_000]);
    expect(v('Descontos por Falta')).toBe(2_009_091);
    expect(v('Base Tributável IRT')).toBe(50_000_000);
    expect([v('Cálculo Manual de Excesso de Subsídios'), v('Não Sujeito a Segurança Social?'), v('Isento IRT?')]).toEqual(['N', 'N', 'N']);
  });

  it('sem base de Segurança Social (mês suspenso): "S" e base igual ao ilíquido', () => {
    const row = agtMapRow({ nif: 'X', name: 'Y', inssNumber: '', province: 'LA', municipality: 'Z', breakdown: [], grossMinor: 0, inssBaseMinor: 0, inssEmployeeMinor: 0, irtMinor: 0, irtTaxableMinor: 0 });
    expect(row[AGT_MAP_COLUMNS.indexOf('Não Sujeito a Segurança Social?')]).toBe('S');
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
