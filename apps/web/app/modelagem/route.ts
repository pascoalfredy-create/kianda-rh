import { cookies } from 'next/headers';
import { upstream } from '@/lib/upstream';
import { modelingHeaders, modelingPage } from '@/lib/modeling/page';
import type { ModelingSession } from '@/modeling/store';

/** Documento independente: conserva o HTML aprovado e a navegação RH existente. */
export async function GET(request: Request) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  try {
    const cookie = (await cookies()).get('kianda_session')?.value;
    const res = await upstream('/v1/modeling/session', { headers: cookie ? { cookie: `kianda_session=${cookie}` } : {}, cache: 'no-store' });
    if (res.status === 401) return new Response(null, { status: 303, headers: { location: new URL('/login?voltar=/modelagem', request.url).toString(), 'cache-control': 'private, no-store' } });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      if (res.status === 403 && ['modulo_nao_subscrito', 'sem_permissao'].includes(error.error)) return new Response(null, { status: 303, headers: { location: new URL('/modulos', request.url).toString(), 'cache-control': 'private, no-store' } });
      return new Response(modelingPage(null, nonce, error.message || 'Não foi possível abrir a Modelagem.'), { status: res.status, headers: modelingHeaders(nonce) });
    }
    return new Response(modelingPage(await res.json() as ModelingSession, nonce), { headers: modelingHeaders(nonce) });
  } catch {
    return new Response(modelingPage(null, nonce, 'Serviço temporariamente indisponível. Volte a tentar.'), { status: 503, headers: modelingHeaders(nonce) });
  }
}
export const dynamic = 'force-dynamic';
