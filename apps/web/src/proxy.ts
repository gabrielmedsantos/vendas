import { NextResponse, type NextRequest } from 'next/server';

/**
 * Redireciona para /entrar quando não há cookie de sessão. É só conveniência de
 * navegação: a validação real da sessão e da empresa ocorre no servidor, em cada API.
 */
export function proxy(req: NextRequest) {
  const has = req.cookies.has('gct.session_token') || req.cookies.has('__Secure-gct.session_token');
  if (!has) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*', '/plataforma/:path*'] };
