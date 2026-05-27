import { describe, expect, it } from 'vitest';
import { ALLOWED_UPLOAD_MIME, isAllowedMime } from '@/lib/files/upload';

describe('upload allowlist — audio', () => {
  it.each(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/aac'])(
    'accepts %s',
    (mime) => {
      expect(isAllowedMime(mime)).toBe(true);
      expect(ALLOWED_UPLOAD_MIME.has(mime)).toBe(true);
    },
  );

  it('still rejects executables', () => {
    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-sh')).toBe(false);
  });

  it('still rejects unknown types', () => {
    expect(isAllowedMime('totally/unknown')).toBe(false);
  });
});
