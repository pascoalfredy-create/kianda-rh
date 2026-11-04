/** Pedidos de formulários: uma falha de rede deve devolver o controlo ao utilizador. */
export async function jsonRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(path, { ...init, signal: controller.signal });
    if (res.status === 204) return { res, body: {} as Record<string, any> };
    const body = await res.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return { res: new Response(null, { status: res.ok ? 502 : res.status }), body: { message: 'Não foi possível confirmar a resposta. Tente novamente.' } as Record<string, any> };
    }
    return { res, body: body as Record<string, any> };
  } catch {
    return { res: new Response(null, { status: 503 }), body: { error: 'sem_ligacao', message: 'Não foi possível confirmar o pedido. Verifique a ligação e tente novamente.' } as Record<string, any> };
  } finally {
    clearTimeout(timeout);
  }
}
