import 'server-only';
import { cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
export const SESSION_COOKIE = 'kianda_session';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Chamada à API a partir de componentes de servidor, reenviando o cookie de sessão do utilizador. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(session ? { cookie: `${SESSION_COOKIE}=${session}` } : {}), ...init.headers },
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? `Erro ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Me { user: { sub: string; name: string; role: string; companyId: string; employeeId: string | null }; company: { id: string; name: string; nif: string } | null }

export async function currentUser(): Promise<Me | null> {
  try { return await api<Me>('/v1/auth/me'); } catch { return null; }
}
