# Cairn Release & Ship v0.1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish v0.1.0. Land the deferred drag handle polish, add the GitHub Actions release workflow (multi-arch ghcr.io publish on tag), polish the README + supporting docs, run a full pre-release smoke, tag `v0.1.0`, and verify the published image.

**Architecture:** No new runtime components. The release workflow uses `docker/build-push-action@v6` with QEMU for arm64, publishes `ghcr.io/<user>/cairn:0.1.0`, `:0.1`, `:0`, `:latest`, and generates SBOM + provenance attestations automatically. Drag handle is a TipTap floating UI overlay (no extension required) — pure React side-effect using `floating-ui` for positioning.

**Tech Stack additions:** `@floating-ui/react` for the drag handle. No infra changes.

---

## What's in scope for Plan 6

- Floating drag handle UI: hover any block → handle appears in the left margin with a small menu (Move Up, Move Down, Duplicate, Delete)
- Release workflow `.github/workflows/release.yml` (multi-arch + SBOM + provenance, GitHub Release auto-notes)
- README polish: full feature list, env-var reference table, screenshots placeholder, deploy snippet, badge for the released image
- SECURITY.md + CONTRIBUTING.md skeletons
- Pre-release smoke (full stack walkthrough)
- Bump to v0.1.0 in package.json + final CHANGELOG entry
- Tag `v0.1.0` and verify the workflow publishes the image
- Update README with badge linking to the first release

## What's explicitly NOT in this plan

- v0.2.x scope (multi-workspace, OAuth, etc.)
- Documentation site / static-site build
- Marketing material, homepage, etc.

---

## File structure produced by this plan

```
cairn/
├── .github/
│   └── workflows/
│       └── release.yml                   # NEW
├── CHANGELOG.md                          # MODIFIED — promote [Unreleased] to [0.1.0]
├── CONTRIBUTING.md                       # NEW (or expanded)
├── SECURITY.md                           # NEW
├── README.md                             # MODIFIED — full polish
├── package.json                          # MODIFIED — version 0.1.0 (already is)
└── src/components/editor/
    ├── drag-handle.tsx                   # NEW
    └── editor.tsx                        # MODIFIED — mount DragHandle
```

---

## Conventions

- pnpm, conventional commits, no pushes from subagents (the human releases the tag manually after verifying everything locally).
- This plan does NOT introduce new vitest tests — it's polish + ops. UI changes verified by build + smoke. Workflow validated via local YAML lint + dry-run.

---

## Task 1: Drag handle UI (deferred from Plan 2)

**Goal:** Hover any editor block → a small handle appears in the left margin. Click the handle → menu opens (Move Up, Move Down, Duplicate, Delete).

**Files:**
- Install: `@floating-ui/react`
- Create: `src/components/editor/drag-handle.tsx`
- Modify: `src/components/editor/editor.tsx`

- [x] **Step 1: Install**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm add @floating-ui/react@^0.27.0
```

- [x] **Step 2: Write the drag handle component**

```tsx
'use client';

import type { Editor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useDismiss,
  useInteractions,
  useClick,
} from '@floating-ui/react';
import { GripVertical } from 'lucide-react';

type Pos = { top: number; left: number; height: number };

