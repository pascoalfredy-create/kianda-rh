import { upstream } from '@/lib/upstream';

/**
 * Encaminha /api/* para a API, na mesma origem (o cookie de sessão fica no domínio da web).
 * Só passam os cabeçalhos necessários; o IP real segue para o limite de tentativas.
 */
async function forward(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const headers = new Headers();
  for (const h of ['content-type', 'cookie', 'authorization', 'accept']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  headers.set('x-forwarded-for', req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? '');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const res = await upstream(`/${path.map(encodeURIComponent).join('/')}${url.search}`, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
  });
  const out = new Headers();
  for (const [k, v] of res.headers) if (k !== 'set-cookie' && k !== 'content-encoding' && k !== 'content-length') out.set(k, v);
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
export const dynamic = 'force-dynamic';
