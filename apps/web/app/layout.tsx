import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kianda RH',
  description: 'Gestão de pessoas, payroll e finanças de pessoal para empresas angolanas',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
