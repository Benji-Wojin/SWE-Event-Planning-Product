import type { Metadata } from 'next';
import { Inter, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ThemeRecovery } from '@/components/theme-recovery';

const interSans = Inter({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Weft — Event planning',
  description:
    'Event planning workspace.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script src="/gather-assets/theme.js" /></head>
      <body
        className={`${interSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeRecovery />
        {children}
      </body>
    </html>
  );
}
