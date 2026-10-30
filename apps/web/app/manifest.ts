import type { MetadataRoute } from 'next';

/** App instalável (PWA): ecrã inicial do telemóvel, sem loja de aplicações. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Kianda — RH e Integra',
    short_name: 'Kianda',
    description: 'Recursos Humanos e Modelagem Financeira para empresas em Angola',
    start_url: '/?origem=app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f5f6f8',
    theme_color: '#0f5c4d',
    lang: 'pt',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Modelagem Financeira', short_name: 'Integra', url: '/modelagem', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Registar ponto', short_name: 'Ponto', url: '/assiduidade', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Os meus recibos', short_name: 'Recibos', url: '/recibos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Pedir férias', short_name: 'Férias', url: '/ausencias', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  };
}
