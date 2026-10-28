/* Liga a interface aprovada à API. Este ficheiro é montado depois das vistas do protótipo. */
let store, session, templates = [], notice = '', busy = false;
let currencyDialog=null;
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
  if(!session.canWrite||busy)return;
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
const historicalFields=['anEmp','anY1','anY2','anCP','anMo','anT1','anT2','anF1','anF2'];
function captureHistoricalDraft(){
  if(VIEW!=='analise'||(SUB.at||'dados')!=='dados'||!M()||!session.canWrite||!historicalDirty.has(M().id))return;
  const input={empresa:$('#anEmp').value,anos:[$('#anY1').value,$('#anY2').value],pctCP:Number($('#anCP').value),moeda:$('#anMo').value,N1:$('#anT1').value,N:$('#anT2').value};
  historicalDrafts.set(M().id,input);S.an=input;
}
async function selectHistorical(model){
  if(historicalDrafts.has(model.id)){S.an=historicalDrafts.get(model.id);return;}
  const historical=await store.history(model.id);S.an=historical?.analysis.input||null;
  historicalDrafts.set(model.id,S.an);
}
function analyze(){
  if(!S.an?.N)return null;
  try{return analyzeFinancialHistory(S.an)}catch(error){return {err:esc(errorText(error))};}
}
async function analyzeAndSave(){
  if(historicalImports.size)throw Error('Aguarde a leitura do ficheiro antes de analisar.');
  historicalDirty.add(M().id);captureHistoricalDraft();
  analyzeFinancialHistory(S.an);
  const historical=await store.saveHistory(M().id,S.an);
  S.an=historical.analysis.input;historicalDrafts.set(M().id,S.an);historicalDirty.delete(M().id);
  SUB.at='balanco';notice='';render();toast('Balancetes analisados e guardados neste projecto.');
}
async function modelFromHistorical(){
  if(historicalDirty.has(M().id))throw Error('Prima Analisar para validar e guardar os balancetes antes de criar o modelo.');
  const result=await store.createFromHistory(M().id);
  S.active=result.model.id;S.an=result.historical.analysis.input;historicalDrafts.set(M().id,S.an);
  go('pressupostos');toast('Modelo criado. Reveja os pressupostos de projecção e financiamento.');
}
function errorText(error) {
  if (error?.issues) return error.issues.map(v=>`${v.path}: ${v.message}`).join(' · ');
  return error?.message || 'Não foi possível concluir. Tente novamente.';
}
function showError(error) { notice=errorText(error);toast(notice);render(); }
function alertMessage(message) { return `<div class="alert r" role="alert">${ico('alert',17)}<div>${esc(message)}</div></div>`; }
function liveStrip(){try{return liveStripPrototype()}catch(error){return alertMessage(errorText(error));}}
function optionalNpv(model,overrides={}) { try{return run(model,overrides).npv}catch(error){if(error instanceof FinancialModelError||error instanceof RangeError)return null;throw error;} }
function validRange(values,fn) { return values.every(Number.isFinite)?fn(...values):null; }
function save(){if(M())store.change(M());}
function protect() {
  const writable=session?.canWrite && !busy;
  document.querySelectorAll('[data-p],[data-cen]').forEach(el=>{
    if(!writable){if(el.dataset.restoreDisabled===undefined)el.dataset.restoreDisabled=el.disabled?'1':'0';el.disabled=true;}
    else if(el.dataset.restoreDisabled!==undefined){el.disabled=el.dataset.restoreDisabled==='1';delete el.dataset.restoreDisabled;}
  });
  document.querySelectorAll(historicalFields.map(id=>'#'+id).join(',')).forEach(el=>{el.disabled=!writable;});
  document.querySelectorAll(currencyFields.map(id=>'#'+id).join(',')).forEach(el=>{el.disabled=!writable;});
  for(const action of ['newM','dupM','createM','addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','applyCurrency'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{
    el.disabled=!writable||(action==='dupM'&&!M())||historicalImports.size>0&&['anRun','anToModel','anDemo'].includes(action);
    if(!session?.canWrite)el.title='Acesso apenas de consulta.';
  });
  $('#mSel').disabled=busy||!S.models.length;
  $('#mSel').title=notice||'Projectos da empresa; alterações guardadas na base de dados.';
}
function render() {
  if(!session)return;
  for(const pending of historicalImports.values())pending.controller.abort();
  historicalImports.clear();
  $('#view').dataset.view=VIEW;
  $('#view').dataset.wide=String(['demonstracoes','credito','sensibilidade','analise'].includes(VIEW)||VIEW==='pressupostos'&&['capex','receitas'].includes(SUB.pt));
  if(!M()) {
    $('#nav').innerHTML=NAV.map(n=>n[0]==='g'?`<div class="grp">${n[1]}</div>`:`<a data-go="${n[0]}">${ico(n[2],17)}<span>${n[1]}</span></a>`).join('');
    $('#mSel').innerHTML='';$('#mTags').innerHTML='';
    $('#view').innerHTML=ph('Modelagem financeira','Projectos da empresa')+`<div class="alert b">${ico('info',17)}${session.canWrite?'Ainda não há projectos activos. Utilize + Novo modelo para começar.':'Ainda não há projectos activos para consultar.'}</div>`+(notice?alertMessage(notice):'');
    protect();return;
  }
  try{renderPrototype();}
  catch(error){$('#view').innerHTML=ph('Pressupostos por rever','Abra Pressupostos para completar ou corrigir os dados do projecto.')+alertMessage(errorText(error));}
  if(notice)$('#view').insertAdjacentHTML('afterbegin',alertMessage(notice));
  protect();
}
// Os mesmos campos e separadores do protótipo; cada projecto carrega a sua própria origem.
VIEWS.analise.after=()=>{
  for(const [id,target] of [['#anF1','#anT1'],['#anF2','#anT2']]){
    const field=$(id);if(field)field.onchange=()=>{
      if(!session.canWrite||busy||!field.files?.[0])return;
      historicalImports.get(id)?.controller.abort();
      const file=field.files[0],pdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name||'');
      const status=$('#anStatus'+id.slice(-1)),targetField=$(target),modelId=M().id;
      const pending={controller:new AbortController(),file};historicalImports.set(id,pending);
      const current=()=>historicalImports.get(id)===pending&&M()?.id===modelId&&VIEW==='analise'&&(SUB.at||'dados')==='dados'&&$(id)===field&&field.files?.[0]===file;
      const unchanged=targetField.value;
      status.textContent=pdf?'A ler o PDF…':'A ler o ficheiro…';protect();
      const done=()=>{if(historicalImports.get(id)===pending)historicalImports.delete(id);protect();};
      const failed=error=>{if(current()&&!pending.controller.signal.aborted){status.textContent=errorText(error);toast(status.textContent);}done();};
      if(file.size>(pdf?PDF_IMPORT_LIMIT:250000))return failed(Error(pdf?'O PDF admite até 10 MB.':'O balancete CSV/TXT admite até 250 000 bytes.'));
      const reader=new FileReader();reader.onerror=()=>failed(Error('Não foi possível ler o ficheiro.'));
      reader.onload=async()=>{
        try{
          if(!current())return;
          let text,summary;
          if(pdf){
            const result=await extractPdfTrialBalance(reader.result,{signal:pending.controller.signal,progress:(page,total)=>{if(current())status.textContent=`A extrair o PDF: página ${page} de ${total}…`;}});
            text=result.text;summary=`PDF: ${result.pages} página(s), ${result.accounts} contas · diferença débito − crédito: ${nf(result.difference,2)}. Confira moeda, exercício e contas; prima Analisar para guardar.`;
          }else{try{text=new TextDecoder('utf-8',{fatal:true}).decode(reader.result);}catch{text=new TextDecoder('windows-1252').decode(reader.result);}summary='Ficheiro carregado. Confira os dados e prima Analisar para guardar.';}
          if(!current())return;
          if(targetField.value!==unchanged)throw Error('O texto foi editado durante a leitura. Seleccione o ficheiro novamente para substituir esses dados.');
          targetField.value=text;historicalDirty.add(modelId);captureHistoricalDraft();status.textContent=summary;
        }catch(error){failed(error);}finally{done();}
      };reader.readAsArrayBuffer(file);
    };
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
  const model=await store.create(nm);S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);closeModal();go('pressupostos');toast('Modelo criado na base de dados.');
}
document.addEventListener('click',async ev=>{
  const target=ev.target instanceof Element?ev.target:null;if(!target)return;
  captureHistoricalDraft();
  const g=target.closest('[data-go]');if(g){ev.preventDefault();if(!busy)go(g.dataset.go);return;}
  if(target.id==='ov')return closeModal();
  const a=target.closest('[data-act]');if(!a||a.disabled||busy)return;
  const d=a.dataset,m=M();
  const actions={close:closeModal,sub:()=>{SUB[d.k]=d.v;render();},newM:__NEW_MODEL_DIALOG__,createM:createCurrent,
    dupM:async()=>{const model=await store.create({...clone(m),nome:m.nome+' (cópia)'});S.active=model.id;S.an=null;historicalDrafts.set(model.id,null);render();toast('Modelo duplicado na base de dados.');},
    addRev:()=>{m.receitas.push({nome:'Nova linha',unid:'unidades',qtd:1000,cresc:5,ramp:'100',preco:1000,esc:m.inflacao});save();render();},
    delRev:()=>{m.receitas.splice(+d.i,1);save();render();},
    addCap:()=>{m.capex.push({nome:'Novo investimento',ano:1,valor:0,vida:5});save();render();},
    delCap:()=>{m.capex.splice(+d.i,1);save();render();},
    downloadFS:()=>downloadReport('demonstracoes'),downloadReport:()=>downloadReport(SUB.rep||'sumario'),
    applyCurrency,
    anRun:analyzeAndSave,anToModel:modelFromHistorical,
    anDemo:()=>{S.an={empresa:DEMO_BAL.empresa,anos:DEMO_BAL.anos,N1:demoCSV(DEMO_BAL.N1),N:demoCSV(DEMO_BAL.N),pctCP:30,moeda:'Kz'};historicalDrafts.set(m.id,S.an);historicalDirty.add(m.id);SUB.at='dados';render();toast('Exemplo carregado. Prima Analisar se o quiser guardar neste projecto.');},
  };
  const action=actions[d.act];if(!action)return;ev.preventDefault();
  const mutation=['createM','dupM','addRev','delRev','addCap','delCap','anRun','anToModel','anDemo','applyCurrency'].includes(d.act);
  if(mutation&&!session.canWrite)return showError(Error('O seu acesso permite apenas consulta.'));
  busy=true;protect();
  try{await action();}catch(error){showError(error);}finally{busy=false;protect();}
});
$('#mSel').onchange=async()=>{
  captureHistoricalDraft();const next=$('#mSel').value;busy=true;protect();
  try{await store.flush();const model=S.models.find(m=>m.id===next);await selectHistorical(model);S.active=next;notice='';render();}catch(error){$('#mSel').value=S.active;showError(error);}finally{busy=false;protect();}
};
document.addEventListener('input',e=>{if(session?.canWrite&&M()&&historicalFields.includes(e.target?.id))historicalDirty.add(M().id);});
document.addEventListener('change',e=>{if(session?.canWrite&&M()&&historicalFields.includes(e.target?.id))historicalDirty.add(M().id);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
window.addEventListener('beforeunload',e=>{if(store?.dirty||historicalDirty.size||historicalImports.size){e.preventDefault();e.returnValue='';}});
async function boot(){
  try {
    session=JSON.parse($('#integra-session').textContent);
    store=new ModelingStore(session.canWrite,modelingRequest,showError);
    const data=await Promise.all([modelingRequest('/models'),modelingRequest('/templates')]);
    templates=data[1];store.load(data[0]);S.models=store.models;S.active=S.models[0]?.id||null;
    if(M())await selectHistorical(M());
    const view=(location.hash||'').slice(1);if(VIEWS[view])VIEW=view;
    render();
  }catch(error){$('#view').innerHTML=alertMessage(errorText(error));document.querySelectorAll('button,select').forEach(e=>e.disabled=true);}
}
boot();
