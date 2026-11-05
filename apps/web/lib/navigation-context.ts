import { returnPath } from './return-path';

/** A origem inclui mês, filtros e separador; as ligações externas nunca são alteradas. */
export function contextualHref(href: string, current: string) {
  if (!href || href.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(href)) return href;
  const base = 'https://kianda.invalid';
  const source = new URL(returnPath(current), base), target = new URL(href, source);
  if (target.origin !== base || /^\/(?:api|login|registo|recuperar)(?:\/|$)/.test(target.pathname)) return href;
  const origin = target.pathname === source.pathname ? source.searchParams.get('voltar') : `${source.pathname}${source.search}${source.hash}`;
  if (!target.searchParams.has('voltar') && origin && origin.length <= 4096) target.searchParams.set('voltar', returnPath(origin));
  return `${target.pathname}${target.search}${target.hash}`;
}
