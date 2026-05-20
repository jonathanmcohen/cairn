import { ThemeProvider } from '@/components/theme-provider';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Cairn',
  description: 'Self-hosted block-based notes',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
