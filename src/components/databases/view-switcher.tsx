'use client';

export type ViewTab = { id: string; type: string; name: string };

export function ViewSwitcher({
  views,
  activeId,
  onChange,
}: {
  views: ViewTab[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b px-2 py-1">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onChange(v.id)}
          className={`rounded px-2 py-1 text-sm ${v.id === activeId ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}
        >
          {v.name}
        </button>
      ))}
    </div>
  );
}
