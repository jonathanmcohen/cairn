import { describe, expect, it } from 'vitest';
import { generateSamlSpKeypair } from '@/lib/sso/saml-keypair';

describe('generateSamlSpKeypair', () => {
  it('returns a PEM-encoded private key and self-signed X.509 cert', async () => {
    const { privateKeyPem, certPem } = await generateSamlSpKeypair({
      entityId: 'https://cairn.example/api/sso/saml/metadata/i1',
    });
    expect(privateKeyPem).toMatch(/-----BEGIN (RSA )?PRIVATE KEY-----/);
    expect(privateKeyPem).toMatch(/-----END (RSA )?PRIVATE KEY-----/);
    expect(certPem).toMatch(/-----BEGIN CERTIFICATE-----/);
    expect(certPem).toMatch(/-----END CERTIFICATE-----/);
  });

  it('produces distinct keypairs on each call', async () => {
    const a = await generateSamlSpKeypair({ entityId: 'urn:test' });
    const b = await generateSamlSpKeypair({ entityId: 'urn:test' });
    expect(a.privateKeyPem).not.toBe(b.privateKeyPem);
  });
});
