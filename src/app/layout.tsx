import { Inter } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { AuthSessionProvider } from '@/components/session-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { AlertProvider } from '@/components/ui/alert-dialog';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { InputDialogProvider } from '@/components/ui/input-dialog';
import { dir, LOCALE_COOKIE } from '@/lib/i18n/config';
import { getMessages } from '@/lib/i18n/messages';
import { I18nProvider } from '@/lib/i18n/provider';
import { resolveLocale } from '@/lib/i18n/resolve';
import { cspNonce } from '@/lib/security/headers';
import 'tippy.js/dist/tippy.css';
import './globals.css';

// v0.9.11 #1 — ship Inter as the branded sans. next/font self-hosts the font
// at build (bundled into the standalone output, no runtime CDN fetch → CSP-safe)
// and `display: 'swap'` shows the system fallback until Inter loads (no FOIT).
// Exposed as --font-inter; globals.css prepends it to --cairn-font-family.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

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
  const hdrs = await headers();
  const nonce = cspNonce(hdrs.get('content-security-policy'));
  const cookieStore = await cookies();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    hdrs.get('accept-language'),
  );
  const messages = getMessages(locale);
  return (
    <html lang={locale} dir={dir(locale)} className={inter.variable} suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen antialiased">
        <I18nProvider locale={locale} messages={messages}>
          <AuthSessionProvider>
            <ThemeProvider nonce={nonce}>
              <ConfirmProvider>
                <InputDialogProvider>
                  <AlertProvider>{children}</AlertProvider>
                </InputDialogProvider>
              </ConfirmProvider>
            </ThemeProvider>
          </AuthSessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
