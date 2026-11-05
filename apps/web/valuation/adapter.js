/* ================= KIANDA VALORA: ligação à plataforma =================
 * Junta-se ao protótipo aprovado no mesmo âmbito (acesso a D, UI, EX, compute, route, renderView…).
 * Dados por empresa no servidor, com revisões; nada da análise fica no armazenamento local do navegador.
 */
const VS=(()=>{try{return JSON.parse(document.getElementById('valora-session').textContent)}catch(e){return null}})();
let CUR=null,LIST=VS?VS.analyses:[],USAGE=VS?VS.usage:null;
let saveTimer=null,saving=null,pendingSave=false,conflict=false,offline=false;
const ESC=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLbl=s=>{try{return new Date(s).toLocaleDateString('pt-PT',{day:'2-digit',month:'2-digit',year:'numeric'})}catch(e){return ''}};

function valoraCanWrite(){return !!VS&&VS.canWrite&&!!CUR&&!CUR.archivedAt&&!conflict}
function valoraIssue(x){return valuationDataIssue(x)}
function valoraFechoLabel(){return D.fecho?`Fecho: ${MES[D.fecho-1]} ${EX}`:`Sem meses reais · ${EX}`}
document.querySelector('#valoraCopilot')?.addEventListener('click',async e=>{e.preventDefault();try{await ensureSaved();location.assign('/copiloto?modulo=valuation'+(CUR?.id?'&projecto='+encodeURIComponent(CUR.id):''))}catch(error){banner('err',ESC(error.message))}});

/* ---------- Pedidos à API ---------- */
async function api(path,opt={}){
  let res;
  try{res=await fetch('/api/v1/valuation'+path,{method:opt.method||'GET',credentials:'same-origin',cache:'no-store',headers:opt.body?{'content-type':'application/json'}:{},body:opt.body?JSON.stringify(opt.body):undefined,signal:AbortSignal.timeout(30000)})}
  catch(e){const err=new Error('Sem ligação ao servidor. Verifique a rede e tente de novo.');err.offline=true;throw err}
  const data=await res.json().catch(()=>null);
  if(res.status===401){location.replace('/login?voltar=/valora');throw new Error('A sessão terminou.')}
  if(!res.ok){const err=new Error(data?.message||data?.issues?.[0]?.message||`Pedido recusado (${res.status}).`);err.status=res.status;err.code=data?.error;err.data=data;throw err}
  return data;
}

/* ---------- Estado de gravação e avisos ---------- */
function setSave(text,err=false){const el=$('#valoraSave');if(!el)return;el.textContent=text;el.classList.toggle('err',err)}
function banner(kind,html,action){
  const el=$('#valoraBanner');if(!kind){el.hidden=true;el.innerHTML='';return}
  el.className='valora-banner '+kind;el.hidden=false;el.innerHTML=`<span>${html}</span>${action?`<button type="button" class="btn" id="valoraBannerAct">${ESC(action[0])}</button>`:''}`;
  if(action)$('#valoraBannerAct').onclick=action[1];
}
function valoraPersist(){
  if(!valoraCanWrite())return;
  pendingSave=true;setSave('Alterações por gravar…');
  clearTimeout(saveTimer);saveTimer=setTimeout(flushSave,900);
}
async function flushSave(){
  clearTimeout(saveTimer);
  if(saving){await saving.catch(()=>{});if(!pendingSave)return;}
  if(!pendingSave||!CUR||!valoraCanWrite())return;
  pendingSave=false;
  const id=CUR.id,snapshot=JSON.parse(JSON.stringify(D)),issue=valuationDataIssue(snapshot);
  if(issue){pendingSave=true;setSave(issue,true);return}
  setSave('A gravar…');
  saving=api('/analyses/'+encodeURIComponent(id),{method:'PUT',body:{revision:CUR.revision,data:snapshot}}).then(r=>{
    if(CUR&&CUR.id===id){CUR.revision=r.revision;CUR.updatedAt=r.updatedAt}
    const item=LIST.find(x=>x.id===id);if(item){item.revision=r.revision;item.updatedAt=r.updatedAt}
    offline=false;setSave(pendingSave?'Alterações por gravar…':'Gravado');
  }).catch(e=>{
    pendingSave=true;
    if(e.status===409&&e.code==='revisao_invalida'){conflict=true;lockInputs();setSave('Não gravado',true);banner('err','Esta análise foi alterada noutra sessão. As alterações feitas aqui depois disso não foram gravadas.',['Recarregar a versão gravada',()=>{if(confirm('Recarregar a versão gravada e descartar as alterações locais?'))openAnalysis(id,true)}])}
    else if(e.offline){pendingSave=true;offline=true;setSave('Sem ligação — a tentar de novo',true);setTimeout(()=>{offline=false;flushSave()},5000)}
    else if(e.status===402){VS.canWrite=false;lockInputs();setSave('Não gravado',true);banner('warn',ESC(e.message)+' <a href="/modulos">Ver licença</a>')}
    else{pendingSave=true;setSave(e.message,true)}
  }).finally(()=>{saving=null;if(pendingSave&&!conflict&&!offline&&valoraCanWrite())saveTimer=setTimeout(flushSave,900)});
  return saving;
}
async function ensureSaved(){
  await flushSave();
  if(pendingSave||saving||conflict||offline)throw new Error('Existem alterações por gravar. Mantenha esta análise aberta e volte a tentar antes de continuar.');
}
addEventListener('beforeunload',e=>{if(pendingSave||saving){e.preventDefault();e.returnValue=''}});

