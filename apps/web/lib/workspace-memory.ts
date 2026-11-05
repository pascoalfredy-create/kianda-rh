/** Apenas contexto de navegação e rascunhos; os registos financeiros continuam na API. */
export const WORKSPACE_KEY = 'kianda-workspace-v1';
const TTL = 8 * 60 * 60 * 1000;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface Snapshot { scope: string; expires: number; values: Record<string, unknown> }
const instances = new Set<WorkspaceMemory>();

export function clearWorkspaceMemory() {
  for (const memory of instances) memory.stop();
  instances.clear();
  try { sessionStorage.removeItem(WORKSPACE_KEY); } catch { /* sem armazenamento */ }
}

export class WorkspaceMemory {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private loaded = false;
  private stopped = false;
  constructor(readonly scope: string, private storage: () => StoragePort | undefined = () => typeof window === 'undefined' ? undefined : window.sessionStorage, private now = Date.now) { if (typeof window !== 'undefined') instances.add(this); }
  stop() { this.stopped = true; this.values.clear(); }
  private load() {
    if (this.loaded || typeof window === 'undefined') return;
    this.loaded = true;
    try {
      const port = this.storage(), raw = port?.getItem(WORKSPACE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Snapshot;
      if (data.scope !== this.scope || !(data.expires > this.now()) || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) { port?.removeItem(WORKSPACE_KEY); return; }
      this.values = new Map(Object.entries(data.values));
    } catch { /* O bloqueio do armazenamento não impede a navegação. */ }
  }
  get = (key: string): unknown => { if (this.stopped) return undefined; this.load(); return this.values.get(key); };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  set(key: string, value: unknown) {
    if (this.stopped) return;
    this.load();
    if (Object.is(this.values.get(key), value)) return;
    this.values.delete(key); this.values.set(key, value);
    while (this.values.size > 250) this.values.delete(this.values.keys().next().value!);
    this.persist();
  }
  clear(prefix: string) {
    if (this.stopped) return;
    this.load();
    for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
    this.persist();
  }
  private persist() {
    try {
      const data = JSON.stringify({ scope: this.scope, expires: this.now() + TTL, values: Object.fromEntries(this.values) });
      if (data.length <= 1_000_000) this.storage()?.setItem(WORKSPACE_KEY, data);
    } catch { /* A memória desta página continua disponível. */ }
    for (const listener of this.listeners) listener();
  }
}

/** Não aceita tipos incompatíveis de uma sessão antiga ou de armazenamento danificado. */
export function compatibleDraft(value: unknown, initial: unknown): boolean {
  if (initial === null) return value === null || (typeof value === 'object' && !Array.isArray(value));
  if (Array.isArray(initial)) return Array.isArray(value) && value.every(item => initial.length ? compatibleDraft(item, initial[0]) : item === null || ['string', 'number', 'boolean', 'object'].includes(typeof item));
  if (typeof initial === 'object') return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(initial as Record<string, unknown>).every(([key, expected]) => compatibleDraft((value as Record<string, unknown>)[key], expected));
  return typeof value === typeof initial && (typeof value !== 'number' || Number.isFinite(value));
}

export function workspaceScope(companyId: string | null | undefined, userId: string) { return `${companyId ?? 'platform'}:${userId}`; }
