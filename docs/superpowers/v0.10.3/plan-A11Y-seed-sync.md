# Plan A11Y — accessibility seed synced to live Cairn docs

> **HOLD: do not touch code until the user replies GO on Plan A11Y.** Scaffold only.
> REQUIRED SUB-SKILL at execution: superpowers:subagent-driven-development.

**Goal** — the a11y seed always equals the Cairn Guide page tree. When docs
change in Cairn, the seed regenerates; CI fails if the committed seed is stale.

**Current state (to confirm at lock, file:line)** — a11y fixtures are
checked-in static content. The a11y harness today seeds a synthetic workspace +
rich page + inline database (`tests/a11y/seed.ts`); screenshot/axe specs run off
that. Production docs live at `cairn.local.jonco.dev` under "Cairn Guide". The
two have drifted. **Pre-lock task:** locate the exact current seed/fixture path
(`tests/a11y/seed.ts` + any `tests/a11y/fixtures/*`) and record it.

---

### A11Y-1 — Seed source = Cairn Guide tree

- New `scripts/export-a11y-seed.ts`: with an admin PAT (build secret
  `CAIRN_DOC_SOURCE_PAT`), call `GET /api/v1/pages`, walk descendants of the
  Cairn Guide root page, fetch each page's ProseMirror doc, **normalise**
  (strip workspace IDs, page/parent UUIDs → stable slugs, timestamps, user IDs),
  write deterministic JSON to the a11y seed path (`tests/a11y/fixtures/cairn-guide.json`).
- Output sorted by stable title order so diffs are reviewable.
- Spec: unit test on the normaliser (idempotent: normalise(normalise(x)) === normalise(x); no raw UUID/timestamp survives).

### A11Y-2 — Auto-regen on doc change

- `package.json` `docs:sync` → runs the export against `CAIRN_DOC_SOURCE_URL`
  (defaults to the production canary), updates the seed.
- GitHub Action `a11y-seed-sync.yml`: daily 03:00 UTC against the canary; opens
  a PR with the new seed if it differs (no-op if identical).
- Spec: dry-run the action logic locally; assert a known doc delta produces a seed delta.

### A11Y-3 — CI freshness gate

- `pnpm docs:sync --check` in CI on every PR: fails if the committed seed
  differs from a fresh pull. **This is the gate that catches "docs updated, seed
  not regenerated".**
- Spec: mutate the committed seed, run `--check`, assert non-zero exit + a readable diff.

### A11Y-4 — a11y tests consume the new seed

- Update `tests/a11y/*.spec.ts` to load fixtures from the new path.
- Each top-level Cairn Guide page → one axe-core spec target against the
  rendered page; AA violations gate the release.
- Spec: the a11y suite enumerates targets from the seed (count == top-level page count).

### A11Y-5 — Workspace fresh-install seed

- The Cairn Guide tree becomes the seed for NEW workspaces (replaces the static
  "Welcome to Cairn" demo content).
- **Migration 0080** — `is_seed_workspace_template` boolean on `workspaces`;
  the docs tree workspace is flagged; fresh-install bootstrap deep-copies the
  flagged tree into the new workspace (new page/parent IDs, content rewritten).
- Spec: migration integration test — fresh workspace bootstrap reproduces the
  seed tree shape (page count + parent edges) with fresh IDs.

---

## Failure modes to verify

- **Docs updated, seed not regenerated** → A11Y-3 `--check` fails CI. (spec: stale-seed exit-non-zero)
- **Network-blocked CI can't reach canary** → script falls back to a committed
  `tests/a11y/fixtures/snapshot.json` with a max-age check (warn, don't hard-fail
  offline; the freshness gate runs against the live source only when reachable).
  (spec: simulate unreachable source → fallback path taken, max-age enforced)
- **Emoji / unicode in docs breaks JSON normalisation** → schema validation on
  the normalised output catches it. (spec: doc with emoji/RTL/combining-marks
  round-trips through normalise + schema-validate)

## Coverage check (fill at lock)

| Deliverable | Build item | Spec |
|---|---|---|
| export-a11y-seed.ts + normaliser | A11Y-1 | _TBD_ |
| docs:sync + daily action | A11Y-2 | _TBD_ |
| --check freshness gate | A11Y-3 | _TBD_ |
| specs consume new seed | A11Y-4 | _TBD_ |
| migration 0080 + fresh-install copy | A11Y-5 | _TBD_ |

## Failure-modes-verified (fill at lock)

- [ ] stale-seed → CI red (A11Y-3)
- [ ] unreachable canary → snapshot fallback + max-age (A11Y-2/1)
- [ ] emoji/unicode → schema validation (A11Y-1)

## Open questions for GO

- Confirm the Cairn Guide **root page id / slug** + the canary base URL
  (`CAIRN_DOC_SOURCE_URL`) and where the admin PAT is stored for CI.
- Confirm the exact current a11y seed path to replace.
- Snapshot-fallback max-age value.
