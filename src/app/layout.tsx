import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { AuthSessionProvider } from '@/components/session-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { cspNonce } from '@/lib/security/headers';
import 'tippy.js/dist/tippy.css';
import './globals.css';

export const metadata = {
  title: 'Cairn',
  description: 'Self-hosted block-based notes',
  manifest: '/manifest.webmanifest',
  icons: { apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Cairn', statusBarStyle: 'black-translucent' },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The proxy mints a per-request CSP nonce and forwards it on the request's
  // Content-Security-Policy header. next-themes injects its own inline bootstrap
  // <script>, so it needs the nonce explicitly (Next auto-nonces only its own
  // framework scripts) — otherwise that one inline script is CSP-blocked.
  const nonce = cspNonce((await headers()).get('content-security-policy'));
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <AuthSessionProvider>
          <ThemeProvider nonce={nonce}>{children}</ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
