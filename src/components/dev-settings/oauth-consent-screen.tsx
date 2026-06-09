'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/lib/i18n/provider';

export type OauthConsentScreenProps = {
  clientName: string;
  workspaceName: string;
  scopes: string[];
  /** Hidden fields to round-trip back to /api/oauth/authorize on Allow/Cancel. */
  hidden: Record<string, string>;
};

/**
 * v0.9.16 Plan F — themed in-app OAuth consent screen. Reuses the Mint-Token
 * dialog's `devTokens.scope.<scope>.tip` i18n strings for the friendly scope
 * labels (no duplicate vocabulary). Allow/Cancel post the grant back to the
 * authorize endpoint. Buttons are ≥44px touch targets (WCAG 2.5.5).
 */
export function OauthConsentScreen({
  clientName,
  workspaceName,
  scopes,
  hidden,
}: OauthConsentScreenProps) {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('oauthConsent.title', { client: clientName })}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t('oauthConsent.intro', { client: clientName, workspace: workspaceName })}
          </p>
          <div>
            <p className="mb-2 font-medium text-sm">{t('oauthConsent.scopesHeading')}</p>
            <ul className="space-y-1">
              {scopes.map((s) => (
                <li
                  key={s}
                  data-scope={s}
                  className="rounded bg-muted px-3 py-2 text-sm"
                  title={t(`devTokens.scope.${s}.tip`)}
                >
                  {t(`devTokens.scope.${s}.tip`)}
                </li>
              ))}
            </ul>
          </div>
          <form method="post" action="/api/oauth/authorize" className="flex gap-3">
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Button
              type="submit"
              name="decision"
              value="deny"
              variant="outline"
              className="min-h-11 flex-1"
            >
              {t('oauthConsent.cancel')}
            </Button>
            <Button type="submit" name="decision" value="allow" className="min-h-11 flex-1">
              {t('oauthConsent.allow')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
