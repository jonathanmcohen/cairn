/**
 * v0.10.0 D6 — human-readable byte formatting shared by the upload route's
 * 413 quota error (server) and the storage-usage meter (client). Kept tiny and
 * dependency-free on purpose: unit symbols (B/KB/MB/GB/TB) are not localized,
 * matching the health panel's composed numeric+unit idiom.
 *
 * Rules: bytes < 1 KB render as an integer ("512 B"); larger values render
 * with exactly one decimal in the largest unit that keeps the value >= 1
 * ("2.5 MB", "4.0 MB"). Negative/non-finite input clamps to "0 B".
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}
