/* Liga a interface aprovada à API. Este ficheiro é montado depois das vistas do protótipo. */
let store, session, templates = [], notice = '', busy = false;
let previewModel=null, projectDialog=null, projectUsage=null, projectTab='active';
let currencyDialog=null;
let leaving=false, signingOut=false;
function clearModelSession(){
  leaving=true;store?.stopAutosave();
  for(const pending of historicalImports.values())pending.controller.abort();historicalImports.clear();
  historicalDirty.clear();historicalDrafts.clear();historicalSaved.clear();historicalReadErrors.clear();
  session=null;S.models=[];S.active=null;S.an=null;previewModel=null;versionView=null;
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
  decoratePersonnelField();
  const field=document.querySelector('[data-p="moeda"]');
  if(field)field.onchange=()=>{const model=M(),to=field.value;field.value=model.moeda;if(!versionView&&to!==model.moeda)return openCurrencyConversion(model,to);};
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
  previewModel=null;versionView=null;S.active=result.model.id;S.an=result.historical.analysis.input;historicalDrafts.set(M().id,S.an);historicalSaved.add(M().id);
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
function save(){if(M()&&!versionView)store.change(M());}
function projectPicker(){
  const selected=M()?.id;
  $('#mSel').innerHTML=(versionView?`<option value="__version" selected>Versão v${versionView.number} · ${esc(previewModel.nome)}</option>`:previewModel?`<option value="${esc(previewModel.id)}" selected>Arquivado · ${esc(previewModel.nome)}</option>`:'')+(!S.models.length&&!previewModel?'<option value="" selected disabled>Seleccione um projecto</option>':'')+S.models.map(m=>`<option value="${esc(m.id)}" ${selected===m.id?'selected':''}>${esc(m.nome)}</option>`).join('')+'<option value="__projects">Gerir projectos…</option>';
  if(versionView)$('#mSel').value='__version';else if(selected)$('#mSel').value=selected;
}
async function chooseProject(id){
  await store.flush();
  const model=store.project(id);if(!model)throw Error('Projecto inexistente nesta lista. Actualize os projectos.');
  versionView=null;
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
  versionView=null;previewModel=model&&store.archivedAt(model.id)?model:null;S.active=model&&!previewModel?model.id:store.models[0]?.id||null;
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
  if(selected===model.id){previewModel=model;versionView=null;S.active=null;S.an=historicalDrafts.get(model.id)||null;}
  notice='';render();toast('Projecto arquivado. Os dados foram conservados.');
  try{projectUsage=await modelingRequest('/usage');}catch{projectUsage=null;}
  if(projectDialog===context){projectDialog={kind:'catalogue'};projectTab='archived';projectCatalogue();}
}
async function restoreProject(id){
  const model=await store.setArchived(id,false);
  previewModel=null;versionView=null;S.active=id;S.an=historicalDrafts.get(id)||null;notice='';
  try{await selectHistorical(model);}catch{S.an=null;notice='Projecto restaurado. Não foi possível carregar os balancetes; seleccione novamente o projecto para os consultar.';}
  closeModal();render();toast('Projecto restaurado e incluído nos projectos activos.');
  try{projectUsage=await modelingRequest('/usage');}catch{projectUsage=null;}
}
function protect() {
  const companyWrite=session?.canWrite&&!busy,writable=companyWrite&&M()&&!versionView&&store.canEdit(M().id);
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
  for(const action of ['hrImport','hrImportApply'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{el.disabled=!writable;});
  const draft=M()&&draftProject();
  document.querySelectorAll('[data-act="approveVersion"]').forEach(el=>{el.disabled=busy||!companyWrite||!versionDialog||!store.canEdit(versionDialog.modelId);});
  document.querySelectorAll('[data-act="versions"]').forEach(el=>{el.disabled=busy||!draft;el.title=draft?'Aprovar a revisão actual e consultar versões aprovadas':'Seleccione um projecto';});
  for(const action of ['downloadFS','downloadReport'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{
    el.disabled=busy||!session?.formats?.pdf;
    el.title=session?.formats?.pdf?'Descarregar PDF':'Pré-visualização. Active uma subscrição paga do Integra para exportar.';
  });
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
  if(versionView)$('#view').insertAdjacentHTML('afterbegin',versionBanner());
  else if(previewModel)$('#view').insertAdjacentHTML('afterbegin',`<div class="alert b" role="status">${ico('info',17)}<div>Projecto arquivado · consulta. Para voltar a gravar alterações, escolha Gerir projectos… no selector de modelos e restaure o projecto.</div></div>`);
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
  if(!session?.formats?.pdf)throw Error('Pode pré-visualizar os documentos. Active uma subscrição paga do Integra para exportar.');
  if(key==='analise'&&historicalDirty.has(M().id))throw Error('Prima Analisar para validar e guardar os balancetes antes de descarregar o PDF.');
  if(versionView){
    if(key==='analise'&&!S.an)throw Error('Esta versão não contém balancetes históricos analisados.');
    return saveDownload(await store.download(store.project(versionView.modelId),key,versionView.versionId),`Integra-v${versionView.number}-${key}.pdf`);
  }
  await saveDownload(await store.download(M(),key),`Integra-${key}.pdf`);
}
async function createCurrent() {
  const sk=document.querySelector('[name=nmS]:checked').value,nm=newModel(sk);
  const name=$('#nmN').value.trim();if(name)nm.nome=name;nm.inicio=$('#nmI').value;
  if(nm.inicio==='existente') {
    nm.inicioOp=1;const k=run(nm).k;
    nm.abertura={imob:nm.capex.reduce((s,c)=>s+c.valor,0)*0.6,vidaRem:8,exist:k.inv[2]||0,clientes:k.ar[2]||0,caixa:nm.caixaMin*2,fornec:k.ap[2]||0,divida:nm.divida.montante*0.5,divTaxa:nm.divida.taxa,divPrazo:4};
    nm.capex=[];nm.divida.montante=0;nm.receitas.forEach(r=>r.ramp='100');if(nm.tv.metodo==='nenhum')nm.tv.metodo='gordon';
  }
  const model=await store.create(nm);previewModel=null;versionView=null;S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);closeModal();go('pressupostos');toast('Modelo criado na base de dados.');
}
/* ---------------- Versões aprovadas (comité, banco) ---------------- */
let versionView=null,versionDialog=null;
const VERSION_LABELS=['Comité de investimento','Proposta ao banco','Conselho de administração','Assembleia de accionistas'];
const isCompanyOwner=()=>session?.user?.role==='owner';
function luandaDateTime(value){const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('pt-PT',{timeZone:'Africa/Luanda',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';}
const versionReportKeys=available=>Object.keys(REPS).filter(k=>k!=='analise'||available);
function draftProject(){return versionView?store.project(versionView.modelId):M();}
async function openVersions(){
  const model=draftProject();if(!model)throw Error('Seleccione um projecto.');
  if(store.canEdit(model.id))await store.flush(model.id);
  const context=versionDialog={modelId:model.id,list:null,analysis:{}};
  openModal('Versões aprovadas','<p class="muted">A consultar as versões do projecto…</p>','<button class="btn" data-act="close">Fechar</button>','920px');
  const list=await store.versions(model.id);
  // Saber se cada versão inclui o relatório histórico (só aparece na lista quando existe).
  const reports=await Promise.all(list.map(v=>modelingRequest(`/models/${encodeURIComponent(model.id)}/reports?version=${encodeURIComponent(v.id)}`).catch(()=>null)));
  if(versionDialog!==context)return;
  context.list=list;list.forEach((v,i)=>{context.analysis[v.id]=!!reports[i]?.reports?.find(r=>r.key==='analise')?.available;});
  renderVersionsDialog();
}
function approvalBlock(model){
  const revision=store.revision(model.id),latest=versionDialog.list[0];
  if(!isCompanyOwner())return `<div class="alert b">${ico('info',17)}<div>A aprovação de versões é reservada ao proprietário da empresa. Pode consultar e descarregar as versões já aprovadas.</div></div>`;
  if(!session.canWrite||!store.canEdit(model.id))return `<div class="alert a">${ico('alert',17)}<div>${store.archivedAt(model.id)?'Projecto arquivado: restaure-o para aprovar uma nova versão.':'Licença ou acesso em consulta: não é possível aprovar versões.'}</div></div>`;
  let calculable=true;try{run(model);}catch{calculable=false;}
  const same=versionDialog.list.filter(v=>v.sourceRevision===revision);
  return `<div class="card" style="margin-bottom:14px"><div class="hd"><h3>Aprovar a revisão actual (r${revision})</h3><span class="muted">${esc(model.nome)}</span></div><div class="bd">
    <p class="muted" style="margin-bottom:10px">Congela pressupostos, demonstrações, avaliação, crédito, cenários e relatórios desta revisão, com a sua identificação. O rascunho continua editável; uma versão aprovada nunca muda.</p>
    ${same.length?`<div class="alert b">${ico('info',17)}<div>Esta revisão já foi aprovada como ${same.map(v=>`v${v.versionNumber} (${esc(v.label)})`).join(', ')}. Pode aprová-la com outro destino.</div></div>`:latest?`<div class="alert b">${ico('info',17)}<div>Última versão: v${latest.versionNumber} (${esc(latest.label)}), da revisão r${latest.sourceRevision}. O rascunho tem alterações posteriores.</div></div>`:''}
    ${calculable?'':`<div class="alert r">${ico('alert',17)}<div>Os pressupostos estão incompletos ou inválidos. Corrija-os em Pressupostos antes de aprovar.</div></div>`}
    <div class="form"><div class="f w2"><label for="versionLabel">Destino / identificação da versão</label><input class="inp" id="versionLabel" maxlength="80" list="versionLabels" placeholder="Ex.: Comité de investimento"><datalist id="versionLabels">${VERSION_LABELS.map(l=>`<option value="${esc(l)}">`).join('')}</datalist><span class="hint">Aparece no cabeçalho dos PDF e no histórico de aprovação.</span></div>
    <div class="f" style="justify-content:flex-end"><button class="btn pri" data-act="approveVersion" ${calculable?'':'disabled'}>${ico('check')}Aprovar revisão r${revision}</button></div></div>
    <div id="projectError" role="alert" class="muted"></div></div></div>`;
}
function renderVersionsDialog(){
  const context=versionDialog,model=store.project(context.modelId);if(!model)return closeModal();
  const pdf=!!session?.formats?.pdf;
  const rows=context.list.map(v=>`<tr${versionView?.versionId===v.id?' style="background:var(--brandSoft)"':''}><td><b>v${v.versionNumber}</b></td><td>${esc(v.label)}</td><td>${esc(luandaDateTime(v.approvedAt))}<div class="muted">${esc(v.approvedByName||'—')}</div></td><td class="num"><span class="muted versions-only-mobile">Revisão </span>r${v.sourceRevision}</td>
    <td class="num"><div class="rowact" style="justify-content:flex-end;flex-wrap:wrap"><button class="btn sm" data-act="openVersion" data-id="${esc(v.id)}">${versionView?.versionId===v.id?'Em consulta':'Consultar'}</button>
    <select class="sel" id="vrep-${esc(v.id)}" aria-label="Relatório da versão v${v.versionNumber}" style="height:29px;max-width:210px">${versionReportKeys(context.analysis[v.id]).map(k=>`<option value="${k}">${esc(REPS[k].t)}</option>`).join('')}</select>
    <button class="btn sm" data-act="versionPdf" data-id="${esc(v.id)}" ${pdf?'':'disabled title="Pré-visualização. Active uma subscrição paga do Integra para exportar."'}>${ico('doc')}PDF</button></div></td></tr>`).join('');
  openModal('Versões aprovadas',approvalBlock(model)+`<div class="tblwrap"><table class="t versions-table"><thead><tr><th>Versão</th><th>Destino</th><th>Aprovada</th><th class="num">Revisão</th><th class="num">Consultar e descarregar</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Ainda não há versões aprovadas deste projecto.</td></tr>'}</tbody></table></div>
    <p class="hint" style="margin-top:10px">O PDF de uma versão é gerado a partir do registo congelado na aprovação e é sempre igual, mesmo que o rascunho mude depois.</p>`,`<button class="btn" data-act="close">Fechar</button>`,'920px');
  protect();
}
async function approveVersion(){
  const context=versionDialog;if(!context)throw Error('Abra novamente as versões do projecto.');
  const label=$('#versionLabel').value.trim();
  if(!label)throw Error('Indique o destino da versão (ex.: Comité de investimento).');
  const version=await store.approve(context.modelId,label);
  toast(`Versão v${version.versionNumber} aprovada: ${version.label}.`);
  if(versionDialog===context){context.list=await store.versions(context.modelId);context.analysis[version.id]=historicalSaved.has(context.modelId);if(versionDialog===context)renderVersionsDialog();}
}
async function openVersion(versionId){
  const context=versionDialog;if(!context)throw Error('Abra novamente as versões do projecto.');
  if(historicalDirty.has(context.modelId))throw Error('Analise e guarde os balancetes em edição antes de consultar uma versão.');
  await store.flush();
  const v=await store.version(context.modelId,versionId),p=v.payload;
  const model=presentModel({id:context.modelId,name:String(p.source.projectName??''),sector:String(p.source.sector??''),currency:String(p.source.currency??''),assumptions:p.inputAssumptions,revision:v.sourceRevision,createdAt:v.approvedAt,archivedAt:null});
  // O ecrã recalcula com o motor actual; confirma-se que reproduz o valor aprovado.
  let matches=false;try{const npv=run(model,{cen:p.result.scenario}).npv;matches=p.result.engineVersion===FINANCIAL_ENGINE_VERSION&&Math.abs(npv-p.result.npv)<=Math.max(1,Math.abs(p.result.npv))*1e-9;}catch{matches=false;}
  versionView={modelId:context.modelId,versionId:v.id,number:v.versionNumber,label:v.label,approvedAt:v.approvedAt,approvedByName:v.approvedByName,engine:p.result.engineVersion,matches};
  previewModel=model;S.an=p.historical?.input||null;notice='';
  closeModal();render();toast(`A consultar a versão v${v.versionNumber} (só leitura).`);
}
async function versionPdf(versionId,key){
  const context=versionDialog;if(!context)throw Error('Abra novamente as versões do projecto.');
  if(!session?.formats?.pdf)throw Error('Pode pré-visualizar os documentos. Active uma subscrição paga do Integra para exportar.');
  await saveDownload(await store.download(store.project(context.modelId),key,versionId),`Integra-v-${key}.pdf`);
}
async function saveDownload(response,fallback){
  const blob=await response.blob(),link=document.createElement('a'),url=URL.createObjectURL(blob);
  link.href=url;link.download=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||fallback;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  toast('PDF descarregado.');
}
function versionBanner(){
  const v=versionView;if(!v)return '';
  return `<div class="alert ${v.matches?'g':'a'}" role="status">${ico(v.matches?'check':'alert',17)}<div style="flex:1"><b>Versão aprovada v${v.number} · ${esc(v.label)}</b> — aprovada por ${esc(v.approvedByName||'—')} em ${esc(luandaDateTime(v.approvedAt))}. Só consulta: os campos estão bloqueados e nada é gravado.
    ${v.matches?' Os mapas no ecrã reproduzem o cálculo aprovado.':` <b>Atenção:</b> o cálculo no ecrã difere do aprovado. Os PDF da versão fazem fé.`} Os PDF descarregados aqui são os documentos aprovados.</div>
    <div class="rowact"><button class="btn sm" data-act="versions">Versões</button><button class="btn sm pri" data-act="leaveVersion">Voltar ao rascunho</button></div></div>`;
}

/* ---------------- Importação dos custos com pessoal do RH ---------------- */
let importDialog=null;const personnelImports=new Map();
const monthLabelPt=p=>p?p.split('-').reverse().join('/'):'—';
const kzMinor=minor=>`${nf(minor/100,0)} Kz`;
const importSourceLabel=i=>i.source==='budget'?`Orçamento de pessoal ${i.fromPeriod.slice(0,4)}`:`Custo real ${monthLabelPt(i.fromPeriod)}–${monthLabelPt(i.toPeriod)}`;
function lastImportHint(model){
  const list=personnelImports.get(model.id);if(!list?.length)return list?'Valor introduzido manualmente (sem importações do RH).':'';
  const last=list[0],same=Math.abs((last.snapshot.annualPersonnel??0)-(Number(model.pessoal)||0))<=1e-6*Math.max(1,Math.abs(model.pessoal||0));
  return `Importado do RH: ${importSourceLabel(last)} · ${luandaDateTime(last.importedAt)}${last.importedByName?' · '+last.importedByName:''}${same?'':' · alterado manualmente depois da importação'}`;
}
async function loadImportHint(model){
  if(versionView||personnelImports.has(model.id))return;
  try{const detail=await store.detail(model.id);personnelImports.set(model.id,Array.isArray(detail?.imports)?detail.imports:[]);}catch{return;}
  const hint=document.querySelector('#hrImportHint');if(hint&&M()?.id===model.id)hint.textContent=lastImportHint(M());
}
function decoratePersonnelField(){
  const field=document.querySelector('#assumption-pessoal'),model=M();if(!field||!model)return;
  const box=field.closest?.('.f');if(!box||box.querySelector?.('#hrImportHint'))return;
  const canImport=!versionView&&session.canWrite&&store.canEdit(model.id);
  box.insertAdjacentHTML('beforeend',`<div class="rowact" style="margin-top:4px;flex-wrap:wrap">${canImport?'<button type="button" class="btn sm" data-act="hrImport">Importar do RH</button>':''}<span class="hint" id="hrImportHint">${esc(lastImportHint(model))}</span></div>`);
  loadImportHint(model);
}
async function openPersonnelImport(){
  const model=M();if(!model||versionView||!store.canEdit(model.id))throw Error('Só pode importar num projecto que edita.');
  const context=importDialog={modelId:model.id,sources:null,imports:[],quote:null};
  openModal('Importar custos com pessoal do RH','<p class="muted">A consultar o RH…</p>','<button class="btn" data-act="close">Fechar</button>','780px');
  const [sources,detail]=await Promise.all([store.personnelSources(),store.detail(model.id)]);
  if(importDialog!==context)return;
  context.sources=sources;context.imports=Array.isArray(detail?.imports)?detail.imports:[];personnelImports.set(model.id,context.imports);
  if(model.moeda!=='Kz'&&sources.hr.active){try{context.quote=await modelingRequest('/exchange-rate?'+new URLSearchParams({from:'Kz',to:model.moeda}));}catch{context.quote=null;}}
  if(importDialog===context)renderImportDialog();
}
function importHistoryTable(imports,currency){
  if(!imports.length)return '<p class="muted">Ainda não houve importações neste projecto.</p>';
  return `<div class="tblwrap"><table class="t"><thead><tr><th>Data</th><th>Origem</th><th class="num">Total em Kz</th><th class="num">Valor no ano 1</th><th>Por</th></tr></thead><tbody>${imports.map(i=>`<tr><td>${esc(luandaDateTime(i.importedAt))}</td><td>${esc(importSourceLabel(i))}${i.snapshot.currency!=='Kz'?`<div class="muted">Câmbio: ${esc(String(i.snapshot.exchangeRate))} ${esc(i.snapshot.currency)} por 1 Kz</div>`:''}</td><td class="num">${kzMinor(i.snapshot.totalMinor)}</td><td class="num">${nf(i.snapshot.annualPersonnel,currency==='Kz'?0:2)} ${esc(i.snapshot.currency)}</td><td>${esc(i.importedByName||'—')}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderImportDialog(){
  const context=importDialog,model=store.project(context.modelId);if(!model)return closeModal();
  const {sources}=context,year1=(Number(model.anoBase)||new Date().getFullYear())+1,foreign=model.moeda!=='Kz';
  const intro=`<div class="alert b">${ico('info',17)}<div>Copia o custo anual da empresa (ilíquido + INSS da entidade empregadora) para <b>72 · Custos com o pessoal</b> do ano 1 (${year1}). É uma cópia com data e origem: alterações posteriores no RH não mudam o projecto. Não são copiados nomes nem salários individuais.</div></div>`;
  const history=`<h3 style="font-size:13px;margin:16px 0 6px">Importações anteriores</h3>${importHistoryTable(context.imports,model.moeda)}`;
  if(!sources.hr.active){openModal('Importar custos com pessoal do RH',intro+`<div class="alert a">${ico('alert',17)}<div>${esc(sources.hr.message||'O módulo RH não está activo.')}</div></div>`+history,'<button class="btn" data-act="close">Fechar</button>','780px');return;}
  const hasBudget=sources.budgets.length>0,hasActual=sources.windows.length>0,first=hasBudget?'budget':hasActual?'actual':null;
  const q=context.quote;
  const body=intro+(first?'':`<div class="alert a">${ico('alert',17)}<div>Não há orçamentos de pessoal aprovados nem 12 meses consecutivos com processamento fechado${sources.lastClosed?` (último mês fechado: ${monthLabelPt(sources.lastClosed)})`:''}. Aprove um orçamento em Orçamento de pessoal ou introduza o valor manualmente.</div></div>`)+
    (first?`<div class="form"><div class="f full"><label>Origem</label><div class="rowact" style="flex-wrap:wrap;gap:16px">
      <label style="font-weight:500"><input type="radio" name="hrSource" value="budget" ${first==='budget'?'checked':''} ${hasBudget?'':'disabled'}> Orçamento de pessoal aprovado</label>
      <label style="font-weight:500"><input type="radio" name="hrSource" value="actual" ${first==='actual'?'checked':''} ${hasActual?'':'disabled'}> Custo real de 12 meses fechados</label></div></div>
      <div class="f w2" id="hrBudgetBox"><label for="hrBudget">Orçamento</label><select class="sel" id="hrBudget" ${hasBudget?'':'disabled'}>${sources.budgets.map(b=>`<option value="${esc(b.id)}">${b.year} · ${kzMinor(b.totalMinor)}</option>`).join('')||'<option>Sem orçamentos aprovados</option>'}</select></div>
      <div class="f w2" id="hrActualBox"><label for="hrWindow">Período</label><select class="sel" id="hrWindow" ${hasActual?'':'disabled'}>${sources.windows.map(w=>`<option value="${esc(w.from)}|${esc(w.to)}">${monthLabelPt(w.from)} a ${monthLabelPt(w.to)}</option>`).join('')||'<option>Sem 12 meses fechados</option>'}</select></div>
      ${foreign?`<div class="f w2"><label for="hrRate">Câmbio: ${esc(model.moeda)} por 1 Kz</label><input class="inp n" id="hrRate" type="number" inputmode="decimal" step="any" min="0" value="${q?esc(String(q.rate)):''}"><span class="hint">${q?`Referência ${esc(q.source)} de ${esc(monthLabelPt(q.rateDate))}${q.stale?' · com mais de 7 dias, confirme':''}. Pode indicar outra taxa.`:'Indique a taxa a aplicar (sem consulta automática disponível).'}</span></div>`:''}
      </div><div id="hrPreview" style="margin-top:10px"></div>`:'')+history;
  openModal('Importar custos com pessoal do RH',body+'<div id="projectError" role="alert" class="muted"></div>',`<button class="btn" data-act="close">Cancelar</button>${first?'<button class="btn pri" data-act="hrImportApply">Importar e substituir</button>':''}`,'780px');
  for(const el of document.querySelectorAll('[name=hrSource],#hrBudget,#hrWindow,#hrRate'))el.addEventListener(el.id==='hrRate'?'input':'change',updateImportPreview);
  updateImportPreview();protect();
}
function importChoice(){
  const context=importDialog,source=document.querySelector('[name=hrSource]:checked')?.value;if(!context||!source)return null;
  const model=store.project(context.modelId),rate=model.moeda==='Kz'?1:Number($('#hrRate')?.value);
  if(source==='budget'){const b=context.sources.budgets.find(x=>x.id===$('#hrBudget').value);return b?{source,budget:b,rate}:null;}
  const [from,to]=($('#hrWindow').value||'').split('|');return from&&to?{source,from,to,rate}:null;
}
function updateImportPreview(){
  const box=document.querySelector('#hrPreview'),context=importDialog;if(!box||!context)return;
  const model=store.project(context.modelId),choice=importChoice(),year1=(Number(model.anoBase)||0)+1;
  const budgetBox=document.querySelector('#hrBudgetBox'),actualBox=document.querySelector('#hrActualBox');
  // .form .f usa display:flex, que se sobrepõe ao atributo hidden: esconde-se pelo estilo.
  if(budgetBox?.style)budgetBox.style.display=choice?.source==='budget'?'':'none';if(actualBox?.style)actualBox.style.display=choice?.source==='actual'?'':'none';
  if(!choice){box.innerHTML='';return;}
  const current=`Valor actual no projecto: <b>${assumptionMoney(Number(model.pessoal)||0)}</b>.`;
  const rateOk=Number.isFinite(choice.rate)&&choice.rate>0;
  if(choice.source==='budget'){
    const value=choice.budget.totalMinor/100*(rateOk?choice.rate:NaN);
    const year=choice.budget.year!==year1?`<div class="alert a" style="margin-top:8px">${ico('alert',17)}<div>O orçamento é de ${choice.budget.year} e o ano 1 do projecto é ${year1}. O motor aplica a inflação a partir do ano 1: confirme que este é o valor pretendido para ${year1}.</div></div>`:'';
    box.innerHTML=`<div class="ratio"><span>Novo valor no ano 1 (${year1})</span><b>${rateOk?assumptionMoney(value):'indique o câmbio'}</b></div><p class="hint">${current} O valor anterior fica no histórico de auditoria.</p>${year}`;
  }else{
    box.innerHTML=`<div class="ratio"><span>Novo valor no ano 1 (${year1})</span><b>soma de ${monthLabelPt(choice.from)} a ${monthLabelPt(choice.to)}${rateOk?'':' · indique o câmbio'}</b></div><p class="hint">${current}</p><div class="alert a" style="margin-top:8px">${ico('alert',17)}<div>É o custo real desse período, em kwanzas da altura. O motor não o actualiza até ${year1}: se o período for anterior, reveja a inflação ou ajuste o valor depois de importar.</div></div>`;
  }
}
async function applyPersonnelImport(){
  const context=importDialog,choice=importChoice();if(!context||!choice)throw Error('Seleccione a origem a importar.');
  const model=store.project(context.modelId);
  if(model.moeda!=='Kz'&&!(Number.isFinite(choice.rate)&&choice.rate>0))throw Error(`Indique o câmbio: unidades de ${model.moeda} por 1 Kz.`);
  const input=choice.source==='budget'?{source:'budget',budgetId:choice.budget.id}:{source:'actual',from:choice.from,to:choice.to};
  if(model.moeda!=='Kz')input.exchangeRate=choice.rate;
  const result=await store.importPersonnel(context.modelId,input);
  personnelImports.set(context.modelId,[{...result.import,importedByName:session.user.name},...(personnelImports.get(context.modelId)||[])]);
  closeModal();render();toast(`Custos com pessoal importados: ${assumptionMoney(result.model.pessoal)} no ano 1.`);
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
    dupM:async()=>{const model=await store.create({...clone(m),nome:m.nome+(versionView?` (a partir da v${versionView.number})`:' (cópia)')});previewModel=null;versionView=null;S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);render();toast('Modelo duplicado na base de dados.');},
    addRev:()=>{m.receitas.push({nome:'Nova linha',unid:'unidades',qtd:1000,cresc:5,ramp:'100',preco:1000,esc:m.inflacao});save();render();},
    delRev:()=>{m.receitas.splice(+d.i,1);save();render();},
    addCap:()=>{m.capex.push({nome:'Novo investimento',ano:1,valor:0,vida:5});save();render();},
    delCap:()=>{m.capex.splice(+d.i,1);save();render();},
    downloadFS:()=>downloadReport('demonstracoes'),downloadReport:()=>downloadReport(SUB.rep||'sumario'),
    applyCurrency,
    versions:openVersions,approveVersion,openVersion:()=>openVersion(d.id),versionPdf:()=>versionPdf(d.id,$('#vrep-'+d.id).value),
    leaveVersion:()=>chooseProject(versionView.modelId),hrImport:openPersonnelImport,hrImportApply:applyPersonnelImport,
    anRun:analyzeAndSave,anToModel:modelFromHistorical,anClearImport:()=>clearHistoricalDocument(d.number),anRemoveHistory:confirmHistoricalRemoval,anConfirmRemoval:removeHistoricalAnalysis,
    anDemo:()=>{S.an={empresa:DEMO_BAL.empresa,anos:DEMO_BAL.anos,N1:demoCSV(DEMO_BAL.N1),N:demoCSV(DEMO_BAL.N),pctCP:30,moeda:'Kz'};historicalDrafts.set(m.id,S.an);historicalDirty.add(m.id);SUB.at='dados';render();toast('Exemplo carregado. Prima Analisar se o quiser guardar neste projecto.');},
  };
  const action=actions[d.act];if(!action)return;ev.preventDefault();
  const mutation=['approveVersion','hrImportApply','createM','dupM','addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency','archiveProject','confirmArchive','restoreProject'].includes(d.act);
  if(mutation&&!session.canWrite)return showError(Error('O seu acesso permite apenas consulta.'));
  if(versionView&&['addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency','hrImport','hrImportApply'].includes(d.act))return showError(Error('Versão aprovada: só consulta. Volte ao rascunho para alterar.'));
  if(['hrImport','hrImportApply','addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','anClearImport','anRemoveHistory','anConfirmRemoval','applyCurrency'].includes(d.act)&&!store.canEdit(m?.id))return showError(Error('Projecto arquivado. Restaure-o antes de o alterar.'));
  busy=true;protect();
  try{await action();}catch(error){showError(error);}finally{busy=false;protect();}
});
$('#mSel').onchange=async()=>{
  captureHistoricalDraft();const next=$('#mSel').value;busy=true;protect();
  try{if(next==='__version'){projectPicker();}else if(next==='__projects'){projectPicker();await openProjects();}else await chooseProject(next);}catch(error){projectPicker();showError(error);}finally{busy=false;protect();}
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
