/**
 * Map a user id to a stable, readable cursor color. Pure: same id → same hue.
 * Saturation/lightness are fixed for legible labels on both themes.
 *
 * Single source of truth for caret color — the page route imports this rather
 * than carrying its own copy.
 */
export function userColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}
