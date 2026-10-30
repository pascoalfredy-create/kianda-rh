import type { Metadata } from 'next';

/** Endereço público canónico; os endereços internos da API não entram no índice. */
export const SITE_URL = 'https://kianda.yelaperformance.com';
export const PUBLIC_METADATA: Metadata = {
  title: 'Kianda | Recursos Humanos e Modelagem Financeira em Angola',
  description: 'Kianda RH e Kianda Integra: gestão de pessoas, processamento salarial, projectos de viabilidade, análise financeira e relatórios PDF para empresas em Angola.',
  alternates: { canonical: SITE_URL },
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website', locale: 'pt_AO', siteName: 'Kianda', url: SITE_URL,
    title: 'Kianda RH e Integra',
    description: 'Recursos Humanos e Modelagem Financeira para empresas em Angola.',
    images: [{ url: `${SITE_URL}/icons/icon-512.png`, width: 512, height: 512, alt: 'Kianda' }],
  },
  twitter: { card: 'summary', title: 'Kianda RH e Integra', description: 'Recursos Humanos e Modelagem Financeira em Angola.', images: [`${SITE_URL}/icons/icon-512.png`] },
};

export const SITE_SCHEMA = {
  '@context': 'https://schema.org', '@type': 'WebSite', name: 'Kianda',
  alternateName: ['Kianda RH', 'Kianda Integra'], url: SITE_URL, inLanguage: 'pt-AO',
  description: PUBLIC_METADATA.description,
};
