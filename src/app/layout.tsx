import type { ReactNode } from 'react';
import { AuthSessionProvider } from '@/components/session-provider';
import { ThemeProvider } from '@/components/theme-provider';
import 'tippy.js/dist/tippy.css';
import './globals.css';

export const metadata = {
  title: 'Cairn',
  description: 'Self-hosted block-based notes',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <AuthSessionProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
