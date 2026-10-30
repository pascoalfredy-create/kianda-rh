import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** Apenas a apresentação pública; sem empresas, projectos, recibos ou documentos. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: '2026-10-30' }];
}
