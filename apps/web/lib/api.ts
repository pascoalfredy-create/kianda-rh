import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { upstream } from './upstream';
import type { CompanyModulesOverview } from '@kianda/core';
export const SESSION_COOKIE = 'kianda_session';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Chamada à API a partir de componentes de servidor, reenviando o cookie de sessão do utilizador. */
async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await upstream(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}), ...init.headers },
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? `Erro ${res.status}`);
  return res.json();
}

// React limita esta reutilização à renderização corrente: sem cache entre empresas,
// sessões ou pedidos. Escritas e chamadas com opções continuam sempre a executar.
const readJson = cache((path: string) => requestJson(path));
export function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (init === undefined ? readJson(path) : requestJson(path, init)) as Promise<T>;
}

/** Inicia leituras independentes; a API continua a validar empresa, licença e perfil. */
export function preloadApi(...paths: string[]) {
  for (const path of paths) void api(path).catch(() => undefined);
}

export interface Me {
  user: { sub: string; name: string; role: string; companyId: string; employeeId: string | null };
  company: { id: string; name: string; nif: string; code?: string | null; hasLogo?: boolean } | null;
  licence?: { status: string; label: string; canWrite: boolean; trialEndsAt: string | null; paidUntil: string | null };
  platformAdmin?: boolean;
  notifications?: { absences: number; expenses: number };
  modules: CompanyModulesOverview;
}

export const currentUser = cache(async (): Promise<Me | null> => {
  try { return await api<Me>('/v1/auth/me'); } catch { return null; }
});
