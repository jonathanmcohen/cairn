'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { hasOnboarded, markOnboarded } from '@/components/onboarding/storage';
import { WelcomeTemplatePick } from '@/components/onboarding/welcome-template-pick';
import { Button } from '@/components/ui/button';

export type WizardInitialState = {
  hasAnyUserPages: boolean;
  workspaceName: string;
};

type Step = 'welcome' | 'name' | 'pick';

export function OnboardingWizard({
  workspaceId,
  initialState,
}: {
  workspaceId: string;
  initialState: WizardInitialState;
}) {
  // Render-gate: if either signal says no, render nothing for the rest of the
  // session. Re-checks localStorage on first render only (client-side).
  const [active, setActive] = useState<boolean>(() => {
    if (initialState.hasAnyUserPages) return false;
    if (typeof window === 'undefined') return false;
    return !hasOnboarded(workspaceId);
  });

  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState(initialState.workspaceName);
  const [pickedTemplateId, setPickedTemplateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Esc closes (treated as Skip).
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        markOnboarded(workspaceId);
        setActive(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, workspaceId]);

  function finishAndDismiss() {
    markOnboarded(workspaceId);
    setActive(false);
  }

  async function onConfirmName(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Workspace name cannot be empty.');
      return;
    }
    setError(null);
    if (trimmed !== initialState.workspaceName) {
      // Best-effort PATCH; failures surface but don't block onboarding.
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!res.ok) {
          setError(`Could not rename workspace (${res.status}); continuing anyway.`);
        }
      } catch {
        setError('Network error renaming workspace; continuing anyway.');
      }
    }
    setStep('pick');
  }

  async function onSetUp() {
    if (!pickedTemplateId || pickedTemplateId === '__welcome-fallback__') {
      // No real template id resolved — treat as "start blank".
      finishAndDismiss();
      router.refresh();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${pickedTemplateId}/instantiate`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Setup failed (${res.status})`);
      }
      const data = (await res.json()) as { rootPageId: string | null };
      finishAndDismiss();
      if (data.rootPageId) {
        // Send the user straight to the freshly-minted page.
        router.push(`/pages/${data.rootPageId}` as never);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
      setSubmitting(false);
    }
  }

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="fixed inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-label="Welcome to Cairn"
        aria-modal="true"
        className="relative w-full max-w-lg overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="space-y-4 p-6">
          {step === 'welcome' ? (
            <>
              <h2 className="text-xl font-semibold">Welcome to Cairn</h2>
              <p className="text-sm text-muted-foreground">
                Cairn is your self-hosted, block-based notes app. This quick setup will name your
                workspace and seed a starter page so you have something to work from.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={finishAndDismiss}>
                  Skip for now
                </Button>
                <Button type="button" onClick={() => setStep('name')}>
                  Get started
                </Button>
              </div>
            </>
          ) : null}

          {step === 'name' ? (
            <form onSubmit={(e) => void onConfirmName(e)} className="space-y-3">
              <h2 className="text-xl font-semibold">Name your workspace</h2>
              <p className="text-sm text-muted-foreground">
                This is what shows up in the sidebar. You can change it later in Settings.
              </p>
              <div>
                <label
                  htmlFor="ob-name"
                  className="block text-xs font-medium text-muted-foreground"
                >
                  Workspace name
                </label>
                <input
                  id="ob-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setStep('welcome')}>
                  Back
                </Button>
                <Button type="submit">Continue</Button>
              </div>
            </form>
          ) : null}

          {step === 'pick' ? (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">Pick a starter</h2>
              <p className="text-sm text-muted-foreground">
                Choose a built-in template to seed your workspace, or start with a blank slate.
              </p>
              <WelcomeTemplatePick
                selectedId={pickedTemplateId}
                onPick={setPickedTemplateId}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    finishAndDismiss();
                    router.refresh();
                  }}
                  disabled={submitting}
                >
                  Start blank
                </Button>
                <Button
                  type="button"
                  onClick={() => void onSetUp()}
                  disabled={submitting || !pickedTemplateId}
                >
                  {submitting ? 'Setting up…' : 'Set up workspace'}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
