import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaSetup } from '@/components/pwa';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: 'Kianda RH',
  description: 'Gestão de pessoas, payroll e finanças de pessoal para empresas angolanas',
  applicationName: 'Kianda',
  appleWebApp: { capable: true, title: 'Kianda', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/icons/favicon-32.png', sizes: '32x32' }, { url: '/icons/icon-192.png', sizes: '192x192' }], apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0f5c4d', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

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
