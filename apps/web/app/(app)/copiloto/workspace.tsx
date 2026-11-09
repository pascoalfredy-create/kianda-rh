'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { jsonRequest } from '@/lib/json-request';
import type { CopilotAnswer, CopilotContext, CopilotSetup } from '@/lib/copilot';

const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const figureLabels: Record<string, string> = { val: 'VAL do projecto', tirProjecto: 'TIR do projecto', tirAccionista: 'TIR do accionista', wacc: 'WACC', valorTerminalActualizado: 'Valor terminal actualizado', valorEmpresa: 'Valor da empresa', dscrMinimo: 'DSCR mínimo', llcr: 'LLCR', capexTotal: 'CAPEX total', faltaFinanciamento: 'Financiamento por cobrir', receitas: 'Receitas', ebitda: 'EBITDA', caixa: 'Caixa', fluxoLivreEmpresa: 'Fluxo livre da empresa', balancoFecha: 'O balanço fecha', caixaReconcilia: 'O fluxo de caixa reconcilia', years: 'Anos', anoHistorico: 'Exercício histórico', resultadoOperacional: 'Resultado operacional', resultadoLiquidoCalculado: 'Resultado líquido calculado', taxaImpostoPressupostaPct: 'Taxa de imposto pressuposta (%)', activo: 'Activo', passivo: 'Passivo', capitalProprioComResultado: 'Capital próprio com resultado', diferencaBalanco: 'Diferença de balanço', dividaLiquida: 'Dívida líquida', liquidezGeral: 'Liquidez geral', margemEbitda: 'Margem EBITDA', mesesReaisEncerrados: 'Meses reais encerrados', caixaMinimaOrcamento: 'Caixa mínima do orçamento' };
function value(key: string, v: number | boolean | null | number[]): string {
  if (v === null) return 'Sem resultado'; if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (Array.isArray(v)) return v.map(n => value(key === 'years' ? 'anoHistorico' : key, n)).join(' · ');
  if (key === 'anoHistorico') return String(v);
  if (['tirProjecto', 'tirAccionista', 'wacc', 'margemEbitda'].includes(key)) return `${(v * 100).toLocaleString('pt-PT', { maximumFractionDigits: 2 })}%`;
  return v.toLocaleString('pt-PT', { maximumFractionDigits: 2 });
}
interface Message { role: 'user' | 'assistant'; content: string; response?: CopilotAnswer }
export function CopilotWorkspace({ setup, initialEntity }: { setup: CopilotSetup; initialEntity: string }) {
  const [search, setSearch] = useState(''), [entity, setEntity] = useState(initialEntity), [context, setContext] = useState<CopilotContext | null>(null), [contextBusy, setContextBusy] = useState(false), [contextError, setContextError] = useState('');
  const [consent, setConsent] = useState(false), [contextConsent, setContextConsent] = useState(false), [question, setQuestion] = useState(''), [messages, setMessages] = useState<Message[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sending = useRef(false);
  useEffect(() => {
    setContext(null); setContextConsent(false); setConsent(false); setContextError(''); setMessages([]); setError('');
    if (!entity || setup.module === 'hr') return;
    let active = true; const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    setContextBusy(true);
    void fetch(`/api/v1/copilots/${setup.module}/context/${encodeURIComponent(entity)}`, { cache: 'no-store', signal: controller.signal }).then(async r => { const data = await r.json(); if (!r.ok) throw Error(data.message ?? 'Não foi possível obter o resumo.'); if (active) setContext(data); }).catch(e => { if (active) setContextError(e.name === 'AbortError' ? 'O resumo demorou demasiado. Actualize o ecrã para tentar novamente.' : e.message); }).finally(() => { clearTimeout(timeout); if (active) setContextBusy(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [entity, setup.module]);
  const filtered = setup.guides.filter(g => normalize(`${g.title} ${g.tags.join(' ')} ${g.text}`).includes(normalize(search.trim())));
  return <div style={{ minWidth: 0 }}>
    <section className="card section" aria-label="Guias especializados"><h2>Guias do módulo</h2><div style={{ padding: '0 16px 16px' }}>
      <p className="muted">Orientações disponíveis na plataforma. No RH, os cálculos referem-se ao pacote AO 2026; diplomas, regimes especiais e alterações posteriores precisam de confirmação.</p>
      <label>Pesquisar orientação<input aria-label="Pesquisar orientação do copiloto" value={search} onChange={e => setSearch(e.target.value)} placeholder="Ex.: INSS, proposta, VAL, caixa…" style={{ width: '100%', maxWidth: 520 }} /></label>
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{filtered.map(g => <details key={g.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12 }}><summary>{g.title}</summary><p style={{ marginTop: 10 }}>{g.text}</p>{g.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title} ↗</a></p>)}<a className="btn ghost sm" href={g.screen}>Abrir ecrã relacionado</a></details>)}</div>
      {!filtered.length && <p className="muted">Não foi encontrada uma orientação com esse termo. Experimente uma palavra mais simples ou escolha outro tema.</p>}
    </div></section>
    {setup.module !== 'hr' && <section className="card section" aria-label="Contexto financeiro do copiloto" style={{ marginTop: 16 }}><h2>Resumo financeiro opcional</h2><div style={{ padding: '0 16px 16px' }}>
      <p className="muted">Escolha um projecto ou análise para rever os números guardados.{setup.aiReady ? ' O envio à IA exige a sua autorização. Nomes, NIF, notas e documentos ficam fora deste resumo.' : ''}</p>
      <label>{setup.module === 'modeling' ? 'Projecto' : 'Análise'}<select aria-label="Contexto financeiro" value={entity} disabled={busy} onChange={e => { setContextBusy(false); setEntity(e.target.value); }} style={{ width: '100%', maxWidth: 520 }}><option value="">Sem dados da empresa</option>{entity && !setup.entities.some(e => e.id === entity) && <option value={entity}>Selecção da ligação do módulo</option>}{setup.entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
      <small className="muted">Mostra até 200 registos activos recentes a que tem acesso.</small>
      {contextBusy && <p role="status">A calcular o resumo guardado…</p>}{contextError && <p role="alert" className="err">{contextError}</p>}
      {context && <><details className="map-disclosure" style={{ marginTop: 12 }}><summary>Ver resumo · revisão {context.revision} · {context.unit}</summary><div style={{ overflowX: 'auto' }}><table className="dense"><tbody>{Object.entries(context.figures).map(([k, v]) => <tr key={k}><th>{figureLabels[k] ?? k}</th><td style={{ overflowWrap: 'anywhere' }}>{value(k, v)}</td></tr>)}</tbody></table></div>{context.notes.map(n => <p key={n} className="muted">{n}</p>)}</details>
      {setup.aiReady && <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}><input type="checkbox" aria-label="Autorizar resumo financeiro na IA" checked={contextConsent} disabled={!setup.aiReady || busy} onChange={e => setContextConsent(e.target.checked)} /> Autorizar o envio deste resumo financeiro nas próximas perguntas deste projecto.</label>}</>}
    </div></section>}
    {/* Sem serviço de IA activo (decisão de 09/11/2026: a IA fica de fora), a conversa não aparece; ficam os guias e o resumo. */}
    {setup.aiReady && <section className="card section" aria-label="Conversa com o copiloto" style={{ marginTop: 16 }}><h2>Conversa com IA</h2><div style={{ padding: '0 16px 16px' }}>
      {!setup.canAsk && <p className="warn">O módulo está em consulta. Os guias continuam disponíveis; a conversa com IA exige uma licença activa.</p>}
      <p className="muted">O copiloto explica e sugere passos. As decisões e alterações ficam consigo. Não tem pesquisa de legislação ou de mercado em tempo real.</p>
      <div aria-live="polite" style={{ display: 'grid', gap: 12 }}>{messages.map((m, i) => <article key={i} style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', background: m.role === 'user' ? 'var(--brand-soft)' : undefined }}><b>{m.role === 'user' ? 'A sua pergunta' : 'Resposta do copiloto · IA'}</b><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.content}</p>{m.response?.usedContext && <small>Inclui o resumo financeiro que autorizou.</small>}{!!m.response?.sources.length && <details><summary>Referências fornecidas ao copiloto</summary>{m.response.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></p>)}</details>}</article>)}</div>
      <form style={{ marginTop: 16 }} onSubmit={async e => {
        e.preventDefault(); if (sending.current || !question.trim() || !consent) return;
        sending.current = true; setBusy(true); setError('');
        const submitted = question.trim();
        try {
          const history = messages.slice(-6).map(m => ({ role: m.role, content: m.content.slice(0, 3000) }));
          const r = await jsonRequest(`/api/v1/copilots/${setup.module}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: submitted, consent, history, ...(contextConsent && context ? { context: { entityId: entity, revision: context.revision, consent: true } } : {}) }) });
          if (!r.res.ok) { setError(r.body.issues?.map((i: { message: string }) => i.message).join(' · ') || r.body.message || 'Não foi possível obter a resposta.'); return; }
          const response = r.body as CopilotAnswer;
          setMessages([...messages, { role: 'user', content: submitted }, { role: 'assistant', content: response.answer, response }]); setQuestion('');
        } finally { setBusy(false); sending.current = false; }
      }}>
        <label>Pergunta ao copiloto<textarea aria-label="Pergunta ao copiloto" value={question} onChange={e => setQuestion(e.target.value)} maxLength={1500} minLength={3} rows={4} required disabled={!setup.aiReady || !setup.canAsk || busy} style={{ width: '100%' }} /></label>
        <p className="muted">Evite dados pessoais de colaboradores ou candidatos. A conversa fica apenas neste ecrã e não é guardada no histórico da plataforma.</p>
        <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" aria-label="Autorizar envio da conversa à IA" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={!setup.aiReady || !setup.canAsk || busy} required /> Autorizo o envio da pergunta e das últimas mensagens desta conversa ao serviço de IA.</label>
        <div className="actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 12 }}><button className="btn" disabled={!setup.aiReady || !setup.canAsk || busy || !consent || (contextConsent && contextBusy)}>{busy ? 'A preparar resposta…' : 'Perguntar ao copiloto'}</button><button type="button" className="btn ghost" disabled={busy || !messages.length} onClick={() => { setMessages([]); setQuestion(''); setError(''); setConsent(false); setContextConsent(false); }}>Limpar conversa</button><Link href="/modulos" className="btn ghost">Módulos e licenças</Link></div>
        {error && <p className="err" role="alert">{error}</p>}
      </form>
    </div></section>}
  </div>;
}
