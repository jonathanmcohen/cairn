import type { ReactNode } from 'react';
import { SettingsSidebar } from '@/components/settings/sidebar';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-8">
      <SettingsSidebar />
      <section className="min-w-0 flex-1">{children}</section>
    </div>
  );
}