/* ---------- Consulta: bloqueia campos que alteram a análise ---------- */
const KEEP='[data-rp],[data-rep],[data-exp],.tabs button,#ctlPer,[data-t],#valoraFirst';
function lockInputs(){
  const ro=!valoraCanWrite();document.body.classList.toggle('valora-readonly',ro);
  if(!ro)return;
  document.querySelectorAll('.wrap input,.wrap select,.wrap textarea,.wrap button').forEach(el=>{if(!el.matches(KEEP))el.disabled=true});
}
new MutationObserver(()=>{if(!valoraCanWrite())lockInputs()}).observe(document.querySelector('.wrap'),{childList:true,subtree:true});
{const original=renderView;renderView=function(v){if(!D)return;original(v);prepareMapDisclosures(document.querySelector('.wrap'),v)}}

/* ---------- Abrir uma análise ---------- */
function syncYears(){
  document.querySelectorAll('.valora-ex').forEach(el=>el.textContent=EX);
  const y=D.years;$('#valoraRevYears').textContent=`Kz · ${y[0]}–${y[y.length-1]} real, ${EX} previsão, ${EX+1}–${EX+4} projecção DCF`;
  TITLES.orcamento[1]='Orçamento '+EX;
}
function loadAnalysis(row){
  CUR={id:row.id,name:row.name,revision:row.revision,ownCompany:row.ownCompany,archivedAt:row.archivedAt,updatedAt:row.updatedAt};
  conflict=false;pendingSave=false;offline=false;
  D=row.data;EX=D.ex??(D.years[D.years.length-1]+1);D.ex=EX;
  if(!D.bal.reservas)deriveHistReserves();meta();
  document.body.classList.remove('valora-none');$('#valoraEmpty')?.remove();
  $('#valoraFoot').textContent=row.ownCompany?'Própria empresa · ':'';
  syncYears();compute();route();
  setSave(VS.canWrite?'Gravado':'');
  if(CUR.archivedAt)banner('warn','Análise arquivada: disponível só para consulta. Restaure-a em «Análises» para a alterar.',VS.canWrite?['Análises',()=>openDialog()]:null);
  else if(VS.permission!=='editor')banner('warn','O seu acesso ao Valora é de consulta.');
  else if(!VS.canWrite)banner('warn','Módulo em consulta: os dados e a pré-visualização continuam disponíveis; para alterar ou exportar, regularize a licença. <a href="/modulos">Ver licença</a>');
  else banner(null);
  lockInputs();
}
async function openAnalysis(id,discard=false){
  if(!discard){try{await ensureSaved()}catch(e){setSave(e.message,true);banner('err',ESC(e.message));return}}
  setSave('A abrir…');
  try{loadAnalysis(await api('/analyses/'+encodeURIComponent(id)));closeDialog()}catch(e){setSave(e.message,true)}
}
function showEmpty(){
  D=undefined;CUR=null;document.body.classList.add('valora-none');banner(null);
  $('#hdrEnt').textContent=VS?VS.company.name:'Valora';$('#pillFecho').textContent='Sem análise';$('#crumb').textContent='Valora';$('#title').textContent='Análise financeira e avaliação';
  if(!$('#valoraEmpty'))$('.wrap').insertAdjacentHTML('afterbegin',`<div class="card valora-empty" id="valoraEmpty"><h3>Comece pela primeira análise</h3>
    <p class="intro" style="margin:8px 0 14px">Cada análise reúne o histórico de uma entidade (a própria empresa, uma participada ou um alvo de aquisição), o orçamento e a tesouraria do exercício, os dados reais mensais e a avaliação por fluxos descontados, múltiplos e activos.</p>
    ${VS&&VS.canWrite?'<button class="btn pri" type="button" id="valoraFirst">Criar análise</button>':'<p class="hint">Ainda não há análises nesta empresa.</p>'}</div>`);
  $('#valoraFirst')&&($('#valoraFirst').onclick=()=>openDialog());
  setSave('');
}

