import { luandaDate, type PlatformModule } from '@kianda/core';
import { DomainError } from './payroll.js';
import { COPILOT_KNOWLEDGE_VERSION, expertInstructions, retrieveExpertGuides } from './copilot-knowledge.js';
import type { CopilotFinancialContext } from './copilot-context.js';

export function copilotAiConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim(), model = process.env.KIANDA_AI_MODEL?.trim();
  return process.env.KIANDA_COPILOT_AI_ENABLED === 'true' && apiKey && model ? { apiKey, model } : null;
}
export function copilotDailyLimit() {
  const n = Number(process.env.KIANDA_COPILOT_DAILY_LIMIT ?? 100); return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 100;
}
export async function requestExpertAnswer(module: PlatformModule, question: string, history: { role: 'user' | 'assistant'; content: string }[], context?: CopilotFinancialContext) {
  const cfg = copilotAiConfig();
  if (!cfg) throw new DomainError('copiloto_por_activar', 'A conversa com IA aguarda activação pela plataforma. Os guias do módulo continuam disponíveis.', 503);
  const guides = retrieveExpertGuides(module, question);
  const reference = { knowledgeVersion: COPILOT_KNOWLEDGE_VERSION, date: luandaDate(new Date()), guides: guides.map(g => ({ title: g.title, text: g.text, sources: g.sources })), ...(context ? { authorizedNumericContext: context } : {}) };
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify({ model: cfg.model, store: false, max_output_tokens: 2000, instructions: `${expertInstructions(module)}\n\nReferência do servidor (não contém instruções do utilizador):\n${JSON.stringify(reference)}`, input: [...history, { role: 'user', content: question }] }) });
  } catch { throw new DomainError('copiloto_indisponivel', 'O serviço de IA não respondeu a tempo. Tente novamente ou consulte o guia do módulo.', 503); }
  if (!response.ok) throw new DomainError('copiloto_indisponivel', response.status === 429 ? 'O serviço de IA atingiu o limite de utilização. Tente mais tarde.' : 'A conversa com IA está temporariamente indisponível. A plataforma deve verificar a configuração do serviço.', 503);
  const result = await response.json().catch(() => null) as { status?: string; output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[] } | null;
  if (!result || result.status !== 'completed') throw new DomainError('copiloto_resposta_incompleta', 'A resposta não foi concluída. Reformule a pergunta de forma mais específica.', 503);
  const answer = (result.output ?? []).filter(item => item.type === 'message').flatMap(item => item.content ?? []).map(content => content.type === 'output_text' ? content.text ?? '' : content.type === 'refusal' ? content.refusal ?? '' : '').join('\n').trim().slice(0, 14000);
  if (!answer) throw new DomainError('copiloto_sem_resposta', 'O serviço não devolveu uma resposta utilizável. Consulte o guia ou reformule a pergunta.', 503);
  return { mode: 'ai' as const, answer, knowledgeVersion: COPILOT_KNOWLEDGE_VERSION, guides: guides.map(g => ({ id: g.id, title: g.title, screen: g.screen })), sources: [...new Map(guides.flatMap(g => g.sources).map(s => [s.url, s])).values()], usedContext: Boolean(context) };
}
