import type { Route } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function IdpAddButtons() {
  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={'/settings/admin/sso/oidc/new' as Route}>Add OIDC</Link>
      </Button>
      <Button asChild size="sm" variant="outline">
        <Link href={'/settings/admin/sso/saml/new' as Route}>Add SAML</Link>
      </Button>
    </div>
  );
}