/* ---------- Diálogo «Análises» ---------- */
const dlg=$('#valoraDialog');
function closeDialog(){dlg.classList.remove('on')}
dlg.addEventListener('click',e=>{if(e.target===dlg)closeDialog()});
addEventListener('keydown',e=>{if(e.key==='Escape'&&dlg.classList.contains('on'))closeDialog()});
function exampleData(entity){
  const keepD=D,keepEX=EX,keepCache=CACHE;
  try{D=clone(SAMPLE);EX=2026;D.ex=2026;deriveHistReserves();D.real=genReal();D.meta={ent:entity,prep:'Direcção Financeira',dest:'Conselho de Administração',nif:''};D.rnotes={};return D}
  finally{D=keepD;EX=keepEX;CACHE=keepCache}
}
function usageText(){
  if(!USAGE)return '';const lim=USAGE.analysisLimit;
  const held=USAGE.heldArchived?` (inclui ${USAGE.heldArchived} restaurada${USAGE.heldArchived===1?'':'s'} e arquivada${USAGE.heldArchived===1?'':'s'} este mês, que ocupa${USAGE.heldArchived===1?'':'m'} a vaga até ao fim do mês)`:'';
  return `${USAGE.activeAnalyses} ${lim===null?'análises activas (sem limite)':`de ${lim} vagas de análise`}${held} · ${USAGE.enabledUsers} de ${USAGE.userLimit} utilizadores`;
}
function openDialog(msg){
  const write=!!VS&&VS.canWrite,active=LIST.filter(x=>!x.archivedAt),archived=LIST.filter(x=>x.archivedAt);
  const thisYear=new Date().getFullYear();
  const item=x=>`<li><div class="grow"><b>${ESC(x.name)}</b><span class="hint">Actualizada em ${dateLbl(x.updatedAt)}${x.ownCompany?' · própria empresa':''}</span></div>${CUR&&CUR.id===x.id?'<span class="on">Aberta</span>':`<button class="btn" type="button" data-vopen="${ESC(x.id)}">Abrir</button>`}</li>`;
  const cur=CUR&&!CUR.archivedAt?CUR:null;
  $('#valoraDialogBox').innerHTML=`<div style="display:flex;align-items:flex-start;gap:10px"><div style="flex:1"><h3 id="valoraDialogTitle" style="margin:0">Análises</h3><p class="hint" style="margin:4px 0 0">${ESC(usageText())}</p></div><button class="btn" type="button" id="valoraClose" aria-label="Fechar">Fechar</button></div>
  ${msg?`<div class="note" role="alert">${msg}</div>`:''}
  <div class="valora-section"><h4>Activas</h4>${active.length?`<ul class="valora-list">${active.map(item).join('')}</ul>`:'<p class="hint">Nenhuma análise activa.</p>'}</div>
  ${cur&&write?`<div class="valora-section"><h4>Análise aberta</h4><div class="valora-form">
    <label class="wide">Nome<input type="text" id="vRename" maxlength="200" value="${ESC(cur.name)}"></label>
    <label class="check wide"><input type="checkbox" id="vOwn" ${cur.ownCompany?'checked':''}> É a nossa própria empresa (permite trazer os custos com o pessoal do RH)</label></div>
    <div class="row-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn" type="button" id="vSaveMeta">Guardar nome</button><button class="btn" type="button" id="vDup">Duplicar</button>
    ${cur.ownCompany&&VS.hr.available?'<button class="btn" type="button" id="vHr">Trazer custos com o pessoal (72) do RH</button>':''}
    <button class="btn" type="button" id="vJson">Descarregar cópia (JSON)</button><button class="btn" type="button" id="vArchive">Arquivar</button></div></div>`:''}
  ${write?`<div class="valora-section"><h4>Nova análise</h4><div class="valora-form">
    <label>Nome da análise<input type="text" id="vName" maxlength="200" placeholder="Ex.: Orçamento e avaliação ${thisYear}"></label>
    <label>Entidade analisada<input type="text" id="vEnt" maxlength="200" placeholder="Ex.: ${ESC(VS.company.name)}"></label>
    <label>Último exercício encerrado<input type="number" id="vYear" min="1990" max="2099" value="${thisYear-1}"></label>
    <label>Exercícios encerrados no histórico<select id="vYears">${[2,3,4,5].map(n=>`<option ${n===3?'selected':''}>${n}</option>`).join('')}</select></label>
    <label class="wide">Ponto de partida<select id="vStart"><option value="blank">Em branco — introduzir o histórico, o orçamento e os dados reais</option><option value="example">Exemplo ilustrativo (distribuidora fictícia, 2021–2026)</option></select></label>
    <label class="check wide"><input type="checkbox" id="vNewOwn" ${LIST.some(x=>x.ownCompany&&!x.archivedAt)?'':'checked'}> É a nossa própria empresa</label></div>
    <div class="row-actions" style="justify-content:flex-start;flex-wrap:wrap"><button class="btn pri" type="button" id="vCreate" ${USAGE&&!USAGE.canCreateAnalysis?'disabled':''}>Criar análise</button>
    <label class="btn" style="display:inline-flex;align-items:center;gap:6px">Importar cópia (JSON)<input type="file" id="vImport" accept="application/json,.json" style="display:none"></label></div>
    ${USAGE&&!USAGE.canCreateAnalysis?'<p class="hint">Atingiu o número de análises activas da licença. Arquive uma análise ou mude de plano em <a href="/licenca#valuation">Módulos e licenças</a>.</p>':''}</div>`:''}
  ${archived.length?`<div class="valora-section"><h4>Arquivadas</h4><ul class="valora-list">${archived.map(x=>`<li><div class="grow"><b>${ESC(x.name)}</b><span class="hint">Arquivada em ${dateLbl(x.archivedAt)}</span></div><button class="btn" type="button" data-vopen="${ESC(x.id)}">Consultar</button>${write?`<button class="btn" type="button" data-vrestore="${ESC(x.id)}">Restaurar</button>`:''}</li>`).join('')}</ul></div>`:''}`;
  dlg.classList.add('on');
  $('#valoraClose').onclick=closeDialog;
  ($('#vName')||$('#valoraClose')).focus();
}
async function createAnalysis(name,data,ownCompany,source){
  await ensureSaved();
  const row=await api('/analyses',{method:'POST',body:{name,data,ownCompany,source}});
  LIST.unshift({id:row.id,name:row.name,ownCompany:row.ownCompany,revision:row.revision,archivedAt:null,updatedAt:row.updatedAt,createdAt:row.createdAt});
  USAGE.activeAnalyses++;USAGE.canCreateAnalysis=USAGE.analysisLimit===null||USAGE.activeAnalyses<USAGE.analysisLimit;
  loadAnalysis(row);closeDialog();
}
async function dialogAction(fn){try{await fn()}catch(e){openDialog(ESC(e.message))}}
dlg.addEventListener('click',e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.vopen)return openAnalysis(t.dataset.vopen);
  if(t.dataset.vrestore)return dialogAction(async()=>{const r=await api(`/analyses/${encodeURIComponent(t.dataset.vrestore)}/restore`,{method:'POST'});Object.assign(LIST.find(x=>x.id=== r.id),r);if(r.usage)USAGE=r.usage;await openAnalysis(r.id)});
  if(t.id==='vCreate')return dialogAction(async()=>{
    const ent=$('#vEnt').value.trim()||VS.company.name,name=$('#vName').value.trim()||ent,year=Number($('#vYear').value),start=$('#vStart').value;
    if(!Number.isInteger(year)||year<1990||year>2099)throw new Error('Indique o último exercício encerrado (ano entre 1990 e 2099).');
    const data=start==='example'?exampleData(ent):blankValuationData({entity:ent,lastClosedYear:year,historyYears:Number($('#vYears').value)});
    await createAnalysis(name,data,$('#vNewOwn').checked,start);
  });
  if(t.id==='vDup')return dialogAction(async()=>{await ensureSaved();await createAnalysis(`${CUR.name} (cópia)`.slice(0,200),JSON.parse(JSON.stringify(D)),CUR.ownCompany,'duplicate')});
  if(t.id==='vSaveMeta')return dialogAction(async()=>{
    await ensureSaved();const name=$('#vRename').value.trim(),own=$('#vOwn').checked;
    const r=await api('/analyses/'+encodeURIComponent(CUR.id),{method:'PUT',body:{revision:CUR.revision,name,ownCompany:own}});
    Object.assign(CUR,{name:r.name,ownCompany:r.ownCompany,revision:r.revision});Object.assign(LIST.find(x=>x.id===CUR.id),{name:r.name,ownCompany:r.ownCompany,revision:r.revision,updatedAt:r.updatedAt});
    $('#valoraFoot').textContent=r.ownCompany?'Própria empresa · ':'';openDialog('Alterações guardadas.');
  });
  if(t.id==='vArchive')return dialogAction(async()=>{
    if(!confirmArchive())return;await ensureSaved();
    const r=await api(`/analyses/${encodeURIComponent(CUR.id)}/archive`,{method:'POST'});Object.assign(LIST.find(x=>x.id===r.id),r);if(r.usage)USAGE=r.usage;
    const next=LIST.find(x=>!x.archivedAt);if(next)await openAnalysis(next.id);else{showEmpty();openDialog()}
  });
  if(t.id==='vHr')return dialogAction(async()=>{
    await ensureSaved();const r=await api(`/analyses/${encodeURIComponent(CUR.id)}/import-personnel`,{method:'POST',body:{revision:CUR.revision}});
    loadAnalysis(r.analysis);const after=r.months.filter(m=>m.month>=D.fecho);
    openDialog(`Custos com o pessoal de ${r.year} trazidos do processamento salarial: ${r.months.map(m=>`${MES[m.month]} ${f0(m.mkz)} Kz`).join(' · ')}.${after.length?` ${after.length===1?'Um mês fica':after.length+' meses ficam'} depois do mês de fecho e só entra${after.length===1?'':'m'} no cenário «Real» quando avançar o fecho.`:''}`);
  });
  if(t.id==='vJson'){valoraDownload(`${(CUR.name||'analise').replace(/[^\wÀ-ú-]+/g,'_')}.json`,new Blob([JSON.stringify({kianda:'valora',name:CUR.name,data:D},null,1)],{type:'application/json'}));return}
});
let archiveArmed=0;
function confirmArchive(){const now=Date.now();if(now-archiveArmed<4000)return true;archiveArmed=now;const b=$('#vArchive');if(b)b.textContent='Confirmar arquivo';return false}
dlg.addEventListener('change',e=>{
  if(e.target.id!=='vImport')return;const file=e.target.files[0];if(!file)return;
  dialogAction(async()=>{
    if(file.size>1_500_000)throw new Error('O ficheiro excede o tamanho máximo (1,5 MB).');
    let parsed;try{parsed=JSON.parse(await file.text())}catch(err){throw new Error('O ficheiro não é um JSON válido.')}
    const data=parsed&&parsed.kianda==='valora'?parsed.data:parsed,issue=valuationDataIssue(data);
    if(issue)throw new Error('Cópia não reconhecida: '+issue);
    await createAnalysis(String(parsed.name||data.meta?.ent||'Análise importada').slice(0,200),data,false,'file');
  });
});
$('#btnAnalyses').onclick=()=>openDialog();
$('#btnEntity').onclick=()=>openDialog();

