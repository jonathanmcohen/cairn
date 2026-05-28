import { describe, expect, it } from 'vitest';
import { generateDek } from '@/lib/e2e/crypto';
import { decryptPageContent, encryptPageContent } from '@/lib/e2e/page-cipher';

describe('page-cipher', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'secret' }] }],
  };

  it('encrypt + decrypt round-trips arbitrary TipTap JSON', () => {
    const dek = generateDek();
    const ct = encryptPageContent(doc, dek);
    const back = decryptPageContent(ct, dek);
    expect(back).toEqual(doc);
  });

  it('decrypt with a wrong DEK throws', () => {
    const dek = generateDek();
    const wrong = generateDek();
    const ct = encryptPageContent(doc, dek);
    expect(() => decryptPageContent(ct, wrong)).toThrow();
  });

  it('tampering with the ciphertext is rejected', () => {
    const dek = generateDek();
    const ct = Buffer.from(encryptPageContent(doc, dek));
    const at = ct[20] ?? 0;
    ct[20] = at ^ 0x01;
    expect(() => decryptPageContent(ct, dek)).toThrow();
  });

  it('rejects DEK with wrong length on encrypt', () => {
    expect(() => encryptPageContent(doc, Buffer.alloc(16))).toThrow();
  });

  it('rejects DEK with wrong length on decrypt', () => {
    const dek = generateDek();
    const ct = encryptPageContent(doc, dek);
    expect(() => decryptPageContent(ct, Buffer.alloc(16))).toThrow();
  });

  it('rejects blob shorter than minimum envelope size', () => {
    const dek = generateDek();
    expect(() => decryptPageContent(Buffer.alloc(10), dek)).toThrow();
  });
});
