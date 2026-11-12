/* A prévia, a leitura assíncrona e o desfazer pertencem à análise aberta. */
let balanceReadId = 0;
let balanceFile = null;
let balanceRows = null;
let balancePreview = null;
let balanceUndo = null;
let balanceApplying = false;
const importPane = () => $('#imp-prev');
const cancelBalanceButton = '<button type="button" class="btn" id="btnCancelImp">Cancelar</button>';

function resetBalanceImport(forgetUndo = false) {
  balanceReadId++;
  balanceFile = balanceRows = balancePreview = null;
  $('#file').value = '';
  $('#paste').value = '';
  $('#impSheet').hidden = true;
  $('#impErp').hidden = true;
  $('#impMonth').value = '';
  $('#impErpMonthly').checked = false;
  importPane().innerHTML = '';
  if (forgetUndo) balanceUndo = null;
}

function balanceError(message) {
  balancePreview = null;
  importPane().innerHTML = `<div class="note" role="alert" style="border-color:var(--crit)">${esc(message)} ${cancelBalanceButton}</div>`;
}

function showBalancePreview() {
  if (!balanceRows || !valoraCanWrite()) return;
  $('#impErp').hidden = !isErpBalance(balanceRows);
  const res = parseBalance(balanceRows, {
    unit: $('#impUnit').value, signed: $('#signConv').checked, cumulative: $('#impCum').checked, year: EX,
    erpMonth: Number($('#impMonth').value), erpMonthly: $('#impErpMonthly').checked,
  });
  if (res.error) return balanceError(res.error);
  balancePreview = { analysis: CUR, result: res };
  let nextClose = D.fecho;
  while (res.months.includes(nextClose)) nextClose++;
  const byRubric = Object.entries(res.acc).map(([k, v]) => `<tr><td><span class="code">${LBL[k][0]}</span>${LBL[k][1]}</td>${res.months.map(m => `<td class="num">${v[m] == null ? '—' : f0(v[m])}</td>`).join('')}</tr>`).join('');
  const movements = res.lines.flatMap(line => (line.movements ?? []).map(m => `<tr><td>${esc(line.code)}</td><td>${MES[m.month]}</td><td class="num">${f0(m.previous)}</td><td class="num">${f0(m.current)}</td><td class="num">${f0(m.movement)}</td></tr>`));
  const bad = res.control.filter(c => c.differenceKz != null && Math.abs(c.differenceKz) >= .01);
  const control = `<tr><td>Resultado do mês</td>${res.control.map(c => `<td class="num">${f0(c.resultKz / 1e6)}</td>`).join('')}</tr>
    <tr><td>Diferença de balanço</td>${res.control.map(c => `<td class="num">${c.differenceKz == null ? 'Não apurada' : f0(c.differenceKz / 1e6)}</td>`).join('')}</tr>`;
  importPane().innerHTML = `<h3 class="mt" style="font-size:13px">Pré-visualização — ${res.lines.length} contas mapeadas, ${res.ignored.length} ignoradas · valores em Kz</h3>
    <div class="tbl-scroll"><table><thead><tr><th>Rubrica</th>${res.months.map(m => `<th>${MES[m]}</th>`).join('')}</tr></thead><tbody>${byRubric}<tr class="sec"><td colspan="${res.months.length + 1}">Controlo antes de aplicar</td></tr>${control}</tbody></table></div>
    ${bad.length ? `<div class="note" style="border-color:var(--warn)">O balanço importado não fecha em ${bad.map(c => MES[c.month]).join(', ')}. Confirme as contas e os sinais antes de aplicar.</div>` : ''}
    ${movements.length ? `<details><summary>Como foram calculados os movimentos do mês</summary><p class="hint">Valores em Kz com os sinais do ficheiro de origem, antes da classificação por rubrica.</p><div class="tbl-scroll"><table><thead><tr><th>Conta</th><th>Mês</th><th>Acumulado anterior</th><th>Acumulado actual</th><th>Diferença</th></tr></thead><tbody>${movements.join('')}</tbody></table></div></details>` : ''}
    ${res.warnings.map(w => `<p class="hint">${esc(w)}</p>`).join('')}
    ${res.ignored.length ? `<p class="hint">Contas e linhas ignoradas: ${esc(res.ignored.slice(0, 12).join(' · '))}${res.ignored.length > 12 ? ' …' : ''}</p>` : ''}
    <label class="hint">Rubricas dos meses importados <select id="impMode" class="sel"><option value="merge">Completar a grelha</option><option value="replace">Substituir todas as rubricas desses meses</option></select></label>
    ${nextClose > D.fecho ? `<label class="hint"><input type="checkbox" id="impFecho" checked> Actualizar o mês de fecho para ${MES[nextClose - 1]}</label>` : ''}
    <div class="row-actions" style="justify-content:flex-start"><button type="button" class="btn pri" id="btnApply">Aplicar importação</button>${cancelBalanceButton}</div>`;
}

