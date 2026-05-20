import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Cairn',
  description: 'Self-hosted block-based notes',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
