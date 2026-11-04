import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/schibsted-grotesk';
import './globals.css';
import { PwaSetup } from '@/components/pwa';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Kianda',
  description: 'Recursos Humanos, Modelagem Financeira e Análise e Avaliação para empresas em Angola',
  applicationName: 'Kianda',
  appleWebApp: { capable: true, title: 'Kianda', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/icons/favicon-32.png', sizes: '32x32' }, { url: '/icons/icon-192.png', sizes: '192x192' }], apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0e4a3c', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>
        {children}
        <PwaSetup />
      </body>
    </html>
  );
}
