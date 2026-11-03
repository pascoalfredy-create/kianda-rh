/**
 * Kianda Valora: monta a interface aprovada (apps/web/valuation/prototype.html) com ajustes explícitos e
 * verificáveis. O original fica intacto e reproduzível; cada alteração falha se o texto esperado mudar.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const web = new URL('apps/web/', root);
const { build } = createRequire(new URL('package.json', web))('esbuild');
const original = await readFile(new URL('valuation/prototype.html', web), 'utf8');
const begin = original.indexOf('<script>'), end = original.lastIndexOf('</script>');
if (begin < 0 || end < begin) throw new Error('Estrutura inesperada do protótipo do Valora');
let shell = original.slice(0, begin), suffix = original.slice(end + '</script>'.length);
let source = original.slice(begin + '<script>'.length, end);

function replaceIn(text, from, to, label) { if (!text.includes(from)) throw new Error(`${label}: expressão não encontrada: ${from.slice(0, 90)}`); return text.replaceAll(from, to); }
const replace = (from, to) => { source = replaceIn(source, from, to, 'Valora/JS'); };
const replaceShell = (from, to) => { shell = replaceIn(shell, from, to, 'Valora/HTML'); };
function span(start, stop, replacement) {
  const a = source.indexOf(start), b = source.indexOf(stop, a);
  if (a < 0 || b < a) throw new Error('Bloco não encontrado: ' + start);
  source = source.slice(0, a) + replacement + source.slice(b);
}
const version = async (name) => JSON.parse(await readFile(new URL(`node_modules/${name}/package.json`, web), 'utf8')).version;

/* ---------- Ortografia da plataforma (Angola, sem o Acordo de 1990), só em texto visível ---------- */
function spelling(text) {
  const guard = [['#ativos', '\u0001A'], ['data-v="ativos"', '\u0001B'], ['v-ativos', '\u0001C'], ['ativos:[', '\u0001D'], ['ativos:render', '\u0001E']];
  for (const [from, to] of guard) text = text.replaceAll(from, to);
  const words = [['Ativos', 'Activos'], ['ativos', 'activos'], ['ATIVOS', 'ACTIVOS'], ['Ativo', 'Activo'], ['ativo', 'activo'], ['ativa', 'activa'], ['Atividades', 'Actividades'], ['atividades', 'actividades'], ['Atividade', 'Actividade'],
    ['direto', 'directo'], ['seletor', 'selector'], ['projetado', 'projectado'], ['projetada', 'projectada'], ['atual', 'actual'], ['atuais', 'actuais'], ['Atual', 'Actual'], ['atualizar', 'actualizar'], ['atualizada', 'actualizada'], ['Atualizar', 'Actualizar'], ['Projeção', 'Projecção'], ['projeção', 'projecção'], ['refletem', 'reflectem'], ['reflete', 'reflecte'], ['ótica', 'óptica'], ['seleção', 'selecção'],
    ['exatamente', 'exactamente'], ['Selecionado', 'Seleccionado'], ['Objeto', 'Objecto'], ['Fator', 'Factor'], ['Egito', 'Egipto'], ['Direção', 'Direcção']];
  for (const [from, to] of words) text = text.replace(new RegExp(`(?<![\\wÀ-ú])${from}(?![\\wÀ-ú])`, 'g'), to);
  for (const [from, to] of guard) text = text.replaceAll(to, from);
  return text;
}
shell = spelling(shell); source = spelling(source);

/* ---------- Estrutura: cabeçalho, menu no telemóvel, anos dinâmicos ---------- */
replaceShell('<div class="brand"><div class="brand-mark">V</div><div><b>Valora</b><small>Análise, gestão & avaliação</small></div></div>',
  '<div class="brand"><div class="brand-mark">V</div><div><b>Valora</b><small>Análise, gestão & avaliação</small></div><button type="button" class="btn valora-menu" id="valoraMenu" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav">☰</button></div>');
