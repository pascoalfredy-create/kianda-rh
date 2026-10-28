import type { FinancialHistoricalInput } from '../../src/modeling/historical.js';
export function historyCsv(entries: [string, number][]) {
  return 'Conta;Designação;Saldo Devedor;Saldo Credor\n' + entries.map(([code, value]) => `${code};Conta ${code};${value >= 0 ? value.toFixed(2) : ''};${value < 0 ? (-value).toFixed(2) : ''}`).join('\n');
}
export const beforeHistory: [string, number][] = [['11', 1000], ['18', -200], ['26', 300], ['31.1', 250], ['31.2', -50], ['32.1', -200], ['32.2', 20], ['33', -300], ['34.1', 10], ['34.2', -40], ['43', 150], ['51', -500], ['81', -340], ['61', -1000], ['71', 600], ['72', 100], ['73', 50], ['75.2', 100], ['76', 20], ['87', 30]];
export const currentHistory: [string, number][] = [['11', 1100], ['18', -250], ['26', 350], ['31.1', 300], ['31.2', -30], ['32.1', -240], ['32.2', 15], ['33', -280], ['34.1', 8], ['34.2', -45], ['43', 180], ['51', -500], ['81', -458], ['61', -1200], ['71', 700], ['72', 120], ['73', 60], ['75.2', 110], ['76', 22], ['87', 38]];
export const historicalInput: FinancialHistoricalInput = { empresa: 'Empresa de teste', anos: ['2024', '2025'], N1: historyCsv(beforeHistory), N: historyCsv(currentHistory), pctCP: 25, moeda: 'Kz' };