export function DragHandle({ editor }: { editor: Editor }) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [open, setOpen] = useState(false);
  const [targetPos, setTargetPos] = useState<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Track hovered block by listening to mousemove over the editor's DOM.
  useEffect(() => {
    const root = editor.view.dom as HTMLElement;
    function onMove(e: MouseEvent) {
      if (!root) return;
      const node = (e.target as HTMLElement)?.closest('[data-node-view-wrapper], p, h1, h2, h3, ul, ol, blockquote, pre, hr, div[data-type="callout"], img[data-cairn-image], a[data-cairn-file]');
      if (!node || !root.contains(node)) {
        setPos(null);
        return;
      }
      const rect = (node as HTMLElement).getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      setPos({
        top: rect.top - rootRect.top,
        left: -28,
        height: rect.height,
      });
      const dompos = editor.view.posAtDOM(node, 0);
      setTargetPos(dompos);
    }
    root.addEventListener('mousemove', onMove);
    return () => root.removeEventListener('mousemove', onMove);
  }, [editor]);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    middleware: [offset(4), flip(), shift()],
    placement: 'right-start',
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  if (!pos) return null;

  function action(kind: 'up' | 'down' | 'dup' | 'del') {
    if (targetPos === null) return;
    const { tr } = editor.state;
    const $pos = editor.state.doc.resolve(targetPos);
    const blockStart = $pos.before(1);
    const blockEnd = $pos.after(1);
    const node = editor.state.doc.nodeAt(blockStart);
    if (!node) return;
    if (kind === 'del') {
      editor.chain().focus().setNodeSelection(blockStart).deleteSelection().run();
    } else if (kind === 'dup') {
      editor.chain().focus().insertContentAt(blockEnd, node.toJSON()).run();
    } else if (kind === 'up') {
      const prev = editor.state.doc.childBefore(blockStart).node;
      if (!prev) return;
      const cut = tr.delete(blockStart, blockEnd).insert(blockStart - prev.nodeSize, node);
      editor.view.dispatch(cut);
    } else if (kind === 'down') {
      const next = editor.state.doc.childAfter(blockEnd).node;
      if (!next) return;
      const cut = tr.delete(blockStart, blockEnd).insert(blockEnd + next.nodeSize - node.nodeSize, node);
      editor.view.dispatch(cut);
    }
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', top: pos.top, left: pos.left }}>
      <button
        ref={refs.setReference}
        type="button"
        aria-label="Block actions"
        {...getReferenceProps()}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
          className="z-30 w-40 rounded-md border bg-popover py-1 text-sm shadow-md"
        >
          {[
            { kind: 'up' as const, label: 'Move up' },
            { kind: 'down' as const, label: 'Move down' },
            { kind: 'dup' as const, label: 'Duplicate' },
            { kind: 'del' as const, label: 'Delete' },
          ].map((item) => (
            <button
              key={item.kind}
              type="button"
              onClick={() => action(item.kind)}
              className="block w-full px-3 py-1.5 text-left hover:bg-accent"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

NOTE: The Move Up / Move Down transformations are the trickiest piece. The above code resolves the block at `targetPos` then deletes + reinserts via ProseMirror transactions. Edge cases (top/bottom of doc, nested blocks) may require minor adjustments — the implementer should iterate against a real editor.

- [x] **Step 3: Mount in editor.tsx**

In the editor render, wrap `<EditorContent />` with a relatively-positioned container and render `<DragHandle editor={editor} />` inside it when editor is non-null.

```tsx
return (
  <div className="relative">
    <div className="mb-1 text-right text-xs text-muted-foreground">{/* status */}</div>
    <div className="relative">
      {editor && <DragHandle editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  </div>
);
```

Remove the old TODO comment at the top of `extensions.ts`.

- [x] **Step 4: Build + smoke + commit**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm typecheck && pnpm lint && pnpm build && pnpm test
git add src/components/editor/drag-handle.tsx src/components/editor/editor.tsx \
        src/components/editor/extensions.ts package.json pnpm-lock.yaml && \
  git commit -m "feat: floating drag handle (move/duplicate/delete) — closes Plan 2 deferral"
```

---

## Task 2: GitHub Actions release workflow

**Goal:** Tag `v*.*.*` → build multi-arch image → publish to `ghcr.io/<owner>/cairn:<tags>` + SBOM + provenance + GitHub Release with auto-generated notes.

**Files:**
- Create: `.github/workflows/release.yml`

- [x] **Step 1: Write the workflow**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write
  packages: write
  id-token: write
  attestations: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract version from tag
        id: ver
        run: |
          version="${GITHUB_REF_NAME#v}"
          echo "version=${version}" >> "$GITHUB_OUTPUT"
          major="${version%%.*}"
          rest="${version#*.}"
          minor="${rest%%.*}"
          echo "major=${major}" >> "$GITHUB_OUTPUT"
          echo "majorminor=${major}.${minor}" >> "$GITHUB_OUTPUT"

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository_owner }}/cairn
          tags: |
            type=raw,value=${{ steps.ver.outputs.version }}
            type=raw,value=${{ steps.ver.outputs.majorminor }}
            type=raw,value=${{ steps.ver.outputs.major }}
            type=raw,value=latest,enable=${{ !contains(steps.ver.outputs.version, '-') }}

      - name: Build and push
        id: build
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: true
          sbom: true
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Attest
        uses: actions/attest-build-provenance@v2
        with:
          subject-name: ghcr.io/${{ github.repository_owner }}/cairn
          subject-digest: ${{ steps.build.outputs.digest }}
          push-to-registry: true

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          generate_release_notes: true
          prerelease: ${{ contains(steps.ver.outputs.version, '-') }}
          body: |
            Container image: `ghcr.io/${{ github.repository_owner }}/cairn:${{ steps.ver.outputs.version }}`

            Deploy:
            ```
            docker pull ghcr.io/${{ github.repository_owner }}/cairn:${{ steps.ver.outputs.version }}
            ```

            See [CHANGELOG.md](CHANGELOG.md) for the full feature list.
```

- [x] **Step 2: YAML sanity check**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  node -e "const fs = require('node:fs'); const yaml = require('yaml'); console.log(Object.keys(yaml.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'))))"
```

Expected: prints `["name","on","permissions","jobs"]`.

- [x] **Step 3: Commit**

```sh
git add .github/workflows/release.yml && \
  git commit -m "ci: release workflow (multi-arch ghcr.io, SBOM, provenance, release notes)"
```

---

## Task 3: SECURITY.md + CONTRIBUTING.md

**Files:**
- Create: `SECURITY.md`
- Create: `CONTRIBUTING.md`

- [x] **Step 1: Write `SECURITY.md`**

```markdown
# Security Policy

Cairn is a self-hosted personal/team tool. We take security reports seriously
but cannot offer a paid bug bounty.

## Supported Versions

Only the latest `0.x` minor release is supported.

## Reporting a Vulnerability

Please email security reports to **security@<your-domain>** or open a private
security advisory on GitHub. Include:

- A description of the issue.
- Steps to reproduce.
- Affected Cairn version (visible at `/api/health`).
- Suggested severity.

You can expect an initial acknowledgement within 7 days. We'll coordinate a
fix and a coordinated disclosure window if appropriate.

## Out of Scope

- Issues that require attacker-controlled access to the host or database.
- Self-hosted misconfigurations (e.g., a public Cairn instance with weak passwords).
- DoS via large payloads — Cairn enforces `CAIRN_MAX_UPLOAD_MB` and reasonable
  request limits; report only if there's a path to amplification.
```

- [x] **Step 2: Write `CONTRIBUTING.md`**

```markdown
# Contributing to Cairn

Thanks for your interest. Cairn is currently in early development; please open
an issue before working on significant changes.

## Local setup

```sh
git clone https://github.com/<your-user>/cairn.git
cd cairn
cp .env.example .env
pnpm install
pnpm dev   # or `docker compose up -d`
```

## Tests + lint

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests use [Testcontainers](https://node.testcontainers.org/) — Docker must be
running locally. CI exercises the same suite against a Postgres service container.

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`,
`refactor:`. Keep subjects under 72 chars.

## License

By contributing you agree your work will be licensed under the MIT license in
[LICENSE](LICENSE).
```

- [x] **Step 3: Commit**

```sh
git add SECURITY.md CONTRIBUTING.md && \
  git commit -m "docs: SECURITY.md and CONTRIBUTING.md"
```

---

## Task 4: README polish

**Goal:** Replace the spartan stub with a full-featured README. Include feature list, screenshots placeholder, env table, deploy snippet, roadmap, and license.

**Files:**
- Modify: `README.md`

- [x] **Step 1: Rewrite `README.md`**

```markdown
# Cairn

[![CI](https://github.com/<your-user>/cairn/actions/workflows/ci.yml/badge.svg)](https://github.com/<your-user>/cairn/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/<your-user>/cairn)](https://github.com/<your-user>/cairn/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Self-hosted, Notion-style block-based notes for homelab deployment.**

Cairn is a single-container web app you can run on your own hardware. It gives
you a familiar block-editor experience for nested notes, plus inline
databases, full-text search, and file uploads — without sending your content
to anyone else.

## Features (v0.1.0)

- 🌳 **Nested pages** with sidebar tree, emoji icons, cover images
- ✍️ **Block editor** (paragraph, headings, lists, todo lists, blockquote,
  code with syntax highlight, callouts, divider, image, file)
- 🪄 **Slash menu** (`/`) to insert blocks; floating drag handle for
  per-block actions
- 💾 **Autosave** with optimistic UI and stale-write conflict detection
- 🔎 **⌘K command palette** with full-text + trigram (typo-tolerant) search
- 🗑️ **Trash bin** with 30-day auto-purge
- 🗂️ **Inline databases** with table, kanban, and gallery views; AND filters
  + multi-column sort
- 📎 **File and image uploads** (HMAC-signed URLs, local-disk by default)
- ⬇️⬆️ **Markdown import/export** per page and per subtree (`.zip`)
- 👥 **Multi-tenant workspaces** with email/password auth and invite-token
  onboarding; owner / admin / editor / viewer roles
- 🌓 Light / dark / system theme

## Quickstart (Docker)

```sh
git clone https://github.com/<your-user>/cairn.git
cd cairn
cp .env.example .env
# Edit .env — at minimum set DB_PASSWORD and AUTH_SECRET to your own values.
docker compose up -d
```

Visit `http://localhost:3000`. The first user to sign up becomes the
workspace owner.

### Pulling a published image

```sh
docker pull ghcr.io/<your-user>/cairn:0.1.0
```

Then point your docker-compose at the published image instead of `build: .`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | _required_ | Postgres connection string |
| `AUTH_SECRET` | _required_ | Session signing secret (≥ 32 chars) |
| `NEXTAUTH_URL` | _required_ | Public base URL |
| `CAIRN_MAX_UPLOAD_MB` | `25` | Per-file upload size limit |
| `CAIRN_TRASH_RETENTION_DAYS` | `30` | Days before trash auto-purges |
| `CAIRN_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Local development

```sh
pnpm install
pnpm dev               # http://localhost:3000
pnpm test              # 250+ tests, requires Docker for testcontainers
pnpm lint              # Biome
pnpm typecheck         # tsc
pnpm build             # Next.js standalone + entrypoint compile
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

v0.1.0 is the initial release. Planned for later versions:

- **v0.2.x:** real-time collaborative editing (Yjs), OAuth providers, public
  read-only sharing, comments + mentions, multi-workspace switching
- **v0.3.x+:** native mobile apps, public API + webhooks, templates,
  page version history, S3/MinIO backend, backup/restore CLI

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

MIT — see [LICENSE](LICENSE). Built from scratch, not derived from any other
Notion alternative.
```

- [x] **Step 2: Verify links + build**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm build
```

- [x] **Step 3: Commit**

```sh
git add README.md && git commit -m "docs: polish README with full feature list, env table, badges"
```

---

## Task 5: Promote [Unreleased] to [0.1.0] in CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [x] **Step 1: Edit `CHANGELOG.md`**

Replace the `## [Unreleased]` heading with `## [0.1.0] - 2026-MM-DD` (use the actual date). Then prepend a fresh empty `## [Unreleased]` section above for future work.

Add a Plan 6 entry above the existing Plan 1–5 sections:

```markdown
### Added (Plan 6 — Release polish)
- Floating drag handle UI for per-block actions (move up/down, duplicate, delete).
- GitHub Actions release workflow: tag-triggered, multi-arch (amd64+arm64), publishes to ghcr.io, generates SBOM + provenance attestations, creates a GitHub Release.
- SECURITY.md and CONTRIBUTING.md.
- Polished README with feature list, configuration table, and image badges.
```

- [x] **Step 2: Commit**

```sh
git add CHANGELOG.md && git commit -m "docs: promote [Unreleased] to [0.1.0]"
```

---

## Task 6: Final pre-release smoke

**Goal:** Walk the entire v0.1.0 feature set from a clean slate. Document what worked. Catch any regression introduced by Plan 6 changes (especially the drag handle).

- [x] **Step 1: Full smoke**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && \
  docker compose down -v 2>/dev/null || true && \
  docker compose up -d --build && \
  sleep 25
```

Walk the full v0.1.0 path:

1. **Auth**: Sign up first user → become workspace owner. Sign out, sign back in. Generate an invite token → use it to sign up a second user → confirm role.
2. **Pages**: Create a page. Rename inline. Pick an emoji icon. Pick a cover image (upload). Create a nested page. Drag (or use the move actions) to reparent.
3. **Editor**: Add a heading, paragraph, bullet list, task list with checkboxes, blockquote, callout in each of the 4 colors, code block (try a language hint), divider. Drag-drop an image. Use the drag handle on a paragraph to move it. Delete a block via the drag handle menu.
4. **Search**: ⌘K → search a word, see results with breadcrumbs and snippet. Search with a typo → trigram fallback returns the same page.
5. **Trash**: Soft-delete a page → see it in `/trash`. Restore. Soft-delete again → hard-delete.
6. **Files**: Upload a file → confirm download link works.
7. **Markdown**: Export page as `.md` → confirm content. Import a `.md` file → confirm rendering. Export subtree as `.zip` → confirm contents.
8. **Databases**: `/database` → seeds with default Name. Add a Select property (Status: Todo/Doing/Done). Add a Date property (Due). Add 3 rows. Switch to Kanban grouped by Status. Drag a card. Switch to Gallery. Add a filter Status=Doing.

Capture any failures and fix them before tagging.

- [x] **Step 2: Run the test suite one more time**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm test
```

All green.

- [x] **Step 3: Tear down**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && docker compose down
```

(no `-v` — preserve volumes for any follow-up debug.)

- [x] **Step 4: Final lint + typecheck + build**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && pnpm lint && pnpm typecheck && pnpm build
```

All exit 0.

- [x] **Step 5: Commit pre-release notes (if any tweaks)**

If the smoke surfaced anything, fix and commit. Otherwise no commit for this task.

---

## Task 7: Tag and release

**WARNING:** This task PUSHES to the remote, triggering the publish workflow. Subagents must not execute this step automatically — the human runs it after reviewing.

- [x] **Step 1: Verify package.json version**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && grep '"version"' package.json
```

Expected: `"version": "0.1.0",`. (It already is from Plan 1; if not, bump and commit.)

- [x] **Step 2: Confirm clean tree + main is current**

```sh
source ~/.zshenv && cd /Users/jon/projects/cairn && git status && git fetch && git log @{u}..HEAD --oneline
```

Working tree clean. Local main ahead of origin/main only by the commits you intend to release.

- [x] **Step 3: Push main**

```sh
git push origin main
```

- [x] **Step 4: Tag**

```sh
git tag -a v0.1.0 -m "Cairn v0.1.0"
git push origin v0.1.0
```

The release workflow fires.

- [x] **Step 5: Watch the workflow**

```sh
source ~/.zshenv && gh run watch  # if gh CLI is installed
# or open https://github.com/<your-user>/cairn/actions
```

Expected outcomes:
- Build succeeds for both `linux/amd64` and `linux/arm64`.
- Image pushed to `ghcr.io/<your-user>/cairn:0.1.0`, `:0.1`, `:0`, `:latest`.
- SBOM + provenance attached.
- GitHub Release page created with auto-notes.

If the workflow fails: read the failure, fix in a follow-up commit on main, delete + re-push the tag.

- [x] **Step 6: Smoke the published image**

```sh
source ~/.zshenv && \
  docker run --rm -d --name cairn-pub-smoke -p 4000:3000 \
    -e DATABASE_URL=postgres://x:y@localhost:5432/x \
    -e AUTH_SECRET=$(printf 'x%.0s' {1..32}) \
    -e NEXTAUTH_URL=http://localhost:4000 \
    ghcr.io/<your-user>/cairn:0.1.0
docker logs cairn-pub-smoke | head -20
docker stop cairn-pub-smoke
```

Container should start and attempt migrations (will fail without a real DB — that's expected, we just want to see the entrypoint run).

---

## Task 8: Post-release wrap

- [x] **Step 1: Confirm README badge links resolve**

The badges at the top of README.md reference real URLs — visit them and make sure each renders correctly.

- [x] **Step 2: Open a v0.2.0 milestone** (optional, manual on GitHub)

The roadmap section in README points at v0.2.x. Add a milestone in the repo's Issues view if you want to track it formally.

- [x] **Step 3: Final tweet/post/announcement** — out of scope for this plan, do or don't as you wish.

---

## Done — v0.1.0 is shipped 🎉

You can now:
- Deploy with `docker pull ghcr.io/<your-user>/cairn:0.1.0`.
- Update the homelab compose to reference the published tag.
- Move on to v0.2.x planning (real-time collab, OAuth, multi-workspace, comments, public sharing).

The whole-of-spec v0.1.0 surface from Section 2 of `docs/superpowers/specs/2026-05-20-cairn-design.md` is covered. The deferred items in that spec (v0.2.x+ candidates) are explicitly out-of-scope and tracked in the README roadmap and the spec doc itself.
