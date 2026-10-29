/** Persistência do protótipo: sem localStorage, revisões serializadas e sem perder edições em curso. */
import type { FinancialCurrency, FinancialHistoricalAnalysis, FinancialHistoricalInput, financialTemplate } from '@kianda/core';
export interface CurrencyConversionInput { from: FinancialCurrency; to: FinancialCurrency; rate: number; rateDate: string; source: string; reference: boolean }
export interface HistoricalRecord { inputHash: string; updatedAt: string; analysis: FinancialHistoricalAnalysis }
export interface ModelRecord {
  id: string; name: string; sector: string; currency: string; assumptions: Record<string, unknown>;
  revision: number; createdAt: string; archivedAt: string | null;
}
export interface UiModel extends Record<string, any> { id: string; nome: string; sector: string; moeda: string; criado: string }
export interface ModelingSession {
  user: { id: string; name: string; role: string }; company: { id: string; name: string };
  permission: 'editor' | 'viewer'; canWrite: boolean; formats: { pdf: boolean; xlsx: boolean; csv: boolean };
  usage: { activeProjects: number; projectLimit: number | null; canCreateProject: boolean; userLimit: number; enabledUsers: number };
  bootstrap?: { models: ModelRecord[]; templates: ReturnType<typeof financialTemplate>[]; firstHistory: { modelId: string; revision: number; historical: HistoricalRecord | null } | null };
}
export class ModelingApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type ModelingTransport = <T>(path: string, method?: string, payload?: unknown) => Promise<T>;
export const modelingRequest: ModelingTransport = async <T>(path: string, method = 'GET', payload?: unknown): Promise<T> => {
  const res = await fetch(`/api/v1/modeling${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: payload === undefined ? {} : { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof location !== 'undefined') location.assign('/login?voltar=/modelagem');
    throw new ModelingApiError(res.status, data.issues?.map((v: { path: string; message: string }) => `${v.path}: ${v.message}`).join(' · ') || data.message || `Erro ${res.status}`);
  }
  return data as T;
};
const copy = <T>(v: T): T => structuredClone(v);
export function modelPayload(model: UiModel) {
  const { id: _id, nome, sector, moeda, criado: _date, ...assumptions } = model;
  return { name: nome, sector, currency: moeda, assumptions: copy(assumptions) };
}
/** Campos em falta ficam vazios nos formulários; não se completam pressupostos com exemplos. */
export function presentModel(record: ModelRecord): UiModel {
  const a = copy(record.assumptions), obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
  const result = { ...a } as Record<string, any>;
  for (const k of ['horizonte', 'anoBase', 'inicioOp', 'preOp', 'inflacao', 'ii', 'royalty', 'cvar', 'pessoal', 'fst', 'outros', 'manut', 'vidaManut', 'dso', 'dio', 'dpo', 'capitalInicial', 'payout', 'caixaMin', 'sens']) if (typeof result[k] !== 'number' || !Number.isFinite(result[k])) result[k] = undefined;
  const nestedTextFields: Record<string, string[]> = { divida: [], abertura: [], cov: [], mult: [], wacc: ['modo'], tv: ['metodo'] };
  for (const [key, text] of Object.entries(nestedTextFields)) {
    result[key] = obj(result[key]);
    for (const [k, v] of Object.entries(result[key])) if (!text.includes(k) && (typeof v !== 'number' || !Number.isFinite(v))) delete result[key][k];
  }
  result.cenarios = Object.fromEntries(['base', 'otim', 'pess'].map((key) => [key, Object.fromEntries(Object.entries(obj(obj(a.cenarios)[key])).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))]));
  for (const [key, texts] of [['receitas', ['nome', 'unid', 'ramp']], ['capex', ['nome']]] as const) result[key] = (Array.isArray(a[key]) ? a[key] : []).map((v) => Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, (texts as readonly string[]).includes(k) ? typeof n === 'string' ? n : '' : typeof n === 'number' && Number.isFinite(n) ? n : undefined])));
  return { ...result, id: record.id, nome: record.name, sector: record.sector, moeda: record.currency, criado: record.createdAt.slice(0, 10) };
}
interface Entry { revision: number; archivedAt: string | null; saved: string; desired: ReturnType<typeof modelPayload>; timer?: ReturnType<typeof setTimeout>; task?: Promise<void>; error?: Error; converting?: boolean; archiving?: boolean }
export class ModelingStore {
  readonly models: UiModel[] = [];
  readonly archivedModels: UiModel[] = [];
  private entries = new Map<string, Entry>();
  constructor(readonly canWrite: boolean, private request: ModelingTransport = modelingRequest, private onError: (error: Error) => void = () => {}, private delay = 500) {}
  load(records: ModelRecord[]) {
    if (this.dirty) throw new Error('Há alterações por guardar.');
    this.models.splice(0); this.archivedModels.splice(0); this.entries.clear();
    for (const r of records) this.accept(r);
  }
  private accept(record: ModelRecord) {
    const model = presentModel(record), desired = modelPayload(model);
    (record.archivedAt ? this.archivedModels : this.models).push(model);
    this.entries.set(model.id, { revision: record.revision, archivedAt: record.archivedAt, saved: JSON.stringify(desired), desired });
    return model;
  }
  get dirty() { return [...this.entries.values()].some((s) => Boolean(s.task) || s.converting || s.archiving || JSON.stringify(s.desired) !== s.saved); }
  project(id: string) { return this.models.find(m => m.id === id) ?? this.archivedModels.find(m => m.id === id); }
  archivedAt(id: string) { const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.'); return s.archivedAt; }
  canEdit(id: string) { return this.canWrite && this.entries.has(id) && !this.entries.get(id)!.archivedAt; }
  private writable(id: string) {
    if (!this.canWrite) throw new ModelingApiError(403, 'O seu acesso permite apenas consulta.');
    if (this.archivedAt(id)) throw new ModelingApiError(409, 'Projecto arquivado. Restaure-o antes de o alterar.');
  }
  revision(id: string) { const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.'); return s.revision; }
  change(model: UiModel) {
    if (!this.canWrite) return; // Cenário/unidade de consulta ficam só na memória da página.
    const state = this.entries.get(model.id); if (!state) throw new Error('Projecto inexistente.');
    if (state.archivedAt) return;
    if (state.converting) throw new ModelingApiError(409, 'Aguarde pela conversão da moeda.');
    if (state.archiving) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    state.desired = modelPayload(model);
    clearTimeout(state.timer);
    if (!state.error && JSON.stringify(state.desired) !== state.saved) state.timer = setTimeout(() => { this.flush(model.id).catch(() => {}); }, this.delay);
  }
  async flush(id?: string): Promise<void> {
    if (!id) { await Promise.all([...this.entries.keys()].map((key) => this.flush(key))); return; }
    const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.');
    if (s.converting) throw new ModelingApiError(409, 'Aguarde pela conversão da moeda.');
    if (s.archiving) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    clearTimeout(s.timer);
    if (s.error) throw s.error;
    if (!s.task && JSON.stringify(s.desired) !== s.saved) {
      s.task = (async () => {
        while (JSON.stringify(s.desired) !== s.saved) {
          const payload = copy(s.desired), fingerprint = JSON.stringify(payload);
          const updated = await this.request<ModelRecord>(`/models/${encodeURIComponent(id)}`, 'PUT', { ...payload, revision: s.revision });
          s.revision = updated.revision; s.saved = fingerprint;
        }
      })().catch((err) => {
        s.error = err instanceof Error ? err : new Error(String(err)); this.onError(s.error); throw s.error;
      }).finally(() => { s.task = undefined; });
    }
    await s.task;
  }
  async create(model: UiModel) {
    if (!this.canWrite) throw new ModelingApiError(403, 'O seu acesso permite apenas consulta.');
    await this.flush();
    return this.accept(await this.request<ModelRecord>('/models', 'POST', modelPayload(model)));
  }
  async convertCurrency(id: string, input: CurrencyConversionInput) {
    this.writable(id);
    await this.flush(id);
    const state = this.entries.get(id)!, model = this.models.find(m => m.id === id)!;
    // Duas selecções concorrentes não podem converter os mesmos valores duas vezes.
    if (state.converting) throw new ModelingApiError(409, 'Aguarde pela conversão da moeda.');
    if (state.archiving) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    state.converting = true;
    try {
      const record = await this.request<ModelRecord>(`/models/${encodeURIComponent(id)}/convert-currency`, 'POST', { ...input, revision: state.revision });
      for (const key of Object.keys(model)) delete model[key];
      Object.assign(model, presentModel(record));
      state.revision = record.revision; state.desired = modelPayload(model); state.saved = JSON.stringify(state.desired);
      return model;
    } finally { state.converting = false; }
  }
  async history(id: string) {
    await this.flush(id);
    const result = await this.request<{ revision: number; historical: HistoricalRecord | null }>(`/models/${encodeURIComponent(id)}/history`);
    if (result.revision !== this.revision(id)) throw new ModelingApiError(409, 'Projecto alterado. Volte a carregá-lo antes de analisar balancetes.');
    return result.historical;
  }
  async saveHistory(id: string, input: FinancialHistoricalInput) {
    this.writable(id);
    await this.flush(id);
    const result = await this.request<{ model: ModelRecord; historical: HistoricalRecord }>(`/models/${encodeURIComponent(id)}/history`, 'PUT', { revision: this.revision(id), input });
    this.entries.get(id)!.revision = result.model.revision;
    return result.historical;
  }
  async createFromHistory(id: string) {
    this.writable(id);
    await this.flush();
    const result = await this.request<{ model: ModelRecord; historical: HistoricalRecord; notes: string[] }>(`/models/${encodeURIComponent(id)}/history/to-model`, 'POST', { revision: this.revision(id) });
    return { model: this.accept(result.model), historical: result.historical, notes: result.notes };
  }
  /** Não remove dados. Só muda a lista local depois da confirmação do servidor. */
  async setArchived(id: string, archived: boolean) {
    if (!this.canWrite) throw new ModelingApiError(403, 'O seu acesso permite apenas consulta.');
    await this.flush(id);
    const state = this.entries.get(id)!;
    if (state.archiving || state.converting) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    if (Boolean(state.archivedAt) === archived) throw new ModelingApiError(409, archived ? 'O projecto já está arquivado.' : 'O projecto já está activo.');
    state.archiving = true;
    try {
      const record = await this.request<ModelRecord>(`/models/${encodeURIComponent(id)}/archive`, 'POST', { archived, revision: state.revision });
      const model = this.project(id)!;
      for (const key of Object.keys(model)) delete model[key];
      Object.assign(model, presentModel(record));
      const from = archived ? this.models : this.archivedModels, to = archived ? this.archivedModels : this.models;
      from.splice(from.findIndex(m => m.id === id), 1); to.push(model);
      state.revision = record.revision; state.archivedAt = record.archivedAt;
      state.desired = modelPayload(model); state.saved = JSON.stringify(state.desired);
      return model;
    } finally { state.archiving = false; }
  }
  async download(model: UiModel, key: string, version?: string, format: 'pdf' | 'xlsx' = 'pdf') {
    await this.flush(model.id);
    const query = new URLSearchParams({ format, ...(version ? { version } : { revision: String(this.revision(model.id)), ...(key === 'analise' ? {} : { scenario: model.cen }) }) });
    const response = await fetch(`/api/v1/modeling/models/${encodeURIComponent(model.id)}/reports/${encodeURIComponent(key)}?${query}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ModelingApiError(response.status, data.message || data.issues?.map((v: { path: string; message: string }) => `${v.path}: ${v.message}`).join(' · ') || `Erro ${response.status}`);
    }
    return response;
  }
}
