import 'server-only';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

interface ServiceBinding { fetch(input: Request): Promise<Response> }

/**
 * Pedido à API.
 * - Em Cloudflare: pela ligação interna (service binding `API`) — a API não tem endereço público.
 * - Em desenvolvimento local: por HTTP para API_URL.
 */
export async function upstream(path: string, init: RequestInit): Promise<Response> {
  const binding = await apiBinding();
  if (binding) return binding.fetch(new Request(`https://kianda-api.internal${path}`, init));
  return fetch(`${API_URL}${path}`, init);
}

async function apiBinding(): Promise<ServiceBinding | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const env = getCloudflareContext().env as unknown as { API?: ServiceBinding };
    return env.API ?? null;
  } catch {
    return null; // fora do runtime Cloudflare (next dev / next start)
  }
}
