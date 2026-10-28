/** Monta a interface aprovada com ajustes funcionais e de espaço explícitos. O original fica reproduzível. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const web = new URL('apps/web/', root);
const { build } = createRequire(new URL('package.json', web))('esbuild');
const original = await readFile(new URL('modeling/prototype.html', web), 'utf8');
const begin = original.indexOf('<script>'), end = original.lastIndexOf('</script>');
if (begin < 0 || end < begin) throw new Error('Estrutura inesperada do protótipo');
const shell = original.slice(0, begin), suffix = original.slice(end + '</script>'.length);
let source = original.slice(begin + '<script>'.length, end);
function span(start, stop, replacement) {
  const a = source.indexOf(start), b = source.indexOf(stop, a);
  if (a < 0 || b < a) throw new Error('Bloco não encontrado: ' + start);
  source = source.slice(0, a) + replacement + source.slice(b);
}
function replace(from, to) { if (!source.includes(from)) throw new Error('Expressão não encontrada: ' + from); source = source.replaceAll(from, to); }
const dialogStart = source.indexOf('newM:()=>openModal('), dialogEnd = source.indexOf('   createM:', dialogStart);
const dialog = source.slice(dialogStart + 'newM:'.length, dialogEnd).trim().replace(/,$/, '');
span('function newModel(', '/* ---------------- Estado', `function newModel(sk,over={}){const t=templates.find(t=>t.sector===sk);if(!t)throw Error('Modelo-tipo indisponível');return Object.assign(clone(t.assumptions),{id:'',sector:sk,moeda:t.currency,nome:SECT[sk].m.nome||t.name,criado:new Date().toISOString().slice(0,10)},over);}\n\n`);
span('let S;', '/* ---------------- Motor', `let S={models:[],active:null,unit:'M',an:null};\nconst M=()=>S.models.find(m=>m.id===S.active)||S.models[0];\n\n`);
span('/* ---------------- Motor', '/* ---------------- Formatação', `function run(m,ov={}){return runFinancialModel(m,ov);}\nfunction breakEvenPrice(m){return financialBreakEvenPrice(m);}\nfunction waccOf(m){try{return run(m).wacc}catch{return null}}\nfunction keOf(m){try{return run(m).ke}catch{return null}}\n\n`);
replace('function render(){', 'function renderPrototype(){');
replace('function liveStrip(){', 'function liveStripPrototype(){');
replace('value="${v}">', 'value="${esc(v??\'\')}">');
replace("[['Kz','Kwanza (Kz)'],['USD','Dólar (USD)']]", "[['Kz','Kwanza (Kz)'],['USD','Dólar (USD)'],['EUR','Euro (EUR)']]");
replace("M().moeda==='USD'?'USD':'Kz'", 'M().moeda');
replace("m.moeda==='USD'?2:1", "m.moeda==='Kz'?1:2");
replace("m.moeda==='USD'?2:0", "m.moeda==='Kz'?0:2");
replace('Projectos com receitas em USD (petróleo, minérios) modelam-se em USD', 'Ao mudar de moeda, indique ou confirme o câmbio para converter os montantes');
replace("'Ao mudar de moeda, indique ou confirme o câmbio para converter os montantes'", 'currencyConversionHint(m)');
replace("'USD: inflação internacional'", "cur+': inflação esperada nesta moeda'");
replace("'Moeda do modelo'", "'Moeda do projecto e dos mapas'");
replace('<div class="sub">${s}</div>', '<div class="sub">${s}${mapCurrencyContext()}</div>');
// Os valores editáveis do investimento são unidades; totais e amortizações do mesmo quadro também.
replace('money(c.valor/c.vida)', 'assumptionMoney(c.valor/c.vida)');
replace('money(m.capex.reduce((s,c)=>s+ +c.valor,0))', 'assumptionMoney(m.capex.reduce((s,c)=>s+ +c.valor,0))');
replace("'Financiamento em USD'", "'Financiamento em '+cur");
replace("cur==='USD'?'US Treasury 10 anos':'Obrigações do Tesouro em Kz'", "cur==='Kz'?'Obrigações do Tesouro em Kz':'Taxa sem risco em '+cur");
replace("cur==='USD'?'Risco Angola sobre activos em USD':'0 se a taxa sem risco já é em Kz'", "cur==='Kz'?'0 se a taxa sem risco já incorpora o risco país':'Prémio de risco país coerente com '+cur");
replace("const closeModal=()=>$('#ov').classList.remove('on');", "function closeModal(){currencyDialog=null;$('#ov').classList.remove('on');}");
replace('data-act="copyFS">${ico(\'copy\')}Copiar (CSV)', 'data-act="downloadFS">${ico(\'doc\')}Descarregar PDF');
replace('data-act="repCopy">${ico(\'copy\')}Copiar texto', 'data-act="downloadReport">${ico(\'doc\')}Descarregar PDF');
// A análise usa o mesmo core no browser/API; os formulários e tabelas originais são preservados.
span('function pNum(', 'const RDEF=', '');
span('const RDEF=', 'function rStatus(', 'const RDEF=HISTORICAL_RATIO_DEFINITIONS;\n');
span('function analyze(){', 'VIEWS.analise=', '');
replace("a?.anos?.[0]||'2024'", "a?.anos?.[0]||String(new Date().getFullYear()-1)");
replace("a?.anos?.[1]||'2025'", "a?.anos?.[1]||String(new Date().getFullYear())");
replace("<option ${a?.moeda==='USD'?'selected':''}>USD</option>", "<option ${a?.moeda==='USD'?'selected':''}>USD</option><option ${a?.moeda==='EUR'?'selected':''}>EUR</option>");
replace('Saldo Devedor/Credor, Débito/Crédito ou Saldo', 'Saldo Devedor/Credor, Débito/Crédito acumulados incluindo abertura, ou Saldo');
replace('accept=".csv,.txt"', 'accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"');
for (const number of [1,2]) replace(`id="anF${number}" accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf" style="margin-top:6px;font-size:12px">`, `id="anF${number}" accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf" style="margin-top:6px;font-size:12px"><span class="import-status" id="anStatus${number}" role="status" aria-live="polite"></span>`);
replace('Aceita colunas Saldo Devedor/Credor', 'PDF com texto, CSV ou TXT. Confira as contas extraídas antes de premir Analisar. Aceita colunas Saldo Devedor/Credor');
span('    const B=cN.B,B1=c1.B,P=cN.P;', "    const R=(n,v,c='')", `    const B=cN.B,B1=c1.B,P=cN.P,f=A.cashFlow;const {dEx,dCl,dOA,dFo,dOP,dPr,cfo,cfi,dEmp,dCap,cff}=f;const capexA=f.investment,div=-f.otherEquity,dCx=f.change,res=f.difference;\n`);
replace('Aquisições líquidas de imobilizado e investimentos', 'Investimento líquido estimado (activos + amortizações)');
replace('Dividendos / distribuições (implícitos)', 'Distribuições / outros movimentos de capital próprio, líquidos');
replace('Carregue o balancete N−1 para obter o fluxo de caixa (método indirecto).', 'Carregue o balancete N−1 para estimar o fluxo de caixa (método indirecto).');
replace('<h3>Leitura</h3></div><div class="bd" style="font-size:13px;color:var(--ink2)"><div class="ratio"><span>Conversão de EBITDA em caixa', '<h3>Leitura</h3></div><div class="bd" style="font-size:13px;color:var(--ink2)"><p>Fluxo estimado a partir dos saldos. Alienações, reavaliações, câmbio e movimentos sem caixa exigem conferência com o diário; a reconciliação é algébrica.</p><div class="ratio"><span>Conversão de EBITDA em caixa');
span('  const diag=[];', '  return head+tabs+`<div class="grid g4"', `  const diag=A.diagnostics.map(d=>[d.status,d.label+': '+rFmt(d.value,d.format)]);for(const warning of A.warnings)diag.push(['a',esc(warning)]);\n`);
replace("VIEWS.relatorios=()=>{const m=M();const R=run(m);const cur=SUB.rep||'sumario';", "VIEWS.relatorios=()=>{const m=M();const cur=SUB.rep||'sumario';const R=cur==='analise'?null:run(m);");
replace("(ou use o exemplo) para gerar este relatório.", "para gerar este relatório.");
replace("capacidade para novo endividamento':'margem reduzida para nova dívida", "abaixo do limiar indicativo':'acima do limiar indicativo");
replace("M().cenarios[c][f]=Number(i.value)||1", "const value=Number(i.value);if(!Number.isFinite(value)||value<0||value>10){i.value=M().cenarios[c][f];return toast('O multiplicador deve estar entre 0 e 10.')}M().cenarios[c][f]=value");
replace('reporte de prejuízos fiscais por 5 anos.', 'reporte de prejuízos fiscais por ${m.prejuizosAnos??5} anos.');
// Intervalos de stress inválidos (ex.: Gordon com g >= WACC) ficam indisponíveis, sem fabricar zero.
replace('return run(mm).npv;', 'return optionalNpv(mm);');
replace('const wR=[1.1,0.9].map(f=>run(m,{wacc:f}).npv);', 'const wR=[1.1,0.9].map(f=>optionalNpv(m,{wacc:f}));');
replace('const mlo=k.ebitda[1]*m.mult.lo,mhi=k.ebitda[1]*m.mult.hi;', 'const mlo=R.multiples.enterpriseLow,mhi=R.multiples.enterpriseHigh;');
replace('const adj=v=>ex?v-R.netDebt0:v;', 'const adj=v=>Number.isFinite(v)?(ex?v-R.netDebt0:v):null;');
replace('Math.min(...gR)', 'validRange(gR,Math.min)'); replace('Math.max(...gR)', 'validRange(gR,Math.max)');
replace('Math.min(...xR)', 'validRange(xR,Math.min)'); replace('Math.max(...xR)', 'validRange(xR,Math.max)');
replace('hBars(rows,{center:ex?R.eqVal:R.npv})', 'hBars(rows.filter(r=>Number.isFinite(r.lo)&&Number.isFinite(r.hi)),{center:ex?R.eqVal:R.npv})');
// O teste de crédito considera todos os anos com serviço, incluindo carência só de capital.
replace("k.princ[t]>0&&k.dscr[t]<m.cov.dscr", "k.ds[t]>0&&k.dscr[t]<m.cov.dscr");
replace("t>=1&&k.debt[t-1]>0&&brk(t).length", "t>=1&&(k.ds[t]>0||k.debt[t]>0)&&brk(t).length");
replace("t>=1&&k.debt[t-1]>0?brk(t):null", "t>=1&&(k.ds[t]>0||k.debt[t]>0)?brk(t):null");
span('function fsCSV(){', '/* ---------------- Eventos', '');
source = source.slice(0, source.indexOf('/* ---------------- Eventos'));
const adapter = (await readFile(new URL('modeling/adapter.js', web), 'utf8')).replace('__NEW_MODEL_DIALOG__', dialog);
const imports = `import {runFinancialModel} from '${fileURLToPath(new URL('packages/core/src/modeling/engine.ts', root))}';\nimport {financialBreakEvenPrice} from '${fileURLToPath(new URL('packages/core/src/modeling/analysis.ts', root))}';\nimport {FinancialModelError} from '${fileURLToPath(new URL('packages/core/src/modeling/types.ts', root))}';\nimport {analyzeFinancialHistory,HISTORICAL_RATIO_DEFINITIONS} from '${fileURLToPath(new URL('packages/core/src/modeling/historical.ts', root))}';\nimport {ModelingStore,modelingRequest} from '${fileURLToPath(new URL('modeling/store.ts', web))}';\nimport {extractPdfTrialBalance,PDF_IMPORT_LIMIT} from '${fileURLToPath(new URL('modeling/pdf-import.ts', web))}';\n`;
const result = await build({ stdin: { contents: imports + source + adapter, resolveDir: fileURLToPath(web), sourcefile: 'integra-ui.js' }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', write: false, logLevel: 'silent' });
const js = result.outputFiles[0].text;
const digest = (s) => createHash('sha256').update(s).digest('hex');
const spaceCss = await readFile(new URL('modeling/space.css', web), 'utf8');
const generated = `// Gerado por scripts/build-modeling-ui.mjs. Referência original preservada, ajustes pedidos isolados.\nexport const MODELING_SHELL = ${JSON.stringify(shell)};\nexport const MODELING_SUFFIX = ${JSON.stringify(suffix)};\nexport const MODELING_SPACE_CSS = ${JSON.stringify(spaceCss)};\nexport const MODELING_ASSET_HASH = '${digest(js).slice(0,16)}';\nexport const MODELING_REFERENCE_HASH = '${digest(original)}';\n`;
await mkdir(new URL('lib/modeling/', web), { recursive: true });
for (const [path, data] of [['lib/modeling/generated.ts', generated], ['public/modeling-runtime.js', js]]) {
  const url = new URL(path, web);
  if (process.argv.includes('--check')) {
    if (await readFile(url, 'utf8').catch(() => '') !== data) throw new Error('Regenerar a interface: pnpm --filter @kianda/web modeling:generate (' + path + ')');
  } else await writeFile(url, data);
}
console.log(process.argv.includes('--check') ? 'Integra: interface e motor gerados estão actualizados.' : 'Integra: interface gerada; CSS e estrutura preservados.');
