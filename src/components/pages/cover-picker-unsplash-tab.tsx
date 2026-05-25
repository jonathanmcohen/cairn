'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type UnsplashPhoto = {
  id: string;
  urls: { regular: string; thumb: string };
  user: { name: string };
};

export type UnsplashTabProps = {
  accessKey: string;
  onPick: (url: string) => void;
};

export function UnsplashTab({ accessKey, onPick }: UnsplashTabProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnsplashPhoto[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      // Client-side fetch — accessKey is the NEXT_PUBLIC_* env, which is
      // inlined into this bundle at build time. The key never travels
      // through any Cairn server route.
      const res = await fetch(
        `https://api.unsplash.com/search/photos?per_page=12&query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `Client-ID ${accessKey}` } },
      );
      if (!res.ok) {
        setResults([]);
        return;
      }
      const json = (await res.json()) as { results: UnsplashPhoto[] };
      setResults(json.results ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
        className="flex gap-2"
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Unsplash"
        />
        <Button type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <div className="grid grid-cols-3 gap-2">
        {results.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.urls.regular)}
            className="overflow-hidden rounded border hover:opacity-80"
            aria-label={`Photo by ${p.user.name}`}
          >
            {/** biome-ignore lint/performance/noImgElement: external host */}
            <img
              src={p.urls.thumb}
              alt={`Photo by ${p.user.name}`}
              className="h-24 w-full object-cover"
            />
          </button>
        ))}
      </div>
      {results.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Photos via Unsplash — please credit photographers per Unsplash terms.
        </p>
      )}
    </div>
  );
}
