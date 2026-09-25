import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/lib/client/providers';

export const metadata: Metadata = {
  title: { default: 'Gestão Compra e Troca', template: '%s · Gestão Compra e Troca' },
  description: 'Gestão de compras, vendas, trocas, estoque e financeiro para pequenos negócios.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0d0e17', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
