'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Suspense, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function SignupForm() {
  const router = useRouter();
  const search = useSearchParams();
  const invite = search.get('invite') ?? '';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [oauthProviders, setOauthProviders] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, { id: string; name: string }>) => {
        setOauthProviders(Object.values(data).filter((p) => p.id !== 'credentials'));
      })
      .catch(() => setOauthProviders([]));
  }, []);

  async function onSubmit(formData: FormData) {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(formData.entries());
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Signup failed (${res.status})`);
      setBusy(false);
      return;
    }
    await signIn('credentials', {
      email: String(body.email),
      password: String(body.password),
      redirect: false,
    });
    router.push('/');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your Cairn account</CardTitle>
        <CardDescription>
          If you&apos;re the first user, you&apos;ll create the workspace. Otherwise an invite token
          is required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={onSubmit} className="space-y-4">
          <Field name="name" label="Your name" required />
          <Field name="email" type="email" label="Email" required />
          <Field
            name="password"
            type="password"
            label="Password (≥ 12 chars)"
            required
            minLength={12}
          />
          <Field name="workspaceName" label="Workspace name (first user only)" />
          <Field name="inviteToken" label="Invite token (invited users)" defaultValue={invite} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Creating...' : 'Sign up'}
          </Button>
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
                onClick={() => void signIn(p.id, { callbackUrl: '/' })}
              >
                Continue with {p.name}
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}

function Field(props: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  defaultValue?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.name}>{props.label}</Label>
      <Input
        id={props.name}
        name={props.name}
        type={props.type ?? 'text'}
        required={props.required}
        minLength={props.minLength}
        defaultValue={props.defaultValue}
      />
    </div>
  );
}
