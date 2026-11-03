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
const suffix = original.slice(end + '</script>'.length);
let source = original.slice(begin + '<script>'.length, end);
const SIDEFOOT = '<div class="sidefoot">Classificação PGC Angola (Decreto n.º 82/2001) · Classe 6 Proveitos · Classe 7 Custos. Submódulo independente do Orçamento.</div>';
if (!original.slice(0, begin).includes(SIDEFOOT)) throw new Error('Rodapé lateral do Integra não encontrado');
const shell = original.slice(0, begin).replace(SIDEFOOT, '<div class="sidefoot">Classe 6 Proveitos · Classe 7 Custos</div>');
function span(start, stop, replacement) {
  const a = source.indexOf(start), b = source.indexOf(stop, a);
  if (a < 0 || b < a) throw new Error('Bloco não encontrado: ' + start);
  source = source.slice(0, a) + replacement + source.slice(b);
}
function replace(from, to) { if (!source.includes(from)) throw new Error('Expressão não encontrada: ' + from); source = source.replaceAll(from, to); }
const dialogStart = source.indexOf('newM:()=>openModal('), dialogEnd = source.indexOf('   createM:', dialogStart);
const dialog = source.slice(dialogStart + 'newM:'.length, dialogEnd).trim().replace(/,$/, '').replace('Object.entries(SECT).map', 'Object.entries(SECT).filter(([key])=>templates.some(t=>t.sector===key)).map');
span('function newModel(', '/* ---------------- Estado', `function newModel(sk,over={}){const t=templates.find(t=>t.sector===sk);if(!t)throw Error('Modelo-tipo indisponível');return Object.assign(clone(t.assumptions),{id:'',sector:sk,moeda:t.currency,nome:SECT[sk].m.nome||t.name,criado:new Date().toISOString().slice(0,10)},over);}\n\n`);
span('let S;', '/* ---------------- Motor', `let S={models:[],active:null,unit:'M',an:null};\nconst M=()=>previewModel||S.models.find(m=>m.id===S.active)||S.models[0];\n\n`);
span('/* ---------------- Motor', '/* ---------------- Formatação', `function run(m,ov={}){return runFinancialModel(m,ov);}\nfunction breakEvenPrice(m){return financialBreakEvenPrice(m);}\nfunction waccOf(m){try{return run(m).wacc}catch{return null}}\nfunction keOf(m){try{return run(m).ke}catch{return null}}\n\n`);
replace('function render(){', 'function renderPrototype(){');
span("  $('#nav').innerHTML=", "  $('#mSel').innerHTML=", '  renderNavigation();\n');
replace('function liveStrip(){', 'function liveStripPrototype(){');
// Mantém o relatório no computador e permite que o selector e o documento empilhem no telefone.
replace('<div style="display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:start">', '<div class="report-layout" style="display:grid;grid-template-columns:270px 1fr;gap:18px;align-items:start">');
replace('<div class="card" style="position:sticky;top:76px">', '<div class="card report-picker" style="position:sticky;top:76px">');
replace('<div data-act="sub" data-k="rep"', '<button type="button" class="report-choice" data-act="sub" data-k="rep"');
replace('<div class="muted" style="font-size:11.5px">${r.aud}${r.hist?\' · histórico\':\'\'}</div></div>', '<span class="muted" style="display:block;font-size:11.5px">${r.aud}${r.hist?\' · histórico\':\'\'}</span></button>');
replace('<label>${l}</label>', '<label for="assumption-${p}">${l}</label>');
replace('class="inp" data-p="${p}"', 'id="assumption-${p}" class="inp" data-p="${p}"');
replace('class="inp n" data-p="${p}"', 'id="assumption-${p}" class="inp n" data-p="${p}"');
replace('class="sel" data-p="${p}"', 'id="assumption-${p}" class="sel" data-p="${p}"');
replace('type="number" step="any"', 'type="number" inputmode="decimal" step="any"');
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
replace("const closeModal=()=>$('#ov').classList.remove('on');", "function closeModal(){currencyDialog=null;projectDialog=null;versionDialog=null;importDialog=null;$('#ov').classList.remove('on');}");
replace('data-act="copyFS">${ico(\'copy\')}Copiar (CSV)', 'data-act="downloadFS">${ico(\'doc\')}Descarregar PDF');
replace('data-act="repCopy">${ico(\'copy\')}Copiar texto', 'data-act="downloadReport">${ico(\'doc\')}Descarregar PDF');
// A análise usa o mesmo core no browser/API; os formulários e tabelas originais são preservados.
span('function pNum(', 'const RDEF=', '');
span('const RDEF=', 'function rStatus(', 'const RDEF=HISTORICAL_RATIO_DEFINITIONS;\n');
span('function analyze(){', 'VIEWS.analise=', '');
replace("a?.anos?.[0]||'2024'", "historicalReferenceField(a,'N1')");
replace("a?.anos?.[1]||'2025'", "historicalReferenceField(a,'N')");
replace('Ano N−1</label>', 'Referência do comparativo</label>');
replace('Ano N</label>', 'Referência do período N</label>');
for(const id of ['anY1','anY2'])replace(`id="${id}"`, `id="${id}" placeholder="2026 ou 31/08/2026"`);
replace("<option ${a?.moeda==='USD'?'selected':''}>USD</option>", "<option ${a?.moeda==='USD'?'selected':''}>USD</option><option ${a?.moeda==='EUR'?'selected':''}>EUR</option>");
replace('Saldo Devedor/Credor, Débito/Crédito ou Saldo', 'Saldo Devedor/Credor, Débito/Crédito acumulados incluindo abertura, ou Saldo');
const documentAccept='.csv,.txt,.pdf,.docx,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
replace('accept=".csv,.txt"', `accept="${documentAccept}"`);
for (const number of [1,2]) replace(`id="anF${number}" accept="${documentAccept}" style="margin-top:6px;font-size:12px">`, `id="anF${number}" accept="${documentAccept}" aria-label="Importar balancete ${number===1?'comparativo N−1':'do período N'}" style="margin-top:6px;font-size:12px"><button type="button" class="btn sm" data-act="anClearImport" data-number="${number}" aria-label="Remover documento ${number===1?'comparativo N−1':'do período N'}">Remover documento</button><span class="import-status" id="anStatus${number}" role="status" aria-live="polite"></span>`);
replace('<button class="btn" data-act="anDemo">Exemplo (distribuidora)</button>', '<button class="btn" data-act="anDemo">Exemplo (distribuidora)</button>${historicalRemovalButton()}');
replace('Aceita colunas Saldo Devedor/Credor', 'Para um único ficheiro, use Balancete N; o comparativo é opcional. Referências: ano (2026) ou data (31/08/2026); podem ser meses do mesmo ano. PDF com texto, Word (.docx), CSV ou TXT. Confira as contas extraídas antes de premir Analisar. Aceita colunas Saldo Devedor/Credor');
replace(' · balancete antes do apuramento de resultados.', ' · balancetes externos antes ou depois do apuramento de resultados.');
replace("const {cN,c1,rN,r1}=A;const y=a.anos;", "const {cN,c1,rN,r1}=A;const y=[historicalPeriodLabel(a,'N1'),historicalPeriodLabel(a,'N')];");
replace("if(tab==='fc'){if(!two)", "if(tab==='fc'){if(!A.cashFlow)");
replace("  if(tab==='dados'||!A||A.err)", "  if(A&&!A.err)head+=historicalScopeNotes(A);\n  if(tab==='dados'||!A||A.err)");
replace("  const head=ph('Análise de demonstrações financeiras'", "  let head=ph('Análise de demonstrações financeiras'");
source=source.replace(/c=>-c\.P\.(\w+)/g,(_,key)=>`c=>historicalIncomeValue(c,'${key}',-1)`).replace(/c=>c\.P\.(\w+)/g,(_,key)=>`c=>historicalIncomeValue(c,'${key}')`);
replace('fmtA(cN.P.vn)', "fmtA(historicalIncomeValue(cN,'vn'))");
replace('fmtA(cN.P.ebitda)', "fmtA(historicalIncomeValue(cN,'ebitda'))");
replace('Custos com o pessoal (72)', 'Custos com o pessoal (72 / 82.7)');
replace("${esc(a.anos[1])}<br>Luanda", "${esc(historicalPeriodLabel(a,'N'))}<br>Luanda");
replace('esc(a.anos[0])', "esc(historicalPeriodLabel(a,'N1'))");
replace('esc(a.anos[1])', "esc(historicalPeriodLabel(a,'N'))");
span('    const B=cN.B,B1=c1.B,P=cN.P;', "    const R=(n,v,c='')", `    const B=cN.B,B1=c1.B,P=cN.P,f=A.cashFlow;const {dEx,dCl,dOA,dFo,dOP,dPr,cfo,cfi,dEmp,dCap,cff}=f;const capexA=f.investment,div=-f.otherEquity,dCx=f.change,res=f.difference;\n`);
replace('Aquisições líquidas de imobilizado e investimentos', 'Investimento líquido estimado (activos + amortizações)');
replace('Dividendos / distribuições (implícitos)', 'Distribuições / outros movimentos de capital próprio, líquidos');
replace('Carregue o balancete N−1 para obter o fluxo de caixa (método indirecto).', 'O fluxo estimado requer detalhe de resultados e um balancete de abertura coerente com o início do período N.');
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
// Fontes normativas ficam fora do ecrã e dos relatórios: o conteúdo continua conforme, sem citações.
replace(' · classificação PGC Angola · ${unitLbl()}', ' · ${unitLbl()}');
// Valores sempre por inteiro, com milhares e duas casas decimais (nunca «5,5 M»): sem unidades de apresentação.
replace("const nf=(v,d=0)=>(v??0).toLocaleString('pt-PT',{minimumFractionDigits:d,maximumFractionDigits:d});", "const nf=(v,d=0)=>(v??0).toLocaleString('pt-PT',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:'always'});");
replace("const s=Math.abs(x).toLocaleString('pt-PT',{minimumFractionDigits:d,maximumFractionDigits:d});", "const s=Math.abs(x).toLocaleString('pt-PT',{minimumFractionDigits:d,maximumFractionDigits:d,useGrouping:'always'});");
replace("const UNITS={U:[1,''],K:[1e3,'mil'],M:[1e6,'M']};", "const UNITS={U:[1,''],K:[1,''],M:[1,'']};");
replace("const d=dd??(S.unit==='M'?(m.moeda==='Kz'?1:2):0);", "const d=dd??2;");
replace("const unitSel=()=>`<select class=\"sel\" id=\"unitSel\" title=\"Unidade de apresentação\">${Object.entries({U:'Unidades',K:'Milhares',M:'Milhões'}).map(([k,v])=>`<option value=\"${k}\" ${S.unit===k?'selected':''}>${v}</option>`).join('')}</select>`;", "const unitSel=()=>'';");
replace("const fmtA=v=>v==null||!isFinite(v)?'—':(Math.abs(v)<0.5e6&&Math.abs(v)>0?nf(v/1e6,2):nf(v/1e6,1)).replace(/^-/,'(')+(v<0?')':'');", "const fmtA=v=>v==null||!isFinite(v)?'—':nf(v,2).replace(/^-/,'(')+(v<0?')':'');");
replace('${a.moeda} · milhões', '${a.moeda}');
replace('P={l:62', 'P={l:118');
replace("m.moeda==='Kz'?0:2", '2');
replace('Balancete PGC Angola → ', 'Balancete → ');
replace('Fluxos de caixa (PGC Angola)', 'Fluxos de caixa');
replace('Classificação por natureza — PGC Angola (Decreto n.º 82/2001)', 'Classificação por natureza');
replace('Histórico: balancetes PGC, ', 'Histórico: balancetes, ');
replace('Análise económico-financeira · PGC Angola', 'Análise económico-financeira');
// Integra: a análise de demonstrações usa apenas as demonstrações projectadas do próprio projecto, no horizonte.
// Sem balancetes nem outra informação externa (a análise do dia-a-dia das empresas é feita no Valora).
replace("['demonstracoes','Demonstrações projectadas','table'],\n  ['g','Decisão']", "['demonstracoes','Demonstrações projectadas','table'],['analise','Análise de demonstrações','scan'],\n  ['g','Decisão']");
replace(",\n  ['g','Histórico'],['analise','Análise de demonstrações','scan']];", "];");
span('const RDEF=HISTORICAL_RATIO_DEFINITIONS;', '/* ================= RELATÓRIOS', `/* ---------------- Análise das demonstrações projectadas ---------------- */
const SCN_LBL={base:'base',otim:'optimista',pess:'pessimista'};
const paFmt=(v,f)=>v==null||!isFinite(v)?'—':f.startsWith('%')?pct(v):f.startsWith('d')?nf(v)+' dias':xf(v);
const PA_TAG={g:'Favorável',a:'Atenção',r:'Desfavorável',n:'Não calculável'};
const paColor=s=>s==='r'?'color:var(--red)':s==='a'?'color:var(--amber)':'';
VIEWS.analise=()=>{const m=M();const R=run(m);const A=analyzeFinancialProjection(R);const k=R.k;const yi=A.indices,last=yi[yi.length-1];
  const head=ph('Análise de demonstrações financeiras',\`\${esc(m.nome)} · \${A.years[0]}–\${A.years[A.years.length-1]} · cenário \${SCN_LBL[R.scenario]||R.scenario} · calculada a partir das demonstrações projectadas do projecto\`);
  const kpis=[['Volume de negócios '+R.years[last],money(k.rev[last]),'margem EBITDA '+pct(k.rev[last]?k.ebitda[last]/k.rev[last]:null)],['Resultado líquido '+R.years[last],money(k.rl[last]),'margem líquida '+pct(k.rev[last]?k.rl[last]/k.rev[last]:null)],['Capital próprio '+R.years[last],money(k.cap[last]+k.res[last]),'autonomia '+pct(k.assets[last]?(k.cap[last]+k.res[last])/k.assets[last]:null)],['Caixa no fim do horizonte',money(k.cash[last]),'dívida '+money(k.debt[last])]];
  const th=\`<thead><tr><th>Indicador</th>\${A.years.map(y=>\`<th class="num">\${y}</th>\`).join('')}<th class="num">Anos favoráveis</th></tr></thead>\`;
  const rows=[...new Set(A.rows.map(r=>r.group))].map(g=>\`<tr class="sec"><td colspan="\${A.years.length+2}">\${g}</td></tr>\`+A.rows.filter(r=>r.group===g).map(r=>\`<tr class="sub"><td>\${r.label}</td>\${r.values.map((v,i)=>\`<td class="num" style="\${paColor(r.statuses[i])}">\${paFmt(v,r.format)}</td>\`).join('')}<td class="num">\${r.measured?r.favourable+' de '+r.measured:'—'}</td></tr>\`).join('')).join('');
  const syn=(title,specs)=>\`<div class="card"><div class="hd"><h3>\${title}</h3></div><div class="tblwrap"><table class="ft"><thead><tr><th>\${esc(m.moeda)}</th>\${A.years.map(y=>\`<th class="num">\${y}</th>\`).join('')}</tr></thead><tbody>\${specs.map(([l,f,c])=>\`<tr class="\${c?'tot':'sub'}"><td>\${l}</td>\${yi.map(t=>{const v=f(t);return \`<td class="num \${v<0?'neg':''}">\${mv(v)}</td>\`}).join('')}</tr>\`).join('')}</tbody></table></div></div>\`;
  return head+\`<div class="grid g4" style="margin-bottom:16px">\${kpis.map(([l,v,d])=>\`<div class="card kpi"><div class="l">\${l}</div><div class="v" style="font-size:19px">\${v}</div><div class="d">\${d}</div></div>\`).join('')}</div>
  <div class="grid" style="gap:16px;margin-bottom:16px"><div class="card"><div class="hd"><h3>Rácios por ano</h3></div><div class="tblwrap"><table class="ft">\${th}<tbody>\${rows}</tbody></table></div></div>
  <div class="card"><div class="hd"><h3>Diagnóstico</h3></div><div class="bd"><div class="grid g2" style="gap:10px">\${A.diagnosis.map(d=>\`<div class="alert \${d.status==='n'?'b':d.status}">\${ico(d.status==='g'?'check':d.status==='r'?'alert':'info',17)}<div><b>\${d.area} · \${PA_TAG[d.status]}.</b> \${d.text}</div></div>\`).join('')}</div><div class="muted" style="font-size:12px;margin-top:8px">\${A.notes.join(' ')}</div></div></div></div>
  <div class="grid" style="gap:16px">\${syn('Demonstração de resultados (síntese)',[['Volume de negócios',t=>k.rev[t]],['EBITDA',t=>k.ebitda[t],1],['Amortizações',t=>-k.da[t]],['Resultado operacional',t=>k.ebit[t],1],['Custos financeiros',t=>-k.jur[t]],['Imposto',t=>-k.imp[t]],['Resultado líquido',t=>k.rl[t],1]])}
  \${syn('Balanço (síntese)',[['Imobilizado líquido',t=>k.imob[t]],['Existências e clientes',t=>k.inv[t]+k.ar[t]],['Meios monetários',t=>k.cash[t]],['Total do activo',t=>k.assets[t],1],['Capital próprio',t=>k.cap[t]+k.res[t],1],['Empréstimos',t=>k.debt[t]],['Fornecedores',t=>k.ap[t]],['Total do passivo',t=>k.debt[t]+k.ap[t],1]])}
  \${syn('Fluxos de caixa (síntese)',[['Fluxo operacional',t=>k.cfo[t]],['Fluxo de investimento',t=>k.cfi[t]],['Fluxo de financiamento',t=>k.cff[t]],['Caixa no fim do ano',t=>k.cash[t],1]])}</div>\`;};

`);
span(" analise:{t:'Relatório de análise económico-financeira'", '};\nVIEWS.relatorios', ` analise:{t:'Relatório de análise económico-financeira',d:'Rácios e diagnóstico das demonstrações projectadas do projecto',aud:'Investidores / bancos',f:m=>{const R=run(m);const A=analyzeFinancialProjection(R);const k=R.k;const ys=pickY(R);const at=(r,t)=>r.values[A.indices.indexOf(t)];
   return \`<div class="page">\${LHM('AEF-'+m.id.slice(0,5).toUpperCase())}<h1>Relatório de análise económico-financeira</h1><div class="subt">\${esc(m.nome)} · cenário \${SCN_LBL[R.scenario]||R.scenario}</div>
   <p>Análise económico-financeira das demonstrações projectadas do projecto, de \${A.years[0]} a \${A.years[A.years.length-1]}. Toda a informação provém dos pressupostos e resultados do próprio modelo.</p>
   <h3>Demonstração de resultados (síntese)</h3>\${rtable(R,[['Volume de negócios',t=>mv(k.rev[t])],['EBITDA',t=>mv(k.ebitda[t])],['Resultado operacional',t=>mv(k.ebit[t])],['Resultado líquido',t=>mv(k.rl[t])]],ys)}
   <h3>Balanço (síntese)</h3>\${rtable(R,[['Total do activo',t=>mv(k.assets[t])],['Capital próprio',t=>mv(k.cap[t]+k.res[t])],['Empréstimos',t=>mv(k.debt[t])],['Fornecedores',t=>mv(k.ap[t])]],ys)}
   <h3>Fluxos de caixa (síntese)</h3>\${rtable(R,[['Fluxo operacional',t=>mv(k.cfo[t])],['Fluxo de investimento',t=>mv(k.cfi[t])],['Fluxo de financiamento',t=>mv(k.cff[t])],['Caixa no fim do ano',t=>mv(k.cash[t])]],ys)}
   <h3>Rácios</h3>\${rtable(R,A.rows.map(r=>[r.label,t=>paFmt(at(r,t),r.format)]),ys)}
   <h3>Diagnóstico</h3><table class="t"><tr><th>Área</th><th>Leitura</th><th>Comentário</th></tr>\${A.diagnosis.map(d=>\`<tr><td>\${d.area}</td><td>\${PA_TAG[d.status]}</td><td>\${d.text}</td></tr>\`).join('')}</table>
   <p style="font-family:Inter;font-size:11px">\${A.notes.join(' ')}</p>
   \${SGM(['Elaborado por','Direcção Financeira'],['Revisto por','____________________'])}\${FTM('Análise económico-financeira')}</div>\`;}}
`);
replace("const R=cur==='analise'?null:run(m);", 'const R=run(m);');
span('function fsCSV(){', '/* ---------------- Eventos', '');
source = source.slice(0, source.indexOf('/* ---------------- Eventos'));
const adapter = (await readFile(new URL('modeling/adapter.js', web), 'utf8')).replace('__NEW_MODEL_DIALOG__', dialog);
const imports = `import {runFinancialModel} from '${fileURLToPath(new URL('packages/core/src/modeling/engine.ts', root))}';\nimport {financialBreakEvenPrice} from '${fileURLToPath(new URL('packages/core/src/modeling/analysis.ts', root))}';\nimport {FinancialModelError,FINANCIAL_ENGINE_VERSION} from '${fileURLToPath(new URL('packages/core/src/modeling/types.ts', root))}';\nimport {analyzeFinancialProjection} from '${fileURLToPath(new URL('packages/core/src/modeling/project-analysis.ts', root))}';\nimport {ModelingStore,modelingRequest,presentModel} from '${fileURLToPath(new URL('modeling/store.ts', web))}';\n`;
const mobileImports = `import {setupModelingMobile,prepareFinancialTables} from '${fileURLToPath(new URL('modeling/mobile.ts', web))}';\n`;
const sessionImports = `import {endSession,reloadPrivatePageOnRestore} from '${fileURLToPath(new URL('lib/session-client.ts', web))}';\n`;
const result = await build({ stdin: { contents: imports + mobileImports + sessionImports + source + adapter, resolveDir: fileURLToPath(web), sourcefile: 'integra-ui.js' }, alias: {'@kianda/core':fileURLToPath(new URL('packages/core/src/index.ts',root))}, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', write: false, logLevel: 'silent' });
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
