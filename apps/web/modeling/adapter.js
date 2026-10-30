/* Liga a interface aprovada à API. Este ficheiro é montado depois das vistas do protótipo. */
let store, session, templates = [], notice = '', busy = false;
let previewModel=null, projectDialog=null, projectUsage=null, projectTab='active';
let currencyDialog=null;
let leaving=false, signingOut=false;
function clearModelSession(){
  leaving=true;store?.stopAutosave();
  for(const pending of historicalImports.values())pending.controller.abort();historicalImports.clear();
  historicalDirty.clear();historicalDrafts.clear();historicalSaved.clear();historicalReadErrors.clear();
  session=null;S.models=[];S.active=null;S.an=null;previewModel=null;
  $('#integra-session').textContent='';$('#nav').innerHTML='';$('#mSel').innerHTML='';$('#mTags').innerHTML='';
  $('#view').innerHTML='<div class="screen-loading" role="status">Sessão terminada. A abrir a página inicial…</div>';
  closeModal();setMenuOpen(false);
  document.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=true;});
}
function confirmLogout(message){
  closeModal();setMenuOpen(false);
  openModal('Terminar sessão',`<p>${esc(message)}</p><p style="margin-top:10px">Pode voltar ao projecto ou terminar sessão mesmo assim.</p>`,`<button class="btn" data-act="close">Voltar ao projecto</button><button class="btn red" data-act="confirmLogout">Terminar sessão mesmo assim</button>`);
}
async function leaveModeling(force=false){
  if(!force){
    captureHistoricalDraft();
    let timer;
    try{await Promise.race([store?.flush(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A gravação ainda não terminou.')),10000);})]);}
    catch(error){return confirmLogout('Não foi possível concluir a gravação das alterações. '+errorText(error));}
    finally{clearTimeout(timer);}
    if(historicalDirty.size||historicalImports.size)return confirmLogout('Há documentos por analisar ou alterações de análise ainda não guardadas. Ao sair, os dados por guardar podem perder-se.');
  }
  await endSession(clearModelSession);
}
const navExpanded={};let navView=null;
function renderNavigation(){
  const groups=[];for(const entry of NAV){if(entry[0]==='g')groups.push({label:entry[1],items:[]});else groups.at(-1).items.push(entry);}
  if(navView!==VIEW){for(const key of Object.keys(navExpanded))delete navExpanded[key];const index=groups.findIndex(g=>g.items.some(item=>item[0]===VIEW));navExpanded[index<0?0:index]=true;navView=VIEW;}
  $('#nav').innerHTML=groups.map((group,index)=>`<section class="nav-group"><button class="nav-group-toggle" data-act="navToggle" data-group="${index}" aria-expanded="${!!navExpanded[index]}" aria-controls="integra-nav-${index}"><span>${esc(group.label)}</span><span class="nav-chevron" aria-hidden="true">⌄</span></button><div id="integra-nav-${index}"${navExpanded[index]?'':' hidden'}>${group.items.map(item=>`<a href="#${item[0]}" class="${VIEW===item[0]?'on':''}" data-go="${item[0]}"${VIEW===item[0]?' aria-current="page"':''}>${ico(item[2],17)}<span>${esc(item[1])}</span></a>`).join('')}</div></section>`).join('');
}
function setMenuOpen(open){
  const root=$('.app'),wasOpen=root.classList.contains('menu-open');if(open)root.classList.add('menu-open');else root.classList.remove('menu-open');
  $('#integra-menu-toggle')?.setAttribute?.('aria-expanded',String(open));
  $('.main').inert=open;
  if(open)$('#integra-side button')?.focus?.();else if(wasOpen)$('#integra-menu-toggle')?.focus?.();
}
const currencyFields=['fxFrom','fxRate','fxDate','fxSource'];
const currentDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Luanda',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function mapCurrencyContext(){
  const currency=M()?.moeda;
  if(!currency||VIEW==='analise'||VIEW==='relatorios'&&SUB.rep==='analise')return '';
  return ` · Moeda global: ${esc(currency)}${VIEW==='pressupostos'?' · Montantes de entrada em unidades':''}`;
}
function assumptionMoney(value){
  if(typeof value!=='number'||!Number.isFinite(value))return '—';
  return `${new Intl.NumberFormat('pt-PT',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value)} ${M().moeda}`;
}
function currencyConversionHint(model){
  const c=model.currencyConversion;
  return c&&typeof c==='object'?`Última conversão: 1 ${esc(c.from)} = ${esc(c.rate)} ${esc(c.to)} · ${esc(c.rateDate)} · ${esc(c.source)}`:'Ao mudar de moeda, indique ou confirme o câmbio para converter os montantes';
}
async function loadCurrencyQuote(){
  const context=currencyDialog;if(!context)return;
  const from=$('#fxFrom').value;context.quote=null;busy=true;protect();
  $('#fxStatus').textContent='A obter a última referência BNA disponível…';
  try{
    const q=await modelingRequest('/exchange-rate?'+new URLSearchParams({from,to:context.to}));
    if(currencyDialog!==context)return;
    context.quote=q;$('#fxRate').value=q.rate;$('#fxDate').value=q.rateDate;$('#fxSource').value=q.source;
    $('#fxStatus').textContent=`1 ${from} = ${q.rate} ${context.to} · ${q.rateDate} · ${q.source}${q.stale?' · Referência com mais de 7 dias; confirme a sua adequação.':''}`;
  }catch(error){
    if(currencyDialog!==context)return;
    $('#fxRate').value='';$('#fxDate').value=currentDate();$('#fxSource').value='Pressuposto manual';$('#fxStatus').textContent=errorText(error);
  }finally{busy=false;protect();}
}
async function openCurrencyConversion(model,to){
  if(!store.canEdit(model.id)||busy)return;
  currencyDialog={modelId:model.id,to,quote:null};
  openModal('Converter moeda',`<div class="alert b">${ico('info',17)}<div>Aplicar <b>${esc(to)}</b> ao investimento, custos, dívida, DRE, Balanço, fluxos de caixa, avaliação e relatórios projectados. Quantidades, dias, anos e percentagens mantêm-se.</div></div><div class="form"><div class="f"><label>Moeda real dos valores actuais</label><select class="sel" id="fxFrom">${['Kz','USD','EUR'].map(c=>`<option ${model.moeda===c?'selected':''}>${c}</option>`).join('')}</select><span class="hint">Se anteriormente mudou apenas o símbolo, indique a moeda em que os valores foram introduzidos.</span></div><div class="f"><label>Taxa: 1 unidade da origem em ${esc(to)}</label><input class="inp n" id="fxRate" type="number" step="any" min="0"></div><div class="f"><label>Data da taxa</label><input class="inp" id="fxDate" type="date" value="${currentDate()}"></div><div class="f"><label>Fonte / pressuposto</label><input class="inp" id="fxSource" maxlength="160"></div></div><p class="hint" id="fxStatus"></p><p class="hint">A taxa fica fixada nesta conversão. Reveja inflação, juros e taxa de desconto para a moeda de análise; estes pressupostos não são alterados pelo câmbio.</p>`,`<button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="applyCurrency">Aplicar conversão</button>`,'700px');
  $('#fxFrom').onchange=loadCurrencyQuote;
  for(const field of ['fxRate','fxDate','fxSource'])$('#'+field).oninput=()=>{if(currencyDialog?.quote){currencyDialog.quote=null;if(field!=='fxSource')$('#fxSource').value='Pressuposto manual';$('#fxStatus').textContent='Será utilizada a taxa indicada, com a data e fonte deste formulário.';}};
  await loadCurrencyQuote();
}
const bindAssumptionsPrototype=VIEWS.pressupostos.after;
VIEWS.pressupostos.after=()=>{
  bindAssumptionsPrototype();
  const field=document.querySelector('[data-p="moeda"]');
  if(field)field.onchange=()=>{const model=M(),to=field.value;field.value=model.moeda;if(to!==model.moeda)return openCurrencyConversion(model,to);};
};
async function applyCurrency(){
  const context=currencyDialog;if(!context||context.modelId!==M()?.id)throw Error('Seleccione novamente a moeda do projecto.');
  const from=$('#fxFrom').value,rate=Number($('#fxRate').value),rateDate=$('#fxDate').value,source=$('#fxSource').value.trim();
  if(!Number.isFinite(rate)||rate<=0||!rateDate||!source)throw Error('Indique taxa positiva, data e fonte para converter os valores.');
  const q=context.quote,reference=!!q&&q.from===from&&q.rate===rate&&q.rateDate===rateDate&&q.source===source;
  await store.convertCurrency(context.modelId,{from,to:context.to,rate,rateDate,source,reference});
  closeModal();notice='';render();toast('Montantes convertidos e guardados. Reveja as taxas de inflação e desconto.');
}
const historicalDrafts=new Map(), historicalDirty=new Set();
const historicalImports=new Map();
const historicalReadErrors=new Map();
const historicalSaved=new Set();
const historicalFields=['anEmp','anY1','anY2','anCP','anMo','anT1','anT2','anF1','anF2'];
function historicalReferenceField(input,key){return input?.periods?.[key]?.to?.split('-').reverse().join('/')||input?.anos?.[key==='N'?1:0]||String(new Date().getFullYear()-(key==='N'?0:1));}
function captureHistoricalDraft(){
  if(VIEW!=='analise'||(SUB.at||'dados')!=='dados'||!M()||!store.canEdit(M().id)||!historicalDirty.has(M().id))return;
  const input={empresa:$('#anEmp').value,anos:[$('#anY1').value,$('#anY2').value],pctCP:Number($('#anCP').value),moeda:$('#anMo').value,N1:$('#anT1').value,N:$('#anT2').value};
  const periods={};for(const key of ['N','N1']){const index=key==='N'?1:0,reference=parseHistoricalReference(input.anos[index],S.an?.periods?.[key]);if(reference){input.anos[index]=reference.year;if(input[key].trim()&&reference.period)periods[key]=reference.period;}}
  if(!input.N1.trim()&&!/^(?:19|20|21)\d{2}$/.test(input.anos[0])&&/^(?:19|20|21)\d{2}$/.test(input.anos[1]))input.anos[0]=String(Math.max(1900,Number(input.anos[1])-1));
  if(Object.keys(periods).length)input.periods=periods;
  historicalDrafts.set(M().id,input);S.an=input;
}
async function selectHistorical(model){
  if(historicalDrafts.has(model.id)){S.an=historicalDrafts.get(model.id);return;}
  const historical=await store.history(model.id);S.an=historical?.analysis.input||null;
  if(historical)historicalSaved.add(model.id);else historicalSaved.delete(model.id);
  historicalDrafts.set(model.id,S.an);
}
function historicalRemovalButton(){return historicalSaved.has(M()?.id)?'<button class="btn" data-act="anRemoveHistory">Remover análise guardada</button>':'';}
function clearHistoricalDocument(number){
  const id='#anF'+number,target='#anT'+number,key=number==='2'?'N':'N1',modelId=M().id,pending=historicalImports.get(id);
  const failed=historicalReadErrors.has(modelId+target);
  pending?.controller.abort();historicalImports.delete(id);$(id).value='';historicalReadErrors.delete(modelId+target);notice='';document.querySelector('#integra-notice')?.remove?.();
  if(pending||failed){$('#anStatus'+number).textContent='Selecção cancelada. Os dados anteriores foram conservados.';protect();return;}
  $(target).value='';S.an={...S.an,periods:{...S.an?.periods}};delete S.an.periods[key];
  historicalDirty.add(modelId);captureHistoricalDraft();
  if(!historicalSaved.has(modelId)&&!S.an.N.trim()&&!S.an.N1.trim())historicalDirty.delete(modelId);
  $('#anStatus'+number).textContent='Documento removido desta edição. Pode escolher outro ficheiro.'+(historicalSaved.has(modelId)?' Para apagar a análise já guardada, use Remover análise guardada.':'');protect();
}
function confirmHistoricalRemoval(){
  projectDialog={kind:'removeHistory',id:M().id};
  openModal('Remover análise guardada', '<p>Remover os balancetes N e N−1 e os resultados desta análise do projecto?</p><p class="muted">As versões aprovadas e os pressupostos de projecção são conservados.</p><div id="projectError" role="alert"></div>', '<button class="btn" data-act="close">Cancelar</button><button class="btn pri" data-act="anConfirmRemoval">Remover análise</button>','600px');
}
async function removeHistoricalAnalysis(){
  const context=projectDialog;if(context?.kind!=='removeHistory'||context.id!==M()?.id)throw Error('Seleccione novamente a análise que pretende remover.');
  await store.removeHistory(context.id);
  for(const pending of historicalImports.values())pending.controller.abort();historicalImports.clear();
  for(const target of ['#anT1','#anT2'])historicalReadErrors.delete(context.id+target);
  historicalSaved.delete(context.id);historicalDirty.delete(context.id);historicalDrafts.set(context.id,null);S.an=null;SUB.at='dados';notice='';
  closeModal();render();toast('Análise removida deste projecto. Pode importar novos documentos.');
}
function analyze(){
  if(!S.an?.N)return null;
  try{return analyzeFinancialHistory(S.an)}catch(error){return {err:esc(errorText(error))};}
}
function historicalIncomeValue(statements,key,sign=1){return statements.income?.complete===false&&key!=='rl'?null:statements.P[key]*sign;}
function historicalScopeNotes(analysis){
  if(!analysis||analysis.err)return '';
  const notes=[];
  if(analysis.input.periods?.N)notes.push('Período: '+historicalPeriodLabel(analysis.input,'N')+'.');
  if(analysis.cN.income.stage==='closing')notes.push('DR reconstituída com contas de apuramento PGC.');
  if(!analysis.cN.income.complete)notes.push('O documento não contém detalhe suficiente para uma DR completa; rubricas e indicadores indisponíveis mostram —.');
  if(analysis.pN.diff!==0)notes.push('Diferença débito − crédito: '+nf(analysis.pN.diff,2)+' '+analysis.input.moeda+'. Os valores da origem foram preservados.');
  return notes.length?`<div class="alert ${analysis.pN.diff!==0||!analysis.cN.income.complete?'a':'b'}">${ico('info',17)}<div>${esc(notes.join(' '))}</div></div>`:'';
}
async function analyzeAndSave(){
  if(historicalImports.size)throw Error('Aguarde a leitura do ficheiro antes de analisar.');
  for(const target of ['#anT2','#anT1']){const error=historicalReadErrors.get(M().id+target);if(error)throw Error(error);}
  if($('#anT2').value.trim()){for(const [target,reference,label]of [['#anT2','#anY2','período N'],['#anT1','#anY1','comparativo']])if($(target).value.trim()&&!parseHistoricalReference($(reference).value))throw Error('Referência do '+label+' inválida. Indique um ano (2026) ou uma data válida (31/08/2026).');}
  historicalDirty.add(M().id);captureHistoricalDraft();
  analyzeFinancialHistory(S.an);
  const historical=await store.saveHistory(M().id,S.an);
  S.an=historical.analysis.input;historicalDrafts.set(M().id,S.an);historicalDirty.delete(M().id);historicalSaved.add(M().id);
  SUB.at='balanco';notice='';render();toast('Balancetes analisados e guardados neste projecto.');
}
async function modelFromHistorical(){
  if(historicalDirty.has(M().id))throw Error('Prima Analisar para validar e guardar os balancetes antes de criar o modelo.');
  const result=await store.createFromHistory(M().id);
  previewModel=null;S.active=result.model.id;S.an=result.historical.analysis.input;historicalDrafts.set(M().id,S.an);historicalSaved.add(M().id);
  go('pressupostos');toast('Modelo criado. Reveja os pressupostos de projecção e financiamento.');
}
function errorText(error) {
  if (error?.issues) return error.issues.map(v=>`${v.path}: ${v.message}`).join(' · ');
  return error?.message || 'Não foi possível concluir. Tente novamente.';
}
function showError(error) { notice=errorText(error);toast(notice);if(projectDialog){const field=document.querySelector('#projectError');if(field)field.textContent=notice;}render(); }
function alertMessage(message) { return `<div class="alert r" role="alert">${ico('alert',17)}<div>${esc(message)}</div></div>`; }
function liveStrip(){try{return liveStripPrototype()}catch(error){return alertMessage(errorText(error));}}
function optionalNpv(model,overrides={}) { try{return run(model,overrides).npv}catch(error){if(error instanceof FinancialModelError||error instanceof RangeError)return null;throw error;} }
function validRange(values,fn) { return values.every(Number.isFinite)?fn(...values):null; }
function save(){if(M())store.change(M());}
function projectPicker(){
  const selected=M()?.id;
  $('#mSel').innerHTML=(previewModel?`<option value="${esc(previewModel.id)}" selected>Arquivado · ${esc(previewModel.nome)}</option>`:'')+(!S.models.length&&!previewModel?'<option value="" selected disabled>Seleccione um projecto</option>':'')+S.models.map(m=>`<option value="${esc(m.id)}" ${selected===m.id?'selected':''}>${esc(m.nome)}</option>`).join('')+'<option value="__projects">Gerir projectos…</option>';
  if(selected)$('#mSel').value=selected;
}
async function chooseProject(id){
  await store.flush();
  const model=store.project(id);if(!model)throw Error('Projecto inexistente nesta lista. Actualize os projectos.');
  await selectHistorical(model);previewModel=store.archivedAt(id)?model:null;S.active=store.archivedAt(id)?null:id;
  notice='';render();
}
function projectDate(id){const date=new Date(store.archivedAt(id));return Number.isFinite(date.getTime())?date.toLocaleDateString('pt-PT',{timeZone:'Africa/Luanda'}):'—';}
function projectQuota(){return projectUsage?`${projectUsage.activeProjects} projecto(s) activo(s) · ${projectUsage.projectLimit===null?'plano ilimitado':'limite contratado: '+projectUsage.projectLimit}`:'Não foi possível consultar a quota. Utilize Actualizar lista.';}
function projectCatalogue(){
  const archived=projectTab==='archived',projects=archived?store.archivedModels:store.models;
  const rows=projects.map(m=>`<tr><td><b>${esc(m.nome)}</b><div class="muted">${esc(SECT[m.sector]?.t||m.sector)} · ${esc(m.moeda)}${archived?' · arquivado em '+esc(projectDate(m.id)):''}</div></td><td class="num"><button class="btn sm" data-act="viewProject" data-id="${esc(m.id)}">${archived?'Consultar':'Abrir'}</button>${session.canWrite?` <button class="btn sm" data-act="${archived?'restoreProject':'archiveProject'}" data-id="${esc(m.id)}">${archived?'Restaurar':'Arquivar'}</button>`:''}</td></tr>`).join('');
  openModal('Gerir projectos',`<div class="alert b">${ico('info',17)}<div>${esc(projectQuota())}. Arquivar liberta uma vaga e conserva pressupostos, balancetes e versões.</div></div><div class="tabs"><a data-act="projectTab" data-v="active" class="${!archived?'on':''}">Activos (${store.models.length})</a><a data-act="projectTab" data-v="archived" class="${archived?'on':''}">Arquivados (${store.archivedModels.length})</a></div><div id="projectError" role="alert" class="muted"></div><div class="tblwrap"><table class="t"><thead><tr><th>Projecto</th><th class="num">Acções</th></tr></thead><tbody>${rows||`<tr><td colspan="2">${archived?'Não há projectos arquivados nesta lista.':'Não há projectos activos nesta lista.'}</td></tr>`}</tbody></table></div>`,`<button class="btn" data-act="refreshProjects">Actualizar lista</button><button class="btn" data-act="close">Fechar</button>`,'860px');
}
async function openProjects(){
  await store.flush();render();
  const context=projectDialog={kind:'catalogue'};
  openModal('Gerir projectos','<p class="muted">A consultar a quota de projectos…</p>','<button class="btn" data-act="close">Fechar</button>','860px');
  try{projectUsage=await modelingRequest('/usage');}catch{projectUsage=null;}
  if(projectDialog===context)projectCatalogue();
}
async function refreshProjects(){
  if(historicalDirty.size)throw Error('Analise os balancetes em edição antes de actualizar a lista. Os dados por guardar ficam nesta sessão.');
  await store.flush();const context=projectDialog,selected=M()?.id;
  const [records,usage]=await Promise.all([modelingRequest('/models'),modelingRequest('/usage')]);
  if(projectDialog!==context)return;
  store.load(records);projectUsage=usage;historicalDrafts.clear();historicalReadErrors.clear();historicalSaved.clear();
  const model=selected?store.project(selected):store.models[0];
  previewModel=model&&store.archivedAt(model.id)?model:null;S.active=model&&!previewModel?model.id:store.models[0]?.id||null;
  S.an=null;if(M())await selectHistorical(M());
  render();if(projectDialog===context)projectCatalogue();
}
function confirmArchive(id){
  const model=store.project(id);if(!model||store.archivedAt(id))throw Error('Seleccione um projecto activo.');
  if(historicalDirty.has(id))throw Error('Analise e guarde os balancetes deste projecto antes de o arquivar.');
  projectDialog={kind:'archive',id};
  openModal('Arquivar projecto',`<p>Arquivar <b>${esc(model.nome)}</b>?</p><p class="muted">O projecto deixa de contar para o limite de activos. Os pressupostos e os balancetes ficam disponíveis para consulta; as versões aprovadas também são conservadas. Restaurar exige uma vaga no plano e acesso ao sector.</p><div id="projectError" role="alert" class="muted"></div>`,`<button class="btn" data-act="openProjects">Cancelar</button><button class="btn pri" data-act="confirmArchive">Arquivar projecto</button>`,'620px');
}
async function archiveProject(){
  const context=projectDialog;if(context?.kind!=='archive')throw Error('Seleccione novamente o projecto que pretende arquivar.');
  if(historicalDirty.has(context.id))throw Error('Analise e guarde os balancetes deste projecto antes de o arquivar.');
  const selected=M()?.id,model=await store.setArchived(context.id,true);
  if(selected===model.id){previewModel=model;S.active=null;S.an=historicalDrafts.get(model.id)||null;}
  notice='';render();toast('Projecto arquivado. Os dados foram conservados.');
  try{projectUsage=await modelingRequest('/usage');}catch{projectUsage=null;}
  if(projectDialog===context){projectDialog={kind:'catalogue'};projectTab='archived';projectCatalogue();}
}
async function restoreProject(id){
  const model=await store.setArchived(id,false);
  previewModel=null;S.active=id;S.an=historicalDrafts.get(id)||null;notice='';
  try{await selectHistorical(model);}catch{S.an=null;notice='Projecto restaurado. Não foi possível carregar os balancetes; seleccione novamente o projecto para os consultar.';}
  closeModal();render();toast('Projecto restaurado e incluído nos projectos activos.');
  try{projectUsage=await modelingRequest('/usage');}catch{projectUsage=null;}
}
function protect() {
  const companyWrite=session?.canWrite&&!busy,writable=companyWrite&&M()&&store.canEdit(M().id);
  document.querySelectorAll('[data-p],[data-cen]').forEach(el=>{
    if(!writable){if(el.dataset.restoreDisabled===undefined)el.dataset.restoreDisabled=el.disabled?'1':'0';el.disabled=true;}
    else if(el.dataset.restoreDisabled!==undefined){el.disabled=el.dataset.restoreDisabled==='1';delete el.dataset.restoreDisabled;}
  });
  document.querySelectorAll(historicalFields.map(id=>'#'+id).join(',')).forEach(el=>{el.disabled=!writable;});
  document.querySelectorAll(currencyFields.map(id=>'#'+id).join(',')).forEach(el=>{el.disabled=!writable;});
  for(const action of ['addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{
    el.disabled=!writable||historicalImports.size>0&&['anRun','anToModel','anDemo'].includes(action);
    if(!session?.canWrite)el.title='Acesso apenas de consulta.';
  });
  for(const number of ['1','2']){const button=document.querySelector(`[data-act="anClearImport"][data-number="${number}"]`);if(button){const pending=historicalImports.has('#anF'+number);button.textContent=pending?'Cancelar leitura':'Remover documento';button.disabled=!writable||!pending&&!$('#anT'+number)?.value?.trim()&&!$('#anF'+number)?.value;}}
  for(const action of ['newM','createM','dupM','archiveProject','confirmArchive','restoreProject'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{el.disabled=!companyWrite||action==='dupM'&&!M();});
  $('#mSel').disabled=busy;
  $('#integra-logout').disabled=busy;
  $('#integra-logout').textContent=signingOut?'A terminar sessão…':'Terminar sessão';
  $('#mSel').title=notice||'Projectos da empresa. Escolha Gerir projectos… para consultar, arquivar ou restaurar.';
}
function render() {
  if(!session)return;
  for(const pending of historicalImports.values())pending.controller.abort();
  historicalImports.clear();
  $('#view').dataset.view=VIEW;
  $('#view').dataset.wide=String(['demonstracoes','credito','sensibilidade','analise'].includes(VIEW)||VIEW==='pressupostos'&&['capex','receitas'].includes(SUB.pt));
  if(!M()) {
    renderNavigation();
    $('#mSel').innerHTML='';$('#mTags').innerHTML='';
    $('#view').innerHTML=ph('Modelagem financeira','Projectos da empresa')+`<div class="alert b">${ico('info',17)}${session.canWrite?'Ainda não há projectos activos. Utilize + Novo modelo para começar.':'Ainda não há projectos activos para consultar.'}${store.archivedModels.length?' Para consultar os arquivados, escolha Gerir projectos… no selector de modelos.':''}</div>`+(notice?alertMessage(notice):'');
    projectPicker();protect();return;
  }
  try{renderPrototype();}
  catch(error){$('#view').innerHTML=ph('Pressupostos por rever','Abra Pressupostos para completar ou corrigir os dados do projecto.')+alertMessage(errorText(error));}
  if(notice)$('#view').insertAdjacentHTML('afterbegin',`<div id="integra-notice">${alertMessage(notice)}</div>`);
  if(previewModel)$('#view').insertAdjacentHTML('afterbegin',`<div class="alert b" role="status">${ico('info',17)}<div>Projecto arquivado · consulta. Para voltar a gravar alterações, escolha Gerir projectos… no selector de modelos e restaure o projecto.</div></div>`);
  projectPicker();protect();prepareFinancialTables($('#view'));
}
// Os mesmos campos e separadores do protótipo; cada projecto carrega a sua própria origem.
VIEWS.analise.after=()=>{
  for(const [id,target] of [['#anF1','#anT1'],['#anF2','#anT2']]){
    const field=$(id);if(field){const previous=historicalReadErrors.get(M().id+target);if(previous)$('#anStatus'+id.slice(-1)).textContent=previous;field.onchange=()=>{
      if(!store.canEdit(M().id)||busy||!field.files?.[0])return;
      historicalImports.get(id)?.controller.abort();
      const file=field.files[0],format=documentFormat(file),pdf=format==='pdf',word=format==='word';
      const status=$('#anStatus'+id.slice(-1)),targetField=$(target),modelId=M().id;
      historicalReadErrors.delete(modelId+target);
      const pending={controller:new AbortController(),file};historicalImports.set(id,pending);
      const current=()=>historicalImports.get(id)===pending&&M()?.id===modelId&&VIEW==='analise'&&(SUB.at||'dados')==='dados'&&$(id)===field&&field.files?.[0]===file;
      const unchanged=targetField.value;
      status.textContent=pdf?'A ler o PDF…':word?'A ler o Word…':'A ler o ficheiro…';protect();
      const done=()=>{if(historicalImports.get(id)===pending)historicalImports.delete(id);protect();};
      const failed=error=>{if(current()&&!pending.controller.signal.aborted){status.textContent='Leitura do balancete '+(target==='#anT2'?'N':'N−1')+': '+errorText(error);historicalReadErrors.set(modelId+target,status.textContent);toast(status.textContent);}done();};
      if(/\.doc$/i.test(file.name||''))return failed(Error('Guarde o Word antigo (.doc) como Word (.docx) ou PDF antes de importar.'));
      if(file.size>((pdf||word)?PDF_IMPORT_LIMIT:250000))return failed(Error(pdf||word?'O documento admite até 10 MB.':'O balancete CSV/TXT admite até 250 000 bytes.'));
      const reader=new FileReader();reader.onerror=()=>failed(Error('Não foi possível ler o ficheiro.'));
      reader.onload=async()=>{
        try{
          if(!current())return;
          let text,summary,pdfResult;
          if(pdf){
            const result=await extractPdfTrialBalance(reader.result,{signal:pending.controller.signal,progress:(page,total)=>{if(current())status.textContent=`A extrair o PDF: página ${page} de ${total}…`;}});
            pdfResult=result;text=result.text;summary=`PDF: ${result.pages} página(s), ${result.accounts} contas${result.scope==='accumulated'?' · saldos acumulados':''}${result.period?' · até '+result.period.to.split('-').reverse().join('/'):''} · diferença débito − crédito: ${nf(result.difference,2)}. Confira moeda, exercício e contas; prima Analisar para guardar.`;
          }else if(word){const result=await extractWordTrialBalance(reader.result,{signal:pending.controller.signal});text=result.text;summary=`Word: ${result.accounts} contas · diferença débito − crédito: ${nf(result.difference,2)}. Confira moeda, período e contas; prima Analisar para guardar.`;}
          else{text=decodeDocumentText(reader.result);summary='Ficheiro carregado. Confira os dados e prima Analisar para guardar.';}
          if(!current())return;
          if(targetField.value!==unchanged)throw Error('O texto foi editado durante a leitura. Seleccione o ficheiro novamente para substituir esses dados.');
          const key=target==='#anT2'?'N':'N1',other=$(target==='#anT2'?'#anT1':'#anT2').value.trim();
          if(pdfResult?.currency&&other&&$('#anMo').value!==pdfResult.currency)throw Error('Os documentos têm moedas diferentes. Carregue balancetes na mesma moeda de apresentação.');
          const periods={...S.an?.periods};delete periods[key];
          if(pdfResult?.period){periods[key]=pdfResult.period;const year=pdfResult.period.to.slice(0,4);$(key==='N'?'#anY2':'#anY1').value=pdfResult.period.to.split('-').reverse().join('/');if(key==='N'&&!other)$('#anY1').value=String(Math.max(1900,Number(year)-1));}
          if(pdfResult?.entityName&&!$('#anEmp').value.trim())$('#anEmp').value=pdfResult.entityName;
          if(pdfResult?.currency&&!other)$('#anMo').value=pdfResult.currency;
          S.an={...S.an,periods};
          targetField.value=text;historicalDirty.add(modelId);captureHistoricalDraft();status.textContent=summary;
          notice='';document.querySelector('#integra-notice')?.remove?.();historicalReadErrors.delete(modelId+target);
        }catch(error){failed(error);}finally{done();}
      };reader.readAsArrayBuffer(file);
    };}
  }
};
async function downloadReport(key) {
  if(key==='analise'&&historicalDirty.has(M().id))throw Error('Prima Analisar para validar e guardar os balancetes antes de descarregar o PDF.');
  const response=await store.download(M(),key),blob=await response.blob();
  const link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||`Integra-${key}.pdf`;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  toast('PDF descarregado.');
}
async function createCurrent() {
  const sk=document.querySelector('[name=nmS]:checked').value,nm=newModel(sk);
  const name=$('#nmN').value.trim();if(name)nm.nome=name;nm.inicio=$('#nmI').value;
  if(nm.inicio==='existente') {
    nm.inicioOp=1;const k=run(nm).k;
    nm.abertura={imob:nm.capex.reduce((s,c)=>s+c.valor,0)*0.6,vidaRem:8,exist:k.inv[2]||0,clientes:k.ar[2]||0,caixa:nm.caixaMin*2,fornec:k.ap[2]||0,divida:nm.divida.montante*0.5,divTaxa:nm.divida.taxa,divPrazo:4};
    nm.capex=[];nm.divida.montante=0;nm.receitas.forEach(r=>r.ramp='100');if(nm.tv.metodo==='nenhum')nm.tv.metodo='gordon';
  }
  const model=await store.create(nm);previewModel=null;S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);closeModal();go('pressupostos');toast('Modelo criado na base de dados.');
}
document.addEventListener('click',async ev=>{
  const target=ev.target instanceof Element?ev.target:null;if(!target)return;
  const menuAction=target.closest('[data-act]');
  if(menuAction?.dataset.act==='navToggle'){const group=menuAction.dataset.group,open=!navExpanded[group];for(const key of Object.keys(navExpanded))delete navExpanded[key];navExpanded[group]=open;renderNavigation();return;}
  if(menuAction?.dataset.act==='toggleMenu'){setMenuOpen(!$('.app').classList.contains('menu-open'));return;}
  if(menuAction?.dataset.act==='closeMenu'){setMenuOpen(false);return;}
  if(['logout','confirmLogout'].includes(menuAction?.dataset.act)){
    ev.preventDefault();if(busy||leaving)return;
    busy=true;signingOut=true;protect();$('#integra-session-status').hidden=true;
    try{await leaveModeling(menuAction.dataset.act==='confirmLogout');}
    catch(error){const status=$('#integra-session-status');status.hidden=false;status.textContent=errorText(error);toast(status.textContent);}
    finally{busy=false;signingOut=false;if(!leaving)protect();}return;
  }
  captureHistoricalDraft();
  const g=target.closest('[data-go]');if(g){ev.preventDefault();if(!busy){go(g.dataset.go);setMenuOpen(false);}return;}
  if(target.id==='ov')return closeModal();
  const a=target.closest('[data-act]');if(!a||a.disabled||busy)return;
  const d=a.dataset,m=M();
  const actions={close:closeModal,sub:()=>{SUB[d.k]=d.v;render();},newM:__NEW_MODEL_DIALOG__,createM:createCurrent,
    openProjects,projectTab:()=>{projectTab=d.v==='archived'?'archived':'active';projectCatalogue();},refreshProjects,
    viewProject:async()=>{await chooseProject(d.id);closeModal();},archiveProject:()=>confirmArchive(d.id),confirmArchive:archiveProject,restoreProject:()=>restoreProject(d.id),
    dupM:async()=>{const model=await store.create({...clone(m),nome:m.nome+' (cópia)'});previewModel=null;S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);render();toast('Modelo duplicado na base de dados.');},
    addRev:()=>{m.receitas.push({nome:'Nova linha',unid:'unidades',qtd:1000,cresc:5,ramp:'100',preco:1000,esc:m.inflacao});save();render();},
    delRev:()=>{m.receitas.splice(+d.i,1);save();render();},
    addCap:()=>{m.capex.push({nome:'Novo investimento',ano:1,valor:0,vida:5});save();render();},
    delCap:()=>{m.capex.splice(+d.i,1);save();render();},
    downloadFS:()=>downloadReport('demonstracoes'),downloadReport:()=>downloadReport(SUB.rep||'sumario'),
    applyCurrency,
    anRun:analyzeAndSave,anToModel:modelFromHistorical,anClearImport:()=>clearHistoricalDocument(d.number),anRemoveHistory:confirmHistoricalRemoval,anConfirmRemoval:removeHistoricalAnalysis,
    anDemo:()=>{S.an={empresa:DEMO_BAL.empresa,anos:DEMO_BAL.anos,N1:demoCSV(DEMO_BAL.N1),N:demoCSV(DEMO_BAL.N),pctCP:30,moeda:'Kz'};historicalDrafts.set(m.id,S.an);historicalDirty.add(m.id);SUB.at='dados';render();toast('Exemplo carregado. Prima Analisar se o quiser guardar neste projecto.');},
  };
  const action=actions[d.act];if(!action)return;ev.preventDefault();
  const mutation=['createM','dupM','addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency','archiveProject','confirmArchive','restoreProject'].includes(d.act);
  if(mutation&&!session.canWrite)return showError(Error('O seu acesso permite apenas consulta.'));
  if(['addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency'].includes(d.act)&&!store.canEdit(m?.id))return showError(Error('Projecto arquivado. Restaure-o antes de o alterar.'));
  busy=true;protect();
  try{await action();}catch(error){showError(error);}finally{busy=false;protect();}
});
$('#mSel').onchange=async()=>{
  captureHistoricalDraft();const next=$('#mSel').value;busy=true;protect();
  try{if(next==='__projects'){projectPicker();await openProjects();}else await chooseProject(next);}catch(error){projectPicker();showError(error);}finally{busy=false;protect();}
};
function historicalEdited(e){if(M()&&store?.canEdit(M().id)&&historicalFields.includes(e.target?.id)&&!['anF1','anF2'].includes(e.target.id)){historicalDirty.add(M().id);const key=M().id+'#'+e.target.id;if(historicalReadErrors.has(key)){historicalReadErrors.delete(key);$('#anStatus'+e.target.id.slice(-1)).textContent='Dados editados manualmente. Prima Analisar para validar.';notice='';document.querySelector('#integra-notice')?.remove?.();}}}
document.addEventListener('input',historicalEdited);
document.addEventListener('change',historicalEdited);
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();setMenuOpen(false);}});
window.addEventListener('beforeunload',e=>{if(!leaving&&(store?.dirty||historicalDirty.size||historicalImports.size)){e.preventDefault();e.returnValue='';}});
async function boot(){
  try {
    session=JSON.parse($('#integra-session').textContent);
    store=new ModelingStore(session.canWrite,modelingRequest,showError);
    const opening=session.bootstrap;
    const data=opening?[opening.models,opening.templates]:await Promise.all([modelingRequest('/models'),modelingRequest('/templates')]);
    templates=data[1];store.load(data[0]);S.models=store.models;S.active=S.models[0]?.id||null;
    if(M()&&opening?.firstHistory?.modelId===M().id&&opening.firstHistory.revision===store.revision(M().id)){
      S.an=opening.firstHistory.historical?.analysis.input||null;historicalDrafts.set(M().id,S.an);
      if(opening.firstHistory.historical)historicalSaved.add(M().id);
    }else if(M())await selectHistorical(M());
    const view=(location.hash||'').slice(1);if(VIEWS[view])VIEW=view;
    render();
  }catch(error){$('#view').innerHTML=alertMessage(errorText(error));document.querySelectorAll('button,select').forEach(e=>e.disabled=e.dataset.act!=='logout');}
}
// A fonte externa melhora a tipografia quando chega, sem bloquear a interface ou o motor.
const fontStylesheet=$('#integra-fonts');
if(fontStylesheet){fontStylesheet.addEventListener?.('load',()=>{fontStylesheet.media='all';});if(fontStylesheet.sheet)fontStylesheet.media='all';}
setupModelingMobile(()=>openModal('Instalar Kianda no iPhone','<p>No Safari, toque em <b>Partilhar</b> e depois em <b>Adicionar ao ecrã principal</b>. Ao abrir o Kianda, entre na sua conta e escolha o Integra em Módulos e licenças.</p>','<button class="btn pri" data-act="close">Fechar</button>'));
reloadPrivatePageOnRestore();
window.addEventListener('resize',()=>{if(window.matchMedia?.('(min-width: 821px)').matches)setMenuOpen(false);});
boot();
