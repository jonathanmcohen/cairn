'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { PresenceUser } from '@/lib/collab/presence';
import { cn } from '@/lib/utils';

const MAX_VISIBLE = 5;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function PresenceAvatars({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return null;

  const visible = users.slice(0, MAX_VISIBLE);
  const overflow = users.length - visible.length;

  return (
    <div
      className="flex items-center"
      role="img"
      aria-label={`${users.length} collaborators present`}
    >
      <div className="flex -space-x-2">
        {visible.map((u) => (
          <Avatar
            key={u.id}
            className="size-7 border-2 border-background ring-1"
            style={{ ['--tw-ring-color' as string]: u.color }}
            title={u.name}
          >
            {u.image ? <AvatarImage src={u.image} alt={u.name} /> : null}
            <AvatarFallback style={{ backgroundColor: u.color }} className="text-[10px] text-white">
              {initials(u.name)}
            </AvatarFallback>
          </Avatar>
        ))}
      </div>
      {overflow > 0 && (
        <span className={cn('ml-2 text-xs text-muted-foreground')}>+{overflow}</span>
      )}
    </div>
  );
}
