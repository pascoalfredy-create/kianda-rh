/** Persistência do protótipo: sem localStorage, revisões serializadas e sem perder edições em curso. */
import type { FinancialCurrency, SubscriptionStatus, financialTemplate } from '@kianda/core';
export interface CurrencyConversionInput { from: FinancialCurrency; to: FinancialCurrency; rate: number; rateDate: string; source: string; reference: boolean }
export interface ModelRecord {
  id: string; name: string; sector: string; currency: string; assumptions: Record<string, unknown>;
  revision: number; createdAt: string; archivedAt: string | null;
  /** Permissão efectiva neste projecto (participantes restritos podem ter só consulta). */
  permission?: 'editor' | 'viewer';
}
export interface VersionRecord {
  id: string; versionNumber: number; label: string; sourceRevision: number; sourceHash: string; payloadHash: string;
  engineVersion: string; reportVersion: string; approvedBy: string; approvedAt: string; approvedByName: string | null;
}
export interface PersonnelImportRecord {
  id: string; source: 'budget' | 'actual'; sourceId: string | null; fromPeriod: string; toPeriod: string; importedAt: string; importedByName: string | null;
  snapshot: { currency: string; exchangeRate: number; totalMinor: number; annualPersonnel: number; months: { period: string; costMinor: number; headcount: number }[] };
}
export interface PersonnelSources {
  hr: { active: boolean; message?: string };
  budgets: { id: string; year: number; approvedAt: string | null; totalMinor: number }[];
  windows: { from: string; to: string }[]; closedPeriods?: number; lastClosed?: string | null;
}
export type PersonnelImportInput = ({ source: 'budget'; budgetId: string } | { source: 'actual'; from: string; to: string }) & { exchangeRate?: number };
export interface UiModel extends Record<string, any> { id: string; nome: string; sector: string; moeda: string; criado: string }
export interface ModelingSession {
  user: { id: string; name: string; role: string }; company: { id: string; name: string };
  permission: 'editor' | 'viewer'; canWrite: boolean; formats: { pdf: boolean; xlsx: boolean; csv: boolean };
  licence?: { status: SubscriptionStatus; trialEndsAt: string | null; paidUntil: string | null };
  usage: { activeProjects: number; projectLimit: number | null; canCreateProject: boolean; userLimit: number; enabledUsers: number };
  bootstrap?: { models: ModelRecord[]; templates: ReturnType<typeof financialTemplate>[] };
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
interface Entry { revision: number; archivedAt: string | null; permission: 'editor' | 'viewer'; saved: string; desired: ReturnType<typeof modelPayload>; timer?: ReturnType<typeof setTimeout>; task?: Promise<void>; error?: Error; converting?: boolean; archiving?: boolean }
export class ModelingStore {
  readonly models: UiModel[] = [];
  readonly archivedModels: UiModel[] = [];
  private entries = new Map<string, Entry>();
  private stopped = false;
  constructor(readonly canWrite: boolean, private request: ModelingTransport = modelingRequest, private onError: (error: Error) => void = () => {}, private delay = 500) {}
  load(records: ModelRecord[]) {
    if (this.dirty) throw new Error('Há alterações por guardar.');
    this.models.splice(0); this.archivedModels.splice(0); this.entries.clear();
    for (const r of records) this.accept(r);
  }
  private accept(record: ModelRecord) {
    const model = presentModel(record), desired = modelPayload(model);
    (record.archivedAt ? this.archivedModels : this.models).push(model);
    this.entries.set(model.id, { revision: record.revision, archivedAt: record.archivedAt, permission: record.permission ?? 'editor', saved: JSON.stringify(desired), desired });
    return model;
  }
  get dirty() { return [...this.entries.values()].some((s) => Boolean(s.task) || s.converting || s.archiving || JSON.stringify(s.desired) !== s.saved); }
  stopAutosave() { this.stopped = true; for (const state of this.entries.values()) clearTimeout(state.timer); }
  project(id: string) { return this.models.find(m => m.id === id) ?? this.archivedModels.find(m => m.id === id); }
  archivedAt(id: string) { const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.'); return s.archivedAt; }
  canEdit(id: string) { const s = this.entries.get(id); return this.canWrite && !!s && !s.archivedAt && s.permission === 'editor'; }
  permission(id: string) { return this.entries.get(id)?.permission ?? null; }
  private writable(id: string) {
    if (!this.canWrite) throw new ModelingApiError(403, 'O seu acesso permite apenas consulta.');
    if (this.archivedAt(id)) throw new ModelingApiError(409, 'Projecto arquivado. Restaure-o antes de o alterar.');
    if (this.entries.get(id)!.permission !== 'editor') throw new ModelingApiError(403, 'O seu acesso a este projecto é só de consulta.');
  }
  revision(id: string) { const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.'); return s.revision; }
  change(model: UiModel) {
    if (!this.canWrite || this.stopped) return; // Cenário/unidade de consulta ficam só na memória da página.
    const state = this.entries.get(model.id); if (!state) throw new Error('Projecto inexistente.');
    if (state.archivedAt || state.permission !== 'editor') return;
    if (state.converting) throw new ModelingApiError(409, 'Aguarde pela conversão da moeda.');
    if (state.archiving) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    state.desired = modelPayload(model);
    clearTimeout(state.timer);
    if (!state.error && JSON.stringify(state.desired) !== state.saved) state.timer = setTimeout(() => { this.flush(model.id).catch(() => {}); }, this.delay);
  }
  async flush(id?: string): Promise<void> {
    if (this.stopped) return;
    if (!id) { await Promise.all([...this.entries.keys()].map((key) => this.flush(key))); return; }
    const s = this.entries.get(id); if (!s) throw new Error('Projecto inexistente.');
    if (s.converting) throw new ModelingApiError(409, 'Aguarde pela conversão da moeda.');
    if (s.archiving) throw new ModelingApiError(409, 'Aguarde pela alteração do estado do projecto.');
    clearTimeout(s.timer);
    if (s.error) throw s.error;
    if (!s.task && JSON.stringify(s.desired) !== s.saved) {
      s.task = (async () => {
        while (!this.stopped && JSON.stringify(s.desired) !== s.saved) {
          const payload = copy(s.desired), fingerprint = JSON.stringify(payload);
          const updated = await this.request<ModelRecord>(`/models/${encodeURIComponent(id)}`, 'PUT', { ...payload, revision: s.revision });
          s.revision = updated.revision; s.saved = fingerprint;
        }
      })().catch((err) => {
        s.error = err instanceof Error ? err : new Error(String(err)); if (!this.stopped) this.onError(s.error); throw s.error;
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
  /** Substitui o registo local pelo do servidor (depois de uma operação que altera o projecto no servidor). */
  private replace(id: string, record: ModelRecord) {
    const state = this.entries.get(id)!, model = this.project(id)!;
    for (const key of Object.keys(model)) delete model[key];
    Object.assign(model, presentModel(record));
    state.revision = record.revision; state.desired = modelPayload(model); state.saved = JSON.stringify(state.desired);
    return model;
  }
  /** Ficha do projecto no servidor, com o histórico de importações do RH. */
  async detail(id: string) {
    await this.flush(id);
    return this.request<ModelRecord & { imports: PersonnelImportRecord[] }>(`/models/${encodeURIComponent(id)}`);
  }
  async personnelSources() { return this.request<PersonnelSources>('/personnel-sources'); }
  /** Cópia explícita dos custos com pessoal do RH (substitui 72 · Custos com o pessoal do ano 1). */
  async importPersonnel(id: string, input: PersonnelImportInput) {
    this.writable(id);
    await this.flush(id);
    const state = this.entries.get(id)!;
    if (state.converting || state.archiving) throw new ModelingApiError(409, 'Aguarde pela operação em curso neste projecto.');
    state.converting = true;
    try {
      const result = await this.request<{ model: ModelRecord; import: PersonnelImportRecord }>(`/models/${encodeURIComponent(id)}/import-personnel`, 'POST', { ...input, revision: state.revision });
      return { model: this.replace(id, result.model), import: result.import };
    } finally { state.converting = false; }
  }
  async versions(id: string) { return this.request<VersionRecord[]>(`/models/${encodeURIComponent(id)}/versions`); }
  async version(id: string, versionId: string) {
    return this.request<VersionRecord & { payload: { inputAssumptions: Record<string, unknown>; source: Record<string, unknown>; result: { engineVersion: string; npv: number | null; scenario: string } } }>(`/models/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`);
  }
  /** Aprova a revisão gravada (o rascunho em edição é gravado primeiro, para aprovar exactamente o que está no ecrã). */
  async approve(id: string, label: string) {
    this.writable(id);
    await this.flush(id);
    return this.request<VersionRecord>(`/models/${encodeURIComponent(id)}/versions`, 'POST', { revision: this.revision(id), label });
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
    const query = new URLSearchParams({ format, ...(version ? { version } : { revision: String(this.revision(model.id)), scenario: model.cen }) });
    const response = await fetch(`/api/v1/modeling/models/${encodeURIComponent(model.id)}/reports/${encodeURIComponent(key)}?${query}`, { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new ModelingApiError(response.status, data.message || data.issues?.map((v: { path: string; message: string }) => `${v.path}: ${v.message}`).join(' · ') || `Erro ${response.status}`);
    }
    return response;
  }
}