replaceShell('<div class="side-foot">Protótipo · dados fictícios<br>Valores em milhões de Kz (Mkz)<br>PGC Angola (Dec. 82/01) · IVA 14%</div>',
  '<div class="side-foot"><span id="valoraFoot"></span>Valores em Kz<br><a href="/modulos" class="valora-link">Módulos e licenças</a> · <button type="button" class="valora-link" id="valoraLogout">Terminar sessão</button></div>');
// Sair do Valora para os outros módulos: sempre à vista no cabeçalho (como no Integra), também no telemóvel.
replaceShell('<button class="btn" id="btnTheme" title="Alternar tema claro/escuro">Tema</button>\n</header>',
  '<button class="btn" id="btnTheme" title="Alternar tema claro/escuro">Tema</button>\n  <a class="btn valora-modules" href="/modulos" id="valoraModules">Módulos e licenças</a><button type="button" class="btn" id="valoraLogoutTop">Terminar sessão</button>\n</header>');
replaceShell('<p class="intro">Demonstrações por natureza (PGC Angola: <b>', '<p class="intro">Demonstrações por natureza (<b>');
replace(' segundo o PGC Angola, com exercício comparativo', ', com exercício comparativo');
replaceShell('<div class="entity"><b id="hdrEnt">Kalunga Distribuição, S.A.</b><span class="pill" id="pillFecho">Fecho: Out 2026</span></div>',
  '<button type="button" class="entity" id="btnEntity" title="Mudar de análise"><b id="hdrEnt">—</b><span class="pill" id="pillFecho">—</span></button><span class="hint" id="valoraSave" role="status" aria-live="polite"></span><button class="btn pri" id="btnAnalyses">Análises</button>');
replaceShell('<p class="sub">Mkz · 2021–2025 real, 2026 previsão, 2027–2030 projecção DCF</p>', '<p class="sub" id="valoraRevYears"></p>');
replaceShell('Grelha de dados reais 2026', 'Grelha de dados reais <span class="valora-ex"></span>');
replaceShell('previsão de 2026 (real', 'previsão de <span class="valora-ex"></span> (real');
replaceShell('<button class="btn" id="jReset">Repor exemplo</button>', '');
replaceShell('<p class="hint" style="margin:0 0 10px">Copie para guardar, ou cole um conjunto de dados com a mesma estrutura e aplique.</p>',
  '<p class="hint" style="margin:0 0 10px">Cópia técnica da análise aberta. Pode colar uma estrutura equivalente e aplicar: o servidor valida-a antes de gravar.</p>');
replaceShell('<div class="wrap">', '<div id="valoraBanner" class="valora-banner" role="status" hidden></div><div class="wrap">');
shell += '<div class="modal" id="valoraDialog" role="dialog" aria-modal="true" aria-labelledby="valoraDialogTitle"><div class="box" id="valoraDialogBox"></div></div>\n';

/* ---------- Motor: exercício por análise e análises sem meses reais (fecho 0) ---------- */
replace('const EX=2026;', 'let EX=2026;');
replace("    else{\n      M=[...R];\n      if(D.fecho<12){", "    else if(D.fecho===0){M=engine(D.orc,{open:open25(),hist:hist25()}).map(x=>({...x,src:'prev'}))}\n    else{\n      M=[...R];\n      if(D.fecho<12){");
replace("o.push(['ytd',`Acumulado Jan–${MES[f-1]}`]);", "if(f>0)o.push(['ytd',`Acumulado Jan–${MES[f-1]}`]);");
replace("if(!opts.find(o=>o[0]===UI.ctl))UI.ctl='ytd';", "if(!opts.find(o=>o[0]===UI.ctl))UI.ctl=opts[0][0];");
replace("$('#ctlNote').textContent=fy?`Previsão = real Jan–${MES[D.fecho-1]} + orçamento ${MES[D.fecho]||''}${D.fecho<12?'–Dez':''}`", "$('#ctlNote').textContent=fy?(D.fecho===0?'Sem meses reais: a previsão é o orçamento do ano.':`Previsão = real Jan–${MES[D.fecho-1]} + orçamento ${MES[D.fecho]||''}${D.fecho<12?'–Dez':''}`)");
replace("$('#pillFecho').textContent=`Fecho: ${MES[D.fecho-1]} ${EX}`;", "$('#pillFecho').textContent=valoraFechoLabel();");
replace("$('#selFecho').innerHTML=MES.map((m,i)=>`<option value=\"${i+1}\" ${i+1===D.fecho?'selected':''}>${m} ${EX}</option>`).join('');",
  "$('#selFecho').innerHTML=`<option value=\"0\" ${D.fecho===0?'selected':''}>Sem meses reais</option>`+MES.map((m,i)=>`<option value=\"${i+1}\" ${i+1===D.fecho?'selected':''}>${m} ${EX}</option>`).join('');");

