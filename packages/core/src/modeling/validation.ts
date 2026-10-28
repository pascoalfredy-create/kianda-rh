import { FinancialModelError, type FinancialAssumptions, type FinancialOverrides, type FinancialScenario } from './types.js';

type Obj = Record<string, unknown>;
/** Validação independente de I/O; rascunhos incompletos podem ser guardados, mas não calculados. */
export function validateFinancialAssumptions(value: unknown): FinancialAssumptions {
  const issues: { path: string; message: string }[] = [];
  const obj = (v: unknown, path: string): Obj => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { issues.push({ path, message: 'Objecto obrigatório' }); return {}; }
    return v as Obj;
  };
  const n = (o: Obj, key: string, path = key, min = 0, max = 1e12, fallback?: number, integer = false): number => {
    const v = o[key] === undefined && fallback !== undefined ? fallback : o[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || integer && !Number.isInteger(v)) {
      issues.push({ path, message: `Número ${integer ? 'inteiro ' : ''}entre ${min} e ${max}` }); return fallback ?? min;
    }
    return v;
  };
  const en = <T extends string>(o: Obj, key: string, allowed: readonly T[], path = key): T => {
    if (!allowed.includes(o[key] as T)) { issues.push({ path, message: `Use ${allowed.join(', ')}` }); return allowed[0]!; }
    return o[key] as T;
  };
  const bool = (o: Obj, key: string, fallback: boolean) => {
    if (o[key] === undefined) return fallback;
    if (typeof o[key] !== 'boolean') { issues.push({ path: key, message: 'Use verdadeiro ou falso' }); return fallback; }
    return o[key] as boolean;
  };
  const text = (o: Obj, key: string, path: string) => {
    if (typeof o[key] !== 'string' || (o[key] as string).length > 300) { issues.push({ path, message: 'Texto até 300 caracteres' }); return ''; }
    return o[key] as string;
  };
  const list = (o: Obj, key: string, max: number) => {
    if (!Array.isArray(o[key]) || o[key].length > max) { issues.push({ path: key, message: `Lista até ${max} elementos` }); return []; }
    return o[key] as unknown[];
  };
  const o = obj(value, 'assumptions');
  const horizonte = n(o, 'horizonte', 'horizonte', 1, 40, undefined, true);
  const d = obj(o.divida, 'divida'), w = obj(o.wacc, 'wacc'), tv = obj(o.tv, 'tv'), ab = obj(o.abertura, 'abertura');
  const s = obj(o.cenarios, 'cenarios'), cov = obj(o.cov, 'cov'), mult = o.mult === undefined ? {} : obj(o.mult, 'mult');
  const cenarios = {} as FinancialAssumptions['cenarios'];
  for (const key of ['base', 'otim', 'pess'] as const) {
    const sc = obj(s[key], `cenarios.${key}`);
    cenarios[key] = { preco: n(sc, 'preco', `cenarios.${key}.preco`, 0, 10), volume: n(sc, 'volume', `cenarios.${key}.volume`, 0, 10), opex: n(sc, 'opex', `cenarios.${key}.opex`, 0, 10), capex: n(sc, 'capex', `cenarios.${key}.capex`, 0, 10) };
  }
  const m: FinancialAssumptions = {
    horizonte, anoBase: n(o, 'anoBase', 'anoBase', 1900, 2200, undefined, true), inicio: en(o, 'inicio', ['greenfield', 'existente']), inicioOp: n(o, 'inicioOp', 'inicioOp', 1, horizonte, undefined, true),
    preOp: n(o, 'preOp', 'preOp', 0, 100), inflacao: n(o, 'inflacao', 'inflacao', -99, 200), ii: n(o, 'ii', 'ii', 0, 100), royalty: n(o, 'royalty', 'royalty', 0, 100), cvar: n(o, 'cvar', 'cvar', 0, 100),
    pessoal: n(o, 'pessoal'), fst: n(o, 'fst'), outros: n(o, 'outros'), manut: n(o, 'manut', 'manut', 0, 100), vidaManut: n(o, 'vidaManut', 'vidaManut', 1, 100, undefined, true),
    dso: n(o, 'dso', 'dso', 0, 730), dio: n(o, 'dio', 'dio', 0, 730), dpo: n(o, 'dpo', 'dpo', 0, 730), capitalInicial: n(o, 'capitalInicial'), payout: n(o, 'payout', 'payout', 0, 100), caixaMin: n(o, 'caixaMin'),
    divida: { montante: n(d, 'montante', 'divida.montante'), taxa: n(d, 'taxa', 'divida.taxa', 0, 200), prazo: n(d, 'prazo', 'divida.prazo', 1, 100, undefined, true), carencia: n(d, 'carencia', 'divida.carencia', 0, 99, undefined, true), ano: n(d, 'ano', 'divida.ano', 0, horizonte, undefined, true), jurosDesembolso: n(d, 'jurosDesembolso', 'divida.jurosDesembolso', 0, 100, 50) },
    wacc: { modo: en(w, 'modo', ['manual', 'capm'], 'wacc.modo'), rf: n(w, 'rf', 'wacc.rf', 0, 200), erp: n(w, 'erp', 'wacc.erp', 0, 100), beta: n(w, 'beta', 'wacc.beta', 0, 10), crp: n(w, 'crp', 'wacc.crp', 0, 100), kd: n(w, 'kd', 'wacc.kd', 0, 200), wd: n(w, 'wd', 'wacc.wd', 0, 100), manual: n(w, 'manual', 'wacc.manual', 0, 300) },
    tv: { metodo: en(tv, 'metodo', ['nenhum', 'gordon', 'multiplo'], 'tv.metodo'), g: n(tv, 'g', 'tv.g', -99, 200), mult: n(tv, 'mult', 'tv.mult', 0, 100) },
    abertura: { imob: n(ab, 'imob', 'abertura.imob'), vidaRem: n(ab, 'vidaRem', 'abertura.vidaRem', 1, 100, undefined, true), exist: n(ab, 'exist', 'abertura.exist'), clientes: n(ab, 'clientes', 'abertura.clientes'), caixa: n(ab, 'caixa', 'abertura.caixa'), fornec: n(ab, 'fornec', 'abertura.fornec'), divida: n(ab, 'divida', 'abertura.divida'), divTaxa: n(ab, 'divTaxa', 'abertura.divTaxa', 0, 200), divPrazo: n(ab, 'divPrazo', 'abertura.divPrazo', 1, 100, undefined, true) },
    receitas: list(o, 'receitas', 100).map((v, i) => {
      const r = obj(v, `receitas.${i}`), path = `receitas.${i}`;
      const ramp = text(r, 'ramp', `${path}.ramp`);
      const parts = ramp.trim().split(/[,;\s]+/);
      if (!ramp.trim() || parts.some((x) => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(x) || Number(x) > 100)) issues.push({ path: `${path}.ramp`, message: 'Percentagens de capacidade entre 0 e 100, separadas por vírgula (ex.: 40,75,100)' });
      return { nome: text(r, 'nome', `${path}.nome`), unid: text(r, 'unid', `${path}.unid`), qtd: n(r, 'qtd', `${path}.qtd`), preco: n(r, 'preco', `${path}.preco`), cresc: n(r, 'cresc', `${path}.cresc`, -100, 200), esc: n(r, 'esc', `${path}.esc`, -99, 200), ramp };
    }),
    capex: list(o, 'capex', 200).map((v, i) => { const c = obj(v, `capex.${i}`), path = `capex.${i}`; return { nome: text(c, 'nome', `${path}.nome`), ano: n(c, 'ano', `${path}.ano`, 0, horizonte, undefined, true), valor: n(c, 'valor', `${path}.valor`), vida: n(c, 'vida', `${path}.vida`, 1, 100, undefined, true) }; }),
    cenarios, cen: en(o, 'cen', ['base', 'otim', 'pess']),
    cov: { dscr: n(cov, 'dscr', 'cov.dscr', 0.01, 100), ndEbitda: n(cov, 'ndEbitda', 'cov.ndEbitda', 0, 100, 3.5), icr: n(cov, 'icr', 'cov.icr', 0, 100, 3) }, mult: { lo: n(mult, 'lo', 'mult.lo', 0, 100, 4), hi: n(mult, 'hi', 'mult.hi', 0, 100, 7) }, sens: n(o, 'sens', 'sens', 0, 99, 20), prejuizosAnos: n(o, 'prejuizosAnos', 'prejuizosAnos', 0, 20, 5, true),
    capitalAutomatico: bool(o, 'capitalAutomatico', true), valorResidualLiquido: n(o, 'valorResidualLiquido', 'valorResidualLiquido', 0, 1e12, 0), libertarFundoManeio: bool(o, 'libertarFundoManeio', false),
  };
  if (m.mult.lo > m.mult.hi) issues.push({ path: 'mult', message: 'O múltiplo mínimo não pode superar o máximo' });
  if (m.divida.montante > 0 && m.divida.carencia >= m.divida.prazo) issues.push({ path: 'divida.carencia', message: 'A carência deve ser inferior ao prazo' });
  if (m.tv.metodo !== 'nenhum' && (m.valorResidualLiquido || m.libertarFundoManeio)) issues.push({ path: 'tv', message: 'Valor residual e libertação do fundo de maneio exigem projecto finito (sem valor terminal de continuidade)' });
  if (issues.length) throw new FinancialModelError(issues);
  return m;
}

export function validateFinancialOverrides(value: FinancialOverrides): FinancialOverrides {
  const issues: { path: string; message: string }[] = [];
  if (value.cen !== undefined && !(['base', 'otim', 'pess'] as FinancialScenario[]).includes(value.cen)) issues.push({ path: 'cen', message: 'Cenário inválido' });
  for (const key of ['preco', 'volume', 'cvar', 'fixos', 'capex', 'wacc'] as const) {
    const v = value[key];
    if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 1000 || key === 'wacc' && v === 0)) issues.push({ path: key, message: 'Multiplicador inválido' });
  }
  if (issues.length) throw new FinancialModelError(issues);
  return value;
}
