'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(fd: FormData) {
    setBusy(true);
    setError(null);
    const res = await signIn('credentials', {
      email: String(fd.get('email')),
      password: String(fd.get('password')),
      redirect: false,
    });
    if (res?.error) {
      setError('Invalid email or password');
      setBusy(false);
      return;
    }
    router.push(search.get('next') ?? '/');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to Cairn</CardTitle>
        <CardDescription>Use your workspace credentials.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