/* ---------- Persistência no servidor (sem localStorage para os dados) ---------- */
replace("function save(){try{localStorage.setItem('valora-v3',JSON.stringify(D));localStorage.setItem('valora-ui',JSON.stringify(UI))}catch(e){}}",
  "function save(){try{localStorage.setItem('valora-ui',JSON.stringify(UI))}catch(e){}valoraPersist()}");
span('function init(reset){', 'init();compute();route();', '');
replace('init();compute();route();', '');
replace("$('#jReset').onclick=()=>{init(true);refresh();$('#json').value=JSON.stringify(D,null,1);$('#jsonMsg').textContent='Dados de exemplo repostos.'};", '');
replace("$('#jApply').onclick=()=>{try{const x=JSON.parse($('#json').value);if(!x.years||!x.dr||!x.bal||!x.orc||!x.real)throw 0;D=x;",
  "$('#jApply').onclick=()=>{try{if(!valoraCanWrite())throw new Error('readonly');const x=JSON.parse($('#json').value);const issue=valoraIssue(x);if(issue){$('#jsonMsg').textContent=issue;return}D=x;EX=D.ex;");

/* ---------- Ficheiros: Excel próprio, bibliotecas locais e descarga no navegador ---------- */
replace("await loadXLSX();const wb=XLSX.read(await file.arrayBuffer(),{type:'array'});const ws=wb.Sheets[wb.SheetNames[0]];return XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null});",
  "if(!name.endsWith('.xlsx'))throw new Error('Use .xlsx ou .csv (o formato .xls antigo não é suportado: guarde de novo como .xlsx).');return await readXlsxRows(await file.arrayBuffer());");
span('function loadXLSX(){', 'async function readFile(file){', '');
const [jspdf, autotable, docx] = await Promise.all(['jspdf', 'jspdf-autotable', 'docx'].map(version));
replace("const LIBS={xlsx:'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',jspdf:'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',autotable:'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',docx:'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'};",
  `const LIBS={jspdf:'/valuation-lib/jspdf-${jspdf}.min.js',autotable:'/valuation-lib/jspdf-autotable-${autotable}.min.js',docx:'/valuation-lib/docx-${docx}.min.js'};`);
replace("await loadLib('xlsx');", '');
replace("const {jsPDF}=window.jspdf,doc=new jsPDF(", "valoraApplyAutoTable();const {jsPDF}=window.jspdf,doc=new jsPDF(");
span('async function saveFile(name,data){', 'const fname=', 'async function saveFile(name,data){valoraDownload(name,data)}\n');
replace("async function runExport(kind){const msg=$('#rep-msg'),btns=document.querySelectorAll('[data-exp]');", "async function runExport(kind){if(!valoraCanExport(kind))return;const msg=$('#rep-msg'),btns=document.querySelectorAll('[data-exp]');");
replace("${rep.title.replace(/[^\\wÀ-ú]+/g,'_')}_${meta().ent.split(/[ ,]/)[0]}_", "${rep.title.replace(/[^\\wÀ-ú]+/g,'_')}_${(meta().ent.split(/[ ,]/)[0]||'analise').replace(/[^\\wÀ-ú-]+/g,'')}_");

