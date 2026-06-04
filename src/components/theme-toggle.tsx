'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/provider';

type Mode = 'light' | 'system' | 'dark';
const NEXT: Record<Mode, Mode> = { light: 'system', system: 'dark', dark: 'light' };
const LABEL_KEY: Record<Mode, string> = {
  light: 'theme.toggle.light',
  system: 'theme.toggle.system',
  dark: 'theme.toggle.dark',
};

export function ThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  const mode: Mode = theme === 'light' || theme === 'dark' ? theme : 'system';
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      aria-label={t(LABEL_KEY[mode])}
      title={t('theme.toggle.cycleHint')}
      onClick={() => setTheme(NEXT[mode])}
    >
      {mode === 'light' && <Sun aria-hidden="true" className="h-5 w-5" />}
      {mode === 'system' && <Monitor aria-hidden="true" className="h-5 w-5" />}
      {mode === 'dark' && <Moon aria-hidden="true" className="h-5 w-5" />}
    </Button>
  );
}
