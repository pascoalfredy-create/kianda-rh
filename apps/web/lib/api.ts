export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** Empresa activa — temporário até existir autenticação (ver docs/ROADMAP.md). */
export const DEMO_COMPANY_ID = process.env.NEXT_PUBLIC_DEMO_COMPANY_ID ?? '';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(DEMO_COMPANY_ID ? { 'x-company-id': DEMO_COMPANY_ID } : {}), ...init.headers },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? `Erro ${res.status}`);
  return res.json() as Promise<T>;
}