/* ---------- Montantes sempre por inteiro: os dados ficam em milhões de Kz, a apresentação é em Kz com 2 casas ---------- */
replace("const f0=v=>v==null||!isFinite(v)?'—':Math.abs(v)<.5?'0':(Math.round(v)<0?'('+nf0.format(-v)+')':nf0.format(v));",
  "const fd=v=>v==null||!isFinite(v)?'—':Math.abs(v)<.5?'0':(Math.round(v)<0?'('+nf0.format(-v)+')':nf0.format(v));\n" +
  "const nfK=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'});\n" +
  "const f0=v=>v==null||!isFinite(v)?'—':Math.abs(v*1e6)<.005?'0,00':(v<0?'('+nfK.format(-v*1e6)+')':nfK.format(v*1e6));");
replace("function fs(v){return isFinite(v)?(v<0?'−':'+')+nf0.format(Math.abs(Math.round(v))):'—'}", "function fs(v){return isFinite(v)?(v<0?'−':'+')+nfK.format(Math.abs(v*1e6)):'—'}");
// Prazos, percentagens e contagens continuam como números simples.
for (const k of ['x.pms', 'x.pmr', 'x.pmp', 'x.ccc', 'py.pmr', 'py.pms', 'py.ccc', 'oy.pmr', 'pmrR', 'pmrO', 'o.subFer', 'o.subNat', 'cx/payD']) replace(`f0(${k})`, `fd(${k})`);
for (const k of ['pmr', 'pmp', 'pms', 'ccc']) replace(`'${k}',f0,' d'`, `'${k}',fd,' d'`);
replace("case 'd':return f0(v)+' d';", "case 'd':return fd(v)+' d';case 'i':return fd(v);");
replace("{v:+c.prazo,k:'n'}", "{v:+c.prazo,k:'i'}");
replace("{l:'Prazo médio de stocks (PMS)',g:p=>p.pms}", "{l:'Prazo médio de stocks (PMS)',g:p=>p.pms,fmt:fd}");
replace("{l:'+ Prazo médio de recebimento (PMR)',g:p=>p.pmr}", "{l:'+ Prazo médio de recebimento (PMR)',g:p=>p.pmr,fmt:fd}");
replace("{l:'− Prazo médio de pagamento (PMP)',g:p=>p.pmp}", "{l:'− Prazo médio de pagamento (PMP)',g:p=>p.pmp,fmt:fd}");
replace("{l:'= Ciclo de conversão de caixa',g:p=>p.ccc,cls:'tot'}", "{l:'= Ciclo de conversão de caixa',g:p=>p.ccc,cls:'tot',fmt:fd}");
replace("{l:'NFM em dias de receita',g:p=>p.nfm/(p.rec)*p.days}", "{l:'NFM em dias de receita',g:p=>p.nfm/(p.rec)*p.days,fmt:fd}");
replace("{n:'PMP',c:css('--s3'),v:P.map(p=>p.pmp)}],{h:230})", "{n:'PMP',c:css('--s3'),v:P.map(p=>p.pmp)}],{h:230,fmt:fd})");
replace("['Prazo médio de recebimento (dias)',p=>p.pmr,'c']]", "['Prazo médio de recebimento (dias)',p=>p.pmr,'c',0,fd]]");
replace("CTL_ROWS.map(([l,g,type,b])=>{const a=g(r),c=g(o),d=a-c;return `<tr class=\"${b?'tot':''}\"><td>${l}</td><td class=\"num\">${f0(a)}</td><td class=\"num\">${f0(c)}</td><td class=\"num\">${d>=0?'+':''}${f0(d)}</td>",
  "CTL_ROWS.map(([l,g,type,b,ff=f0])=>{const a=g(r),c=g(o),d=a-c;return `<tr class=\"${b?'tot':''}\"><td>${l}</td><td class=\"num\">${ff(a)}</td><td class=\"num\">${ff(c)}</td><td class=\"num\">${d>=0?'+':''}${ff(d)}</td>");