/* ---------- Exportação: licença, bibliotecas locais e descarga ---------- */
async function valoraCanExport(kind){
  const msg=$('#rep-msg');
  try{
    await ensureSaved();
    const current=await api('/session');
    VS.formats=current.formats;VS.canWrite=current.canWrite;lockInputs();
    if(current.formats&&current.formats[kind])return true;
    if(msg)msg.textContent='Pré-visualização: active uma subscrição paga do Valora para exportar documentos.';
  }catch(e){if(msg)msg.textContent=e.message;return false}
  return false;
}
function valoraApplyAutoTable(){const J=window.jspdf&&window.jspdf.jsPDF;if(J&&!J.API.autoTable&&typeof window.applyPlugin==='function')window.applyPlugin(J)}
/** O Chromium ignora nomes de ficheiro com acentos em descargas locais (fica «download»): nome em ASCII. */
function valoraFileName(name){return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w.\-]+/g,'_').replace(/_+/g,'_')||'Valora'}
function valoraDownload(name,data){
  name=valoraFileName(name);
  const type=name.endsWith('.pdf')?'application/pdf':name.endsWith('.docx')?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/octet-stream';
  const blob=data instanceof Blob?data:new Blob([data],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  const msg=$('#rep-msg');if(msg)msg.textContent='Ficheiro descarregado: '+name;
}

/* ---------- Menu no telemóvel e fim de sessão ---------- */
$('#valoraMenu').onclick=()=>{const a=document.querySelector('aside'),open=!a.classList.contains('open');a.classList.toggle('open',open);$('#valoraMenu').setAttribute('aria-expanded',String(open))};
/* Menu recolhível por grupos, como no RH e no Integra: só o grupo do ecrã actual fica aberto; um toque abre outro e fecha o anterior. */
(function groupNav(){
  const nav=$('#nav');if(!nav||nav.querySelector('.nav-group'))return;
  const groups=[];let cur=null;
  for(const el of [...nav.children]){
    if(el.classList.contains('navlbl')){cur={label:el.textContent.trim(),items:[]};groups.push(cur);el.remove();}
    else if(cur&&el.tagName==='A')cur.items.push(el);
  }
  groups.forEach((g,i)=>{
    const sec=document.createElement('section');sec.className='nav-group';
    const btn=document.createElement('button');btn.type='button';btn.className='nav-group-toggle';btn.setAttribute('aria-controls','valora-nav-'+i);btn.setAttribute('aria-expanded','false');
    btn.innerHTML=`<span>${ESC(g.label)}</span><span class="nav-chevron" aria-hidden="true">⌄</span>`;
    const box=document.createElement('div');box.id='valora-nav-'+i;box.hidden=true;g.items.forEach(a=>box.appendChild(a));
    btn.onclick=()=>{const open=btn.getAttribute('aria-expanded')!=='true';nav.querySelectorAll('.nav-group').forEach(x=>setGroup(x,false));setGroup(sec,open);};
    sec.append(btn,box);nav.appendChild(sec);
  });
  function setGroup(sec,open){sec.querySelector('.nav-group-toggle').setAttribute('aria-expanded',String(open));sec.querySelector('div').hidden=!open;}
  function sync(){const on=nav.querySelector('a.on')||nav.querySelector('a');nav.querySelectorAll('.nav-group').forEach(x=>setGroup(x,x.contains(on)));}
  sync();
  nav.addEventListener('click',e=>{if(e.target.closest('a'))setTimeout(sync,0)});
  window.addEventListener('hashchange',()=>setTimeout(sync,0));
})();
$('#nav').addEventListener('click',e=>{if(e.target.closest('a')){document.querySelector('aside').classList.remove('open');$('#valoraMenu').setAttribute('aria-expanded','false')}});
for(const id of ['#valoraLogout','#valoraLogoutTop'])$(id).onclick=async()=>{const b=$(id);b.disabled=true;b.textContent='A terminar…';try{await ensureSaved()}catch(e){if(!confirm('Existem alterações não gravadas. Terminar sessão e descartá-las?')){b.disabled=false;b.textContent='Terminar sessão';banner('err',ESC(e.message));return}clearTimeout(saveTimer);pendingSave=false}try{await endSession()}catch(e){b.disabled=false;b.textContent='Terminar sessão';banner('err',ESC(e.message))}};
reloadPrivatePageOnRestore();

function valoraStart(){
  if(!VS){document.body.classList.add('valora-none');return}
  if(VS.current)loadAnalysis(VS.current);else showEmpty();
}
try{setupNumberFields(document);}catch{}
valoraStart();
