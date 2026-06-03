'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useT } from '@/lib/i18n/provider';
import { InviteCreateForm } from './invites-manager';

/**
 * v0.9.9 K3 #225/#226 — self-contained "Invite member" modal. The trigger
 * label matches the dialog title (no more route-to-page mismatch), and the
 * create-form lives inside, surfacing a copy-link after creation. The dialog
 * stays open after creation so the admin can copy the link; Radix resets the
 * form on close (unmount).
 */
export function InviteMemberDialog({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button">{t('invites.inviteMember')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('invites.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('invites.dialogDescription')}</DialogDescription>
        </DialogHeader>
        <InviteCreateForm workspaceId={workspaceId} />
      </DialogContent>
    </Dialog>
  );
}
