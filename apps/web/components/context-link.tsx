'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';
import { contextualHref } from '@/lib/navigation-context';
import { returnPath } from '@/lib/return-path';

/** Ligações de trabalho: conserva a origem, sem alterar o menu principal. */
export function ContextLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const path = usePathname(), search = useSearchParams();
  const target = contextualHref(href, `${path}${search.size ? `?${search}` : ''}`);
  if (/^\/(?:modelagem|valora)(?:[?#]|$)/.test(target)) {
    const { prefetch: _prefetch, replace: _replace, scroll: _scroll, onNavigate: _onNavigate, ...anchor } = props;
    return <a href={target} {...anchor} />;
  }
  return <Link href={target} {...props} />;
}

export function ReturnLink({ fallback, children, originLabel = '← Voltar', ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { fallback: string; originLabel?: string }) {
  const search = useSearchParams(), origin = returnPath(search.get('voltar'), '');
  const target = origin || fallback;
  if (/^\/(?:modelagem|valora)(?:[?#]|$)/.test(target)) return <a href={target} className={props.className}>{origin ? originLabel : children}</a>;
  return <Link href={target} replace={!!origin} {...props}>{origin ? originLabel : children}</Link>;
}
