import { describe, expect, it } from 'vitest';
import { employeeImportMappingProblem, employeeImportSourceRows, guessEmployeeImportMapping, parseEmployeeImport, type EmployeeImportOptions, type EmployeeImportSourceRow } from '../src/employee-import.js';
const options: EmployeeImportOptions = { salaryEffectiveDate: '2026-11-01', defaultContractType: 'indefinite', defaultCurrency: 'AOA', createDepartments: true, skipExisting: false };
const row = (values = {}): EmployeeImportSourceRow => ({ line: 3, values: { number: '0001', name: 'Ana Exemplo', jobTitle: 'Técnica', startDate: '04/03/2024', base: '150.000,25', ...values } });
describe('entrada de bases de colaboradores', () => {
  it('associa cabeçalhos conhecidos e nunca interpreta líquido como salário base', () => {
    const h = ['Matrícula', 'Nome', 'Cargo', 'Admissão', 'Líquido', 'Salário base (Kz)'];
    const map = guessEmployeeImportMapping(h);
    expect(map).toMatchObject({ number: 0, name: 1, jobTitle: 2, startDate: 3, base: 5 });
    expect(employeeImportMappingProblem(map)).toBeNull();
    delete map.base; expect(employeeImportMappingProblem(map)).toContain('Salário base');
    expect(guessEmployeeImportMapping(['Salário líquido', 'Total ilíquido']).base).toBeUndefined();
  });
  it('mantém zeros, números decimais nativos do Excel e números de linha da origem', () => {
    const map = guessEmployeeImportMapping(['N.º mecanográfico', 'Nome', 'Função', 'Data de admissão', 'Salário base']);
    const source = employeeImportSourceRows([['Título'], ['N.º mecanográfico', 'Nome', 'Função', 'Data de admissão', 'Salário base'], ['0001', 'Ana Exemplo', 'Técnica', '2024-03-04', 1234.56], [], ['N.º mecanográfico', 'Nome', 'Função', 'Data de admissão', 'Salário base']], 1, map);
    expect(source).toHaveLength(1); expect(source[0]!.line).toBe(3);
    const parsed = parseEmployeeImport(source, options)[0]!;
    expect(parsed.data.number).toBe('0001'); expect(parsed.data.contract.base).toBe(1234.56); expect(parsed.data.contract.startDate).toBe('2024-03-04');
    expect(parseEmployeeImport([row()], options)[0]!.data.contract.base).toBe(150000.25);
  });
  it('distingue admissão e data de remuneração e recusa datas ou identificadores sem precisão', () => {
    const parsed = parseEmployeeImport([row({ startDate: '31/02/2024', iban: 12345678901234567890 })], options)[0]!;
    expect(parsed.errors.join(' ')).toContain('data inválida'); expect(parsed.errors.join(' ')).toContain('perdeu precisão');
    expect(parseEmployeeImport([row({ startDate: '2024-03-04 lixo' })], options)[0]!.errors.length).toBeGreaterThan(0);
    const current = parseEmployeeImport([row()], options)[0]!;
    expect(current.data.salaryEffectiveDate).toBe('2026-11-01'); expect(current.data.contract.startDate).toBe('2024-03-04');
    expect(parseEmployeeImport([row({ salaryEffectiveDate: '01/01/2020' })], options)[0]!.errors.join(' ')).toContain('antes da admissão');
  });
  it('converte datas do Excel em ambos os sistemas e exige câmbio para salário em USD', () => {
    const d1900 = parseEmployeeImport([row({ startDate: 45355 })], options)[0]!.data.contract.startDate;
    const d1904 = parseEmployeeImport([row({ startDate: 45355 - 1462 })], { ...options, dateSystem: '1904' })[0]!.data.contract.startDate;
    expect(d1900).toBe(d1904);
    expect(parseEmployeeImport([row({ currency: 'USD', base: 3000 })], options)[0]!.errors.join(' ')).toContain('câmbio');
    const converted = parseEmployeeImport([row({ currency: 'USD', base: 3000, meal: '10.000,00' })], { ...options, usdRate: 950 })[0]!;
    expect(converted.errors).toEqual([]); expect(converted.data.contract).toMatchObject({ currency: 'USD', baseUsd: 3000, base: 2850000, meal: 10000 });
  });
  it('assinala as duas linhas duplicadas e não inventa fundamento de contrato', () => {
    const a = row({ nif: '0000000012', type: 'A termo' }), b = { ...row({ number: '0002', nif: '0000000012' }), line: 4 };
    const parsed = parseEmployeeImport([a, b], options);
    expect(parsed.every(r => r.errors.join(' ').includes('repetido'))).toBe(true);
    expect(parsed[0]!.errors.join(' ')).toContain('fundamento');
  });
  it('normaliza uma base com 1.001 pessoas sem perder a última linha', () => {
    const source = Array.from({ length: 1001 }, (_, i) => ({ line: i + 2, values: { ...row().values, number: String(i + 1).padStart(6, '0') } }));
    const parsed = parseEmployeeImport(source, options);
    expect(parsed).toHaveLength(1001); expect(parsed.every(r => !r.errors.length)).toBe(true);
    expect(parsed[1000]!.data.number).toBe('001001');
  });
});
