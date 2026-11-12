import { cookies } from 'next/headers';
import { upstream } from '@/lib/upstream';
import { valuationHeaders, valuationPage, type ValuationSession } from '@/lib/valuation/page';

/** Kianda Valora: documento independente com a interface aprovada; os dados vêm da API da empresa da sessão. */
export async function GET(request: Request) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  try {
    const cookie = (await cookies()).get('kianda_session')?.value;
    const res = await upstream('/v1/valuation/bootstrap', { headers: cookie ? { cookie: `kianda_session=${cookie}` } : {}, cache: 'no-store' });
    if (res.status === 401) return new Response(null, { status: 303, headers: { location: new URL('/login?voltar=/valora', request.url).toString(), 'cache-control': 'private, no-store' } });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      if (res.status === 403 && error.error === 'conta_da_plataforma') return new Response(null, { status: 303, headers: { location: new URL('/plataforma', request.url).toString(), 'cache-control': 'private, no-store' } });
      if (res.status === 403 && error.error === 'email_por_confirmar') return new Response(null, { status: 303, headers: { location: new URL('/confirmar-email', request.url).toString(), 'cache-control': 'private, no-store' } });
      if (res.status === 403 && ['modulo_nao_subscrito', 'sem_permissao'].includes(error.error)) return new Response(null, { status: 303, headers: { location: new URL('/modulos#valuation', request.url).toString(), 'cache-control': 'private, no-store' } });
      return new Response(valuationPage(null, nonce, error.message || 'Não foi possível abrir o Valora.'), { status: res.status, headers: valuationHeaders(nonce) });
    }
    return new Response(valuationPage(await res.json() as ValuationSession, nonce), { headers: valuationHeaders(nonce) });
  } catch {
    return new Response(valuationPage(null, nonce, 'Serviço temporariamente indisponível. Volte a tentar.'), { status: 503, headers: valuationHeaders(nonce) });
  }
}
export const dynamic = 'force-dynamic';
