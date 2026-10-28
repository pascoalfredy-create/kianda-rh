/* Liga a interface aprovada à API. Este ficheiro é montado depois das vistas do protótipo. */
let store, session, templates = [], notice = '', busy = false;
const historicalPending = 'A análise histórica ficará disponível após a integração dos balancetes na base de dados.';
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
  for(const action of ['newM','dupM','createM','addRev','delRev','addCap','delCap'])document.querySelectorAll(`[data-act="${action}"]`).forEach(el=>{
    el.disabled=!writable||(action==='dupM'&&!M());
    if(!session?.canWrite)el.title='Acesso apenas de consulta.';
  });
  $('#mSel').disabled=busy||!S.models.length;
  $('#mSel').title=notice||'Projectos da empresa; alterações guardadas na base de dados.';
}
function render() {
  if(!session)return;
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
// As vistas históricas não usam armazenamento local ou exemplos como dados de uma empresa.
VIEWS.analise=()=>ph('Análise de demonstrações financeiras','Balancetes PGC Angola')+`<div class="alert b">${ico('info',17)}${historicalPending}</div>`;
REPS.analise.f=()=>`<div class="page">${LHM('AEF')}<h1>Relatório de análise económico-financeira</h1><div class="box">${historicalPending}</div>${FTM('Análise económico-financeira')}</div>`;
async function downloadReport(key) {
  if(key==='analise')throw Error(historicalPending);
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
  const model=await store.create(nm);S.active=model.id;closeModal();go('pressupostos');toast('Modelo criado na base de dados.');
}
document.addEventListener('click',async ev=>{
  const target=ev.target instanceof Element?ev.target:null;if(!target)return;
  const g=target.closest('[data-go]');if(g){ev.preventDefault();if(!busy)go(g.dataset.go);return;}
  if(target.id==='ov')return closeModal();
  const a=target.closest('[data-act]');if(!a||a.disabled||busy)return;
  const d=a.dataset,m=M();
  const actions={close:closeModal,sub:()=>{SUB[d.k]=d.v;render();},newM:__NEW_MODEL_DIALOG__,createM:createCurrent,
    dupM:async()=>{const model=await store.create({...clone(m),nome:m.nome+' (cópia)'});S.active=model.id;render();toast('Modelo duplicado na base de dados.');},
    addRev:()=>{m.receitas.push({nome:'Nova linha',unid:'unidades',qtd:1000,cresc:5,ramp:'100',preco:1000,esc:m.inflacao});save();render();},
    delRev:()=>{m.receitas.splice(+d.i,1);save();render();},
    addCap:()=>{m.capex.push({nome:'Novo investimento',ano:1,valor:0,vida:5});save();render();},
    delCap:()=>{m.capex.splice(+d.i,1);save();render();},
    downloadFS:()=>downloadReport('demonstracoes'),downloadReport:()=>downloadReport(SUB.rep||'sumario'),
  };
  const action=actions[d.act];if(!action)return;ev.preventDefault();
  const mutation=['createM','dupM','addRev','delRev','addCap','delCap'].includes(d.act);
  if(mutation&&!session.canWrite)return showError(Error('O seu acesso permite apenas consulta.'));
  busy=true;protect();
  try{await action();}catch(error){showError(error);}finally{busy=false;protect();}
});
$('#mSel').onchange=async()=>{
  const next=$('#mSel').value;busy=true;protect();
  try{await store.flush();S.active=next;notice='';render();}catch(error){$('#mSel').value=S.active;showError(error);}finally{busy=false;protect();}
};
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
window.addEventListener('beforeunload',e=>{if(store?.dirty){e.preventDefault();e.returnValue='';}});
async function boot(){
  try {
    session=JSON.parse($('#integra-session').textContent);
    store=new ModelingStore(session.canWrite,modelingRequest,showError);
    const data=await Promise.all([modelingRequest('/models'),modelingRequest('/templates')]);
    templates=data[1];store.load(data[0]);S.models=store.models;S.active=S.models[0]?.id||null;
    const view=(location.hash||'').slice(1);if(VIEWS[view])VIEW=view;
    render();
  }catch(error){$('#view').innerHTML=alertMessage(errorText(error));document.querySelectorAll('button,select').forEach(e=>e.disabled=true);}
}
boot();
