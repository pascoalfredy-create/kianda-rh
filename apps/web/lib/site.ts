import type { Metadata } from 'next';

/** Endereço público canónico; os endereços internos da API não entram no índice. */
export const SITE_URL = 'https://kianda.yelaperformance.com';
export const PUBLIC_METADATA: Metadata = {
  title: 'Kianda | Recursos Humanos, Modelagem Financeira e Avaliação de Empresas em Angola',
  description: 'Kianda RH, Kianda Integra e Kianda Valora: gestão de pessoas, processamento salarial, projectos de viabilidade, demonstrações por PGC Angola, orçamento, tesouraria e avaliação de empresas em Angola.',
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website', locale: 'pt_AO', siteName: 'Kianda', url: SITE_URL,
    title: 'Kianda RH, Integra e Valora',
    description: 'Recursos Humanos, Modelagem Financeira e Análise e Avaliação para empresas em Angola.',
    images: [{ url: `${SITE_URL}/icons/icon-512.png`, width: 512, height: 512, alt: 'Kianda' }],
  },
  twitter: { card: 'summary', title: 'Kianda RH, Integra e Valora', description: 'Recursos Humanos, Modelagem Financeira e Análise e Avaliação em Angola.', images: [`${SITE_URL}/icons/icon-512.png`] },
};

export const SITE_SCHEMA = {
  '@context': 'https://schema.org', '@type': 'WebSite', name: 'Kianda',
  alternateName: ['Kianda RH', 'Kianda Integra', 'Kianda Valora'], url: SITE_URL, inLanguage: 'pt-AO',
  description: PUBLIC_METADATA.description,
};
