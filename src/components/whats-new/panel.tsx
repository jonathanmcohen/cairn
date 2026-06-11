'use client';

import { useT } from '@/lib/i18n/provider';
import { releaseNotes } from '@/lib/release-notes/notes.generated';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet';

/**
 * v0.10.0 E2 — in-app What's-new panel, opened from the sidebar version chip.
 *
 * Renders the CURRENT version's CHANGELOG section from the build-time module
 * `src/lib/release-notes/notes.generated.ts` (see
 * scripts/generate-release-notes.mjs) — importing the text is what survives
 * `output: 'standalone'`, where CHANGELOG.md itself is not shipped. The notes
 * render ONLY when the generated module's version matches the RUNNING version
 * exactly; any mismatch (e.g. package.json bumped ahead of the changelog)
 * falls back to "notes not available yet" instead of showing a stale section.
 *
 * No role gate anywhere in this path — every member sees the panel. The
 * external GitHub release link lives in the footer so the old version-chip
 * affordance isn't lost.
 */

const RELEASE_URL_BASE = 'https://github.com/jonathanmcohen/cairn/releases/tag/v';

type WhatsNewPanelProps = {
  /** Running app version (appVersion(), passed down from the server shell). */
  version: string;
  open: boolean;
  /** Radix-style open-state callback; the owner marks the seen-marker on close. */
  onOpenChange: (open: boolean) => void;
};

export function WhatsNewPanel({ version, open, onOpenChange }: WhatsNewPanelProps) {
  const t = useT();
  const markdown = releaseNotes.version === version ? releaseNotes.markdown : null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        data-testid="whats-new-panel"
        closeLabel={t('whatsNew.close')}
        aria-describedby={undefined}
        className="w-full max-w-md"
      >
        <SheetHeader>
          <SheetTitle>{t('whatsNew.title', { version })}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm">
          {markdown === null ? (
            <p data-testid="whats-new-fallback" className="text-muted-foreground">
              {t('whatsNew.fallback')}
            </p>
          ) : (
            <NotesBody markdown={markdown} />
          )}
        </div>
        <div className="border-t pt-3 text-sm">
          <a
            data-testid="whats-new-github"
            href={`${RELEASE_URL_BASE}${version}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center rounded px-1 underline underline-offset-2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {t('whatsNew.viewOnGitHub')}
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Minimal, safe CHANGELOG-markdown rendering: headings → <h3>, `- ` bullets →
 * <ul><li> (hard-wrapped continuation lines re-joined), remaining lines →
 * paragraphs. Inline emphasis/code/link markers are stripped to plain text;
 * everything is emitted through React text nodes — never innerHTML. (No
 * client-side markdown renderer exists in the repo; `marked` is server-only.)
 */
type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'paragraph'; text: string };

function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold**
    .replace(/\*([^*]+)\*/g, '$1') // *italic*
    .replace(/`([^`]*)`/g, '$1'); // `code`
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let mode: 'none' | 'list' | 'paragraph' = 'none';
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      mode = 'none';
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: stripInline(heading[1] ?? '') });
      mode = 'none';
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      const item = stripInline(bullet[1] ?? '');
      const prev = blocks[blocks.length - 1];
      if (mode === 'list' && prev?.kind === 'list') prev.items.push(item);
      else blocks.push({ kind: 'list', items: [item] });
      mode = 'list';
      continue;
    }
    const prev = blocks[blocks.length - 1];
    if (mode === 'list' && prev?.kind === 'list' && prev.items.length > 0) {
      // CHANGELOG bullets hard-wrap at ~80 cols; re-join continuation lines.
      prev.items[prev.items.length - 1] += ` ${stripInline(line)}`;
      continue;
    }
    if (mode === 'paragraph' && prev?.kind === 'paragraph') {
      prev.text += ` ${stripInline(line)}`;
      continue;
    }
    blocks.push({ kind: 'paragraph', text: stripInline(line) });
    mode = 'paragraph';
  }
  return blocks;
}

function NotesBody({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => {
        // Index-derived keys are fine here: static build-time content, never reordered.
        const key = `${block.kind}-${i}`;
        if (block.kind === 'heading') {
          return (
            <h3 key={key} className="font-semibold text-foreground">
              {block.text}
            </h3>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={key} className="flex list-disc flex-col gap-1.5 pl-5">
              {block.items.map((item, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static build-time content, never reordered
                <li key={`${key}-${j}`}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{block.text}</p>;
      })}
    </div>
  );
}
