/**
 * Generate a fresh RSA-2048 keypair + a self-signed X.509 certificate suitable
 * for use as a SAML SP's signing / encryption key. The certificate uses the
 * provided `entityId` as the subject CN and is valid for 10 years (longer than
 * any reasonable SP lifecycle; admins regenerate the keypair by deleting +
 * re-creating the IdP config).
 *
 * Implementation: uses the `node-forge` library — well-tested cross-platform
 * X.509 generator. Imported dynamically so the heavyweight forge module isn't
 * loaded unless an admin actually creates a SAML config.
 */
export type SpKeypair = {
  privateKeyPem: string;
  certPem: string;
};

export async function generateSamlSpKeypair(input: { entityId: string }): Promise<SpKeypair> {
  const forge = await import('node-forge');
  const pki = forge.pki;
  const keys = pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `${Date.now()}`;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  const attrs: Array<{ name: string; value: string }> = [
    { name: 'commonName', value: input.entityId.slice(0, 64) },
    { name: 'organizationName', value: 'Cairn' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  return {
    privateKeyPem: pki.privateKeyToPem(keys.privateKey),
    certPem: pki.certificateToPem(cert),
  };
}
