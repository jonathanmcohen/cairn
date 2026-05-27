'use client';

import type { DiffBlock, PMDoc } from '@/lib/pages/version-diff';

export type VersionDiffViewerProps = {
  diff: DiffBlock[];
  snapshotA: { id: string; createdAt: Date; content: PMDoc };
  snapshotB: { id: string; createdAt: Date; content: PMDoc };
};

// Stub implementation — replaced in Task 3.
export function VersionDiffViewer(_props: VersionDiffViewerProps) {
  return null;
}
