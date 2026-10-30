import { SITE_SCHEMA } from '@/lib/site';
import { PublicHomeContent } from './public-home-content';

/** Apresentação pública aprovada, com conteúdo inicial e metadados renderizados no servidor. */
export function PublicHome() {
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_SCHEMA).replace(/</g, '\\u003c') }} />
    <PublicHomeContent />
  </>;
}
