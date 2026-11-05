'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ComponentProps } from 'react';
import { contextualHref } from '@/lib/navigation-context';
import { returnPath } from '@/lib/return-path';

/** Ligações de trabalho: conserva a origem, sem alterar o menu principal. */
export function ContextLink({ href, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const path = usePathname(), search = useSearchParams();
  return <Link href={contextualHref(href, `${path}${search.size ? `?${search}` : ''}`)} {...props} />;
}

export function ReturnLink({ fallback, children, ...props }: Omit<ComponentProps<typeof Link>, 'href'> & { fallback: string }) {
  const search = useSearchParams(), origin = returnPath(search.get('voltar'), '');
  return <Link href={origin || fallback} replace={!!origin} {...props}>{origin ? '← Voltar' : children}</Link>;
}
