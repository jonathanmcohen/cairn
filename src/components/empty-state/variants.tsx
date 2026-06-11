import {
  Archive,
  BellOff,
  Clock,
  GraduationCap,
  Inbox,
  Link2,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '@/components/empty-state/empty-state';
import { copy } from '@/lib/copy/messages';

export function EmptyPageTree() {
  return (
    <EmptyState
      headline={copy('empty.pageTree.headline')}
      guidance={copy('empty.pageTree.guidance')}
      ctaLabel={copy('empty.pageTree.cta')}
      ctaHref="/pages/new"
    />
  );
}

export function EmptySearch() {
  return (
    <EmptyState
      icon={<Search aria-hidden="true" />}
      headline={copy('empty.search.headline')}
      guidance={copy('empty.search.guidance')}
    />
  );
}

export function EmptyDbTable({ onAddRow }: { onAddRow?: () => void }) {
  return (
    <EmptyState
      headline={copy('empty.dbTable.headline')}
      guidance={copy('empty.dbTable.guidance')}
      ctaLabel={onAddRow ? copy('empty.dbTable.cta') : undefined}
      onCta={onAddRow}
    />
  );
}

export function EmptyNotifications() {
  return (
    <EmptyState
      icon={<BellOff aria-hidden="true" />}
      headline={copy('empty.notifications.headline')}
      guidance={copy('empty.notifications.guidance')}
    />
  );
}

export function EmptyFavorites() {
  return (
    <EmptyState
      icon={<Star aria-hidden="true" />}
      headline={copy('empty.favorites.headline')}
      guidance={copy('empty.favorites.guidance')}
      ctaLabel={copy('empty.favorites.cta')}
      ctaHref="/"
    />
  );
}

export function EmptyTrash() {
  return (
    <EmptyState
      icon={<Trash2 aria-hidden="true" />}
      headline={copy('empty.trash.headline')}
      guidance={copy('empty.trash.guidance')}
    />
  );
}

export function EmptyArchived() {
  return (
    <EmptyState
      icon={<Archive aria-hidden="true" />}
      headline={copy('empty.archived.headline')}
      guidance={copy('empty.archived.guidance')}
    />
  );
}

export function EmptyFlashcardsDue() {
  return (
    <EmptyState
      icon={<GraduationCap aria-hidden="true" />}
      headline={copy('empty.flashcardsDue.headline')}
      guidance={copy('empty.flashcardsDue.guidance')}
      ctaLabel={copy('empty.flashcardsDue.cta')}
      // v0.9.11 #116 — was "/", which the home route redirects away from and
      // does not filter. /search is a real query-param route where the user can
      // find pages that contain flashcards and add/review more cards.
      ctaHref="/search"
    />
  );
}

export function EmptyInbox() {
  return (
    <EmptyState
      icon={<Inbox aria-hidden="true" />}
      headline={copy('empty.inbox.headline')}
      guidance={copy('empty.inbox.guidance')}
    />
  );
}

export function EmptyBacklinks() {
  return (
    <EmptyState
      icon={<Link2 aria-hidden="true" />}
      headline={copy('empty.backlinks.headline')}
      guidance={copy('empty.backlinks.guidance')}
    />
  );
}

export function EmptyRecents() {
  return (
    <EmptyState
      icon={<Clock aria-hidden="true" />}
      headline={copy('empty.recents.headline')}
      guidance={copy('empty.recents.guidance')}
    />
  );
}
