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
    <EmptyState headline={copy('empty.search.headline')} guidance={copy('empty.search.guidance')} />
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
      headline={copy('empty.notifications.headline')}
      guidance={copy('empty.notifications.guidance')}
    />
  );
}

export function EmptyFavorites() {
  return (
    <EmptyState
      headline={copy('empty.favorites.headline')}
      guidance={copy('empty.favorites.guidance')}
    />
  );
}

export function EmptyInbox() {
  return (
    <EmptyState headline={copy('empty.inbox.headline')} guidance={copy('empty.inbox.guidance')} />
  );
}

export function EmptyBacklinks() {
  return (
    <EmptyState
      headline={copy('empty.backlinks.headline')}
      guidance={copy('empty.backlinks.guidance')}
    />
  );
}

export function EmptyRecents() {
  return (
    <EmptyState
      headline={copy('empty.recents.headline')}
      guidance={copy('empty.recents.guidance')}
    />
  );
}