async function readBalanceFile(file, sheet = 0, newFile = true) {
  if (!file || !valoraCanWrite()) return;
  if (newFile) {
    $('#paste').value = '';
    $('#impSheet').hidden = true;
    $('#impMonth').value = '';
    $('#impErpMonthly').checked = false;
  }
  const request = ++balanceReadId, analysis = CUR;
  balanceFile = file;
  balanceRows = balancePreview = null;
  importPane().innerHTML = `<div class="note" role="status">A ler o ficheiro… ${cancelBalanceButton}</div>`;
  try {
    const doc = await readBalanceDocument(file, sheet);
    if (request !== balanceReadId || CUR !== analysis) return;
    const multi = doc.sheets.length > 1;
    $('#impSheet').hidden = !multi;
    if (multi) $('#impSheetSel').innerHTML = doc.sheets.map((name, i) => `<option value="${i}"${i === sheet ? ' selected' : ''}>${esc(name)}</option>`).join('');
    balanceRows = doc.rows;
    showBalancePreview();
  } catch (error) {
    if (request === balanceReadId && CUR === analysis) balanceError(error.message);
  }
}

async function applyBalancePreview() {
  const preview = balancePreview;
  if (!preview || balanceApplying || preview.analysis !== CUR || !valoraCanWrite()) return;
  balanceApplying = true;
  try {
    // Grava alterações anteriores para a versão de segurança ser a imediatamente anterior ao ficheiro.
    await ensureSaved();
    if (preview !== balancePreview || preview.analysis !== CUR || !valoraCanWrite()) return;
    const { acc, months, lines } = preview.result, replace = $('#impMode').value === 'replace';
    const cells = [];
    for (const [key, row] of Object.entries(D.real)) for (const month of months) {
      const value = acc[key]?.[month];
      if (value === undefined && !replace) continue;
      const before = row[month], after = value ?? null;
      if (before !== after) cells.push({ key, month, before, after });
    }
    const beforeClose = D.fecho;
    let afterClose = beforeClose;
    if ($('#impFecho')?.checked) while (months.includes(afterClose)) afterClose++;
    if (!cells.length && beforeClose === afterClose) {
      resetBalanceImport();
      importPane().textContent = 'Os dados do ficheiro já constam da grelha.';
      return;
    }
    const affectedMonths = [...new Set(cells.filter(c => c.before != null).map(c => c.month))];
    if (affectedMonths.length && !confirm(`Esta importação altera valores já preenchidos em ${affectedMonths.map(m => MES[m]).join(', ')}. Aplicar as alterações?`)) return;
    for (const cell of cells) D.real[cell.key][cell.month] = cell.after;
    D.fecho = afterClose;
    balanceUndo = { analysis: CUR, cells, beforeClose, afterClose };
    resetBalanceImport();
    balanceCheckpoint = true;
    refresh();
    importPane().innerHTML = `<div class="note">Importação aplicada: ${lines.length} contas, ao cêntimo. <button type="button" class="btn" id="btnUndoImp">Desfazer importação</button></div>`;
  } catch (error) {
    if (preview.analysis === CUR && preview === balancePreview) banner('err', ESC(error.message));
  } finally {
    balanceApplying = false;
  }
}

function undoBalanceImport() {
  const undo = balanceUndo;
  if (!undo || undo.analysis !== CUR || !valoraCanWrite()) return;
  const changedClose = undo.beforeClose !== undo.afterClose;
  if ((changedClose && D.fecho !== undo.afterClose) || undo.cells.some(c => D.real[c.key][c.month] !== c.after)) {
    importPane().textContent = 'A grelha importada foi entretanto editada. Reveja a versão anterior em «Análises».';
    return;
  }
  for (const cell of undo.cells) D.real[cell.key][cell.month] = cell.before;
  if (changedClose) D.fecho = undo.beforeClose;
  balanceUndo = null;
  refresh();
  importPane().textContent = 'Importação desfeita. As rubricas e o mês de fecho afectados foram repostos.';
}

$('#file').addEventListener('change', e => { void readBalanceFile(e.target.files[0]); });
$('#paste').addEventListener('input', () => {
  if (!balanceRows || balanceFile) return;
  balanceRows = balancePreview = null;
  $('#impErp').hidden = true;
  importPane().innerHTML = '';
});
$('#impSheetSel').addEventListener('change', e => { void readBalanceFile(balanceFile, Number(e.target.value), false); });
for (const id of ['impUnit', 'impCum', 'signConv', 'impMonth', 'impErpMonthly']) $('#' + id).addEventListener('change', showBalancePreview);
const balanceDrop = $('#drop');
for (const ev of ['dragover', 'dragenter']) balanceDrop.addEventListener(ev, e => { e.preventDefault(); balanceDrop.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) balanceDrop.addEventListener(ev, e => { e.preventDefault(); balanceDrop.classList.remove('over'); });
balanceDrop.addEventListener('drop', e => { void readBalanceFile(e.dataTransfer.files[0]); });
$('#btnParse').addEventListener('click', () => {
  if (!valoraCanWrite()) return;
  const text = $('#paste').value.trim();
  resetBalanceImport();
  $('#paste').value = text;
  if (!text) return balanceError('Cole o conteúdo ou escolha um ficheiro.');
  balanceRows = splitCSV(text);
  showBalancePreview();
});
importPane().addEventListener('click', e => {
  if (e.target.id === 'btnCancelImp') resetBalanceImport();
  if (e.target.id === 'btnApply') void applyBalancePreview();
  if (e.target.id === 'btnUndoImp') undoBalanceImport();
});