replace("function calcRow(lbl,arr,cls='',fmt=f0)", "function calcRow(lbl,arr,cls='',fmt=fd)");
replace("f1(payD)} Mkz/dia", "f0(payD)} Kz/dia");
// Grelhas de introdução continuam em milhões de Kz (é assim que se escrevem os valores).
replace("<thead><tr><th>Mkz</th>${D.years.map(y=>", "<thead><tr><th>Milhões de Kz</th>${D.years.map(y=>");
replace("<table class=\"sticky1\"><thead><tr><th>Mkz</th>${MES.map(", "<table class=\"sticky1\"><thead><tr><th>Milhões de Kz</th>${MES.map(");
replace("<p class=\"sub\">Mkz · alterações recalculam todo o modelo", "<p class=\"sub\">Valores em milhões de Kz · alterações recalculam todo o modelo");
replace("<th>Mês</th><th>Valor</th><th>Vida útil (anos)</th><th>Amortização anual</th>", "<th>Mês</th><th>Valor (milhões Kz)</th><th>Vida útil (anos)</th><th>Amortização anual (Kz)</th>");
replace("<th>Mês</th><th>Valor</th><th>Prazo (meses)</th><th>Prestação de capital</th>", "<th>Mês</th><th>Valor (milhões Kz)</th><th>Prazo (meses)</th><th>Prestação de capital (Kz)</th>");
replace("<th>Activo</th><th>Valor contabilístico</th><th>Renda líquida anual</th><th>Taxa capitalização (%)</th><th>Justo valor</th><th>Diferença</th>", "<th>Activo</th><th>Valor contabilístico (milhões Kz)</th><th>Renda líquida anual (milhões Kz)</th><th>Taxa capitalização (%)</th><th>Justo valor (Kz)</th><th>Diferença (Kz)</th>");
replace("<th>Activo</th><th>Valor contabilístico</th><th>Custo reposição novo</th>", "<th>Activo</th><th>Valor contabilístico (milhões Kz)</th><th>Custo reposição novo (milhões Kz)</th>");
replace("Valores expressos em milhões de Kwanzas (Mkz).", "Valores expressos em Kwanzas.");
// Restantes unidades de saída: Mkz → Kz.
source = source.replaceAll('Mkz', 'Kz'); shell = shell.replaceAll('Mkz', 'Kz');
// Gráficos: margem para eixos com valores por inteiro.
replace('const W=cw(id),H=h,ml=54,mr=8,mt=10,mb=26', 'const W=cw(id),H=h,ml=fmt===f0?128:54,mr=8,mt=10,mb=26');
replace('const W=cw(id),H=h,ml=54,mr=78,mt=12,mb=26', 'const W=cw(id),H=h,ml=fmt===f0?128:54,mr=78,mt=12,mb=26');
replace('const W=cw(id),H=h,ml=50,mr=8,mt=16,mb=40', 'const W=cw(id),H=h,ml=128,mr=8,mt=16,mb=40');
// Folha de cálculo: montantes em Kz com 2 casas.
replace("(c.k==='pp'?v*100:v)", "(c.k==='pp'?v*100:(!c.k||c.k==='n'||c.k==='chk')?v*1e6:v)");
replace(`const Z={n:'#,##0;(#,##0);"-"'`, `const Z={i:'0',n:'#,##0.00;(#,##0.00);"-"'`);
replace(`chk:'#,##0;(#,##0);0'}`, `chk:'#,##0.00;(#,##0.00);0'}`);

