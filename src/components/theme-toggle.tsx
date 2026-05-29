'use client';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun aria-hidden="true" className="h-5 w-5 dark:hidden" />
      <Moon aria-hidden="true" className="hidden h-5 w-5 dark:block" />
    </Button>
  );
}
