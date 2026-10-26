import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = ['/login', '/registo'];

/**
 * Protecção de rotas: sem cookie de sessão, redirecciona para o login.
 * A validade do token é verificada pela API em cada pedido; aqui só se evita mostrar páginas vazias.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get('kianda_session')?.value);
  if (!hasSession && !PUBLIC.includes(pathname)) {
    const url = new URL('/login', req.url);
    if (pathname !== '/') url.searchParams.set('voltar', pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && PUBLIC.includes(pathname)) return NextResponse.redirect(new URL('/', req.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
