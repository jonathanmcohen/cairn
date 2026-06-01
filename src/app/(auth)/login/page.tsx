'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Suspense, useEffect, useState } from 'react';
import { PasskeyLoginButton } from '@/components/security/passkey-login-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/provider';

type SsoProvider = { id: string; type: string; name: string; startPath: string };

function LoginForm() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [oauthProviders, setOauthProviders] = useState<{ id: string; name: string }[]>([]);
  const [ssoProviders, setSsoProviders] = useState<SsoProvider[]>([]);

  useEffect(() => {
    void fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, { id: string; name: string }>) => {
        setOauthProviders(Object.values(data).filter((p) => p.id !== 'credentials'));
      })
      .catch(() => setOauthProviders([]));
  }, []);

  useEffect(() => {
    const next = search.get('next') ?? '';
    const qs = next ? `?next=${encodeURIComponent(next)}` : '';
    void fetch(`/api/sso/enabled${qs}`)
      .then((r) => (r.ok ? r.json() : { providers: [] }))
      .then((data: { providers: SsoProvider[] }) => {
        setSsoProviders(Array.isArray(data.providers) ? data.providers : []);
      })
      .catch(() => setSsoProviders([]));
  }, [search]);

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
        {search.get('error') === 'AccessDenied' && (
          <p className="mb-4 text-sm text-destructive">
            This account isn't invited to any workspace. Ask an admin for an invite, then try again.
          </p>
        )}
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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
          <PasskeyLoginButton
            email={email}
            onSuccess={() => router.push(search.get('next') ?? '/')}
          />
        </form>
        {oauthProviders.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-center text-xs text-muted-foreground">or</div>
            {oauthProviders.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => void signIn(p.id, { callbackUrl: search.get('next') ?? '/' })}
              >
                Continue with {p.name}
              </Button>
            ))}
          </div>
        )}
        {ssoProviders.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-center text-muted-foreground text-xs">
              {t('login.sso.divider')}
            </div>
            {ssoProviders.map((p) => (
              <Button
                key={p.id}
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => window.location.assign(p.startPath)}
              >
                {t('login.sso.button', { name: p.name })}
              </Button>
            ))}
          </div>
        )}
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