/* ---------- Percentagens e números à portuguesa: milhares sempre separados e nunca «-0,0» ---------- */
replace("const nf1=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1});", "const nf1=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:1,maximumFractionDigits:1,useGrouping:'always'});");
replace("const nf2=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2});", "const nf2=new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2,useGrouping:'always'});");
replace("const f1=v=>v==null||!isFinite(v)?'—':nf1.format(v);", "const f1=v=>v==null||!isFinite(v)?'—':nf1.format(+v.toFixed(1)||0);");
replace("const f2=v=>v==null||!isFinite(v)?'—':nf2.format(v);", "const f2=v=>v==null||!isFinite(v)?'—':nf2.format(+v.toFixed(2)||0);");
replace("const pct=v=>v==null||!isFinite(v)?'—':nf1.format(v*100)+'%';", "const pct=v=>v==null||!isFinite(v)?'—':nf1.format(+(v*100).toFixed(1)||0)+'%';");

const adapter = await readFile(new URL('valuation/adapter.js', web), 'utf8');
const imports = [
  `import {setupNumberFields} from '${fileURLToPath(new URL('lib/number-fields.ts', web))}';`,
  `import {readXlsxRows,utils as xlsxUtils,write as xlsxWrite} from '${fileURLToPath(new URL('valuation/xlsx.ts', web))}';`,
  `import {blankValuationData,valuationDataIssue} from '${fileURLToPath(new URL('packages/core/src/valuation.ts', root))}';`,
  `import {endSession,reloadPrivatePageOnRestore} from '${fileURLToPath(new URL('lib/session-client.ts', web))}';`,
  'const XLSX={utils:xlsxUtils,write:(wb)=>xlsxWrite(wb)};',
].join('\n') + '\n';
const result = await build({ stdin: { contents: imports + source + '\n' + adapter, resolveDir: fileURLToPath(web), sourcefile: 'valora-ui.js' }, alias: { '@kianda/core': fileURLToPath(new URL('packages/core/src/index.ts', root)) }, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', write: false, logLevel: 'silent' });
const js = result.outputFiles[0].text;
const digest = (s) => createHash('sha256').update(s).digest('hex');
const css = await readFile(new URL('valuation/space.css', web), 'utf8');
const generated = `// Gerado por scripts/build-valuation-ui.mjs a partir de valuation/prototype.html. Não editar à mão.\nexport const VALUATION_SHELL = ${JSON.stringify(shell)};\nexport const VALUATION_SUFFIX = ${JSON.stringify(suffix)};\nexport const VALUATION_SPACE_CSS = ${JSON.stringify(css)};\nexport const VALUATION_ASSET_HASH = '${digest(js).slice(0, 16)}';\nexport const VALUATION_REFERENCE_HASH = '${digest(original)}';\n`;
// Motor isolado para os testes (mesmas funções da interface, sem DOM).
const engineEnd = source.indexOf('/* ================= GRÁFICOS (SVG)');
if (engineEnd < 0) throw new Error('Secção de gráficos não encontrada');
const engine = `// Gerado por scripts/build-valuation-ui.mjs. Motor do Valora para testes (sem DOM).\nexport const VALUATION_ENGINE_SOURCE = ${JSON.stringify(source.slice(0, engineEnd))};\n`;
await mkdir(new URL('lib/valuation/', web), { recursive: true });
for (const [path, data] of [['lib/valuation/generated.ts', generated], ['lib/valuation/engine.generated.ts', engine], ['public/valuation-runtime.js', js]]) {
  const url = new URL(path, web);
  if (process.argv.includes('--check')) {
    if (await readFile(url, 'utf8').catch(() => '') !== data) throw new Error('Regenerar a interface do Valora: pnpm --filter @kianda/web valuation:generate (' + path + ')');
  } else await writeFile(url, data);
}
console.log(process.argv.includes('--check') ? 'Valora: interface gerada actualizada.' : 'Valora: interface gerada a partir do protótipo aprovado.');
