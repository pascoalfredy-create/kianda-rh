'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { returnPath } from '../lib/return-path';

/** Regressa na navegação da plataforma; uma entrada directa tem sempre um destino útil. */
export function BackButton() {
  const path = usePathname(), search = useSearchParams(), router = useRouter();
  const current = `${path}${search.size ? `?${search}` : ''}`;
  const visited = useRef<string[]>([]);
  useEffect(() => {
    const stack = visited.current;
    if (stack[stack.length - 1] === current) return;
    if (stack[stack.length - 2] === current) stack.pop();
    else stack.push(current);
  }, [current]);
  if (path === '/') return null;
  const back = () => {
    let sameSite = false;
    try {
      const ref = new URL(document.referrer);
      sameSite = ref.origin === location.origin && !/^\/(login|registo|acesso|recuperar)(?:\/|$)/.test(ref.pathname);
    } catch { /* entrada directa */ }
    if (window.history.length > 1 && (visited.current.length > 1 || sameSite)) router.back();
    else {
      const parts = path.split('/').filter(Boolean);
      router.push(returnPath(parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/modulos'));
    }
  };
  return <button type="button" className="btn ghost sm navigation-back" onClick={back} aria-label="Voltar à página anterior">← <span>Voltar</span></button>;
}
